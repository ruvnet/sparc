import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error The production scanner is intentionally dependency-free JavaScript.
import { scanFiles, scanRepository } from '../scripts/scan-secrets.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'sparc-secret-test-'));
  temporaryDirectories.push(path);
  return path;
}

function storedZipEntries(entries: ReadonlyArray<{ name: string; content: Buffer; method?: number }>): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name);
    const method = entry.method ?? 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(entry.content.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(entry.content.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);

    const localRecord = Buffer.concat([local, nameBytes, entry.content]);
    localRecords.push(localRecord);
    centralRecords.push(Buffer.concat([central, nameBytes]));
    localOffset += localRecord.length;
  }
  const centralRecord = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralRecord.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralRecord, end]);
}

function storedZip(name: string, content: Buffer, method = 0): Buffer {
  return storedZipEntries([{ name, content, method }]);
}

function canary(): string {
  return ['sk', 'ant', 'canary_' + 'A'.repeat(28)].join('-');
}

describe('secret scanner', () => {
  it('detects a canary in a plain file without returning its value', () => {
    const root = temporaryDirectory();
    const value = canary();
    writeFileSync(join(root, '.env.local'), `ANTHROPIC_API_KEY=${value}\n`);

    const findings = scanFiles(root, ['.env.local']);

    expect(findings).toEqual(expect.arrayContaining([
      { path: '.env.local', patternId: 'anthropic-api-key' },
      { path: '.env.local', patternId: 'credential-assignment' },
    ]));
    expect(JSON.stringify(findings)).not.toContain(value);
  });

  it('detects a canary inside a zip without extracting it', () => {
    const root = temporaryDirectory();
    const value = canary();
    writeFileSync(join(root, 'bundle.zip'), storedZip('config/.env.local', Buffer.from(`TOKEN=${value}\n`)));

    const findings = scanFiles(root, ['bundle.zip']);

    expect(findings).toContainEqual({ path: 'bundle.zip!config/.env.local', patternId: 'anthropic-api-key' });
    expect(JSON.stringify(findings)).not.toContain(value);
  });

  it('recognizes an archive by signature when its extension is disguised', () => {
    const root = temporaryDirectory();
    const value = canary();
    writeFileSync(join(root, 'opaque.bin'), storedZip('config/.env.local', Buffer.from(`TOKEN=${value}\n`)));

    expect(scanFiles(root, ['opaque.bin'])).toContainEqual({
      path: 'opaque.bin!config/.env.local',
      patternId: 'anthropic-api-key',
    });
  });

  it('fails closed on an unsupported zip compression method', () => {
    const root = temporaryDirectory();
    writeFileSync(join(root, 'unsupported.zip'), storedZip('data.txt', Buffer.from('opaque'), 12));

    expect(() => scanFiles(root, ['unsupported.zip'])).toThrow(/unsupported ZIP compression method 12/);
  });

  it('fails closed when nested archives exceed the inspection limit', () => {
    const root = temporaryDirectory();
    const nested = storedZip(
      'level-two.zip',
      storedZip('level-three.zip', storedZip('data.txt', Buffer.from('safe'))),
    );
    writeFileSync(join(root, 'level-one.zip'), nested);

    expect(() => scanFiles(root, ['level-one.zip'])).toThrow(/archive nesting exceeds limit/);
  });

  it('enforces one decompressed-byte budget across nested archives', () => {
    const root = temporaryDirectory();
    const compressed = gzipSync(Buffer.alloc(21 * 1024 * 1024, 0x61));
    writeFileSync(join(root, 'nested.zip'), storedZipEntries([
      { name: 'first.txt.gz', content: compressed },
      { name: 'second.txt.gz', content: compressed },
    ]));

    expect(() => scanFiles(root, ['nested.zip'])).toThrow(/global archive decompressed-byte limit exceeded/);
  });

  it('enforces one entry budget across every archive in a scan', () => {
    const root = temporaryDirectory();
    const entries = Array.from({ length: 1_001 }, (_, index) => ({
      name: `entry-${index}.txt`,
      content: Buffer.alloc(0),
    }));
    writeFileSync(join(root, 'first.zip'), storedZipEntries(entries));
    writeFileSync(join(root, 'second.zip'), storedZipEntries(entries));

    expect(() => scanFiles(root, ['first.zip', 'second.zip'])).toThrow(/global archive entry limit exceeded/);
  });

  it('fails closed on recognized archive formats it cannot decompress', () => {
    const root = temporaryDirectory();
    writeFileSync(join(root, 'unsupported.xz'), Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]));

    expect(() => scanFiles(root, ['unsupported.xz'])).toThrow(/unsupported archive compression or format/);
  });

  it('scans files selected by the npm pack manifest', () => {
    const root = temporaryDirectory();
    const value = canary();
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'scanner-canary', version: '1.0.0', files: ['dist'] }));
    writeFileSync(join(root, 'dist', 'packed.txt'), `token=${value}\n`);

    const findings = scanRepository(root, { includeTracked: false, includePack: true });

    expect(findings).toContainEqual({ path: 'dist/packed.txt', patternId: 'anthropic-api-key' });
    expect(JSON.stringify(findings)).not.toContain(value);
  });
});
