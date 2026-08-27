#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_ARCHIVE_DEPTH = 2;

function createArchiveBudget() {
  return { entries: 0, expandedBytes: 0 };
}

function consumeArchiveBudget(budget, bytes, countEntry = true) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('invalid archive expansion size');
  if (countEntry && budget.entries + 1 > MAX_ARCHIVE_ENTRIES) {
    throw new Error('global archive entry limit exceeded');
  }
  if (budget.expandedBytes + bytes > MAX_ARCHIVE_TOTAL_BYTES) {
    throw new Error('global archive decompressed-byte limit exceeded');
  }
  if (countEntry) budget.entries += 1;
  budget.expandedBytes += bytes;
}

const PROVIDER_PATTERNS = Object.freeze([
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['anthropic-api-key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ['openai-api-key', /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g],
  ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{40,255}\b/g],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36,255}\b/g],
  ['e2b-api-key', /\be2b_[A-Za-z0-9_-]{20,255}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['stripe-live-key', /\b(?:sk|rk)_live_[0-9A-Za-z]{20,255}\b/g],
  ['jwt-token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
]);

const ASSIGNMENT_PATTERN = /(?:^|[\s,{;])(?:[A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET|PRIVATE_KEY|PASSWORD|SECRET|TOKEN)|apiKey|accessKey|accessToken|authToken|clientSecret|password|privateKey|secret|token)\s*[:=]\s*["'`]?([^"'`\s,;}]{16,})/gim;
const PLACEHOLDER_VALUE = /(?:example|placeholder|replace|redacted|dummy|sample|your[_-]|process\.env|os\.environ|getenv|\$\{|<[^>]+>|x{8,})/i;

function command(commandName, args, cwd, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || '').trim().split('\n')[0];
    throw new Error(`${commandName} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function isInside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function normalizeRepositoryPath(root, candidate) {
  const absolute = resolve(root, candidate);
  if (!isInside(root, absolute)) throw new Error('scanner input escaped repository root');
  return absolute;
}

function redactSecretShapes(value) {
  let safe = value.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 1_024);
  for (const [, pattern] of PROVIDER_PATTERNS) {
    pattern.lastIndex = 0;
    safe = safe.replace(pattern, '[redacted]');
  }
  return safe;
}

function displayPath(root, absolute) {
  return redactSecretShapes(relative(root, absolute).split(sep).join('/'));
}

function looksTextual(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  if (sample.includes(0)) return false;
  let controls = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) controls += 1;
  }
  return sample.length === 0 || controls / sample.length < 0.02;
}

function assignmentSensitivePath(virtualPath) {
  const innerPath = virtualPath.split('!').at(-1) || virtualPath;
  const name = innerPath.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() || '';
  if (['.npmrc', '.pypirc', '.netrc'].includes(name)) return true;
  return /^\.env(?:\.|$)/.test(name) && !/(?:example|sample|template|dist|defaults?)/.test(name);
}

function scanText(text, virtualPath) {
  const findings = [];
  for (const [patternId, pattern] of PROVIDER_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push({ path: virtualPath, patternId });
  }

  if (assignmentSensitivePath(virtualPath)) {
    ASSIGNMENT_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(ASSIGNMENT_PATTERN)) {
      const value = match[1] || '';
      if (!PLACEHOLDER_VALUE.test(value)) {
        findings.push({ path: virtualPath, patternId: 'credential-assignment' });
        break;
      }
    }
  }
  return findings;
}

function boundedInflate(method, compressed, expectedSize) {
  if (expectedSize > MAX_ARCHIVE_ENTRY_BYTES) throw new Error('archive entry exceeds size limit');
  let output;
  if (method === 0) output = compressed;
  else if (method === 8) output = inflateRawSync(compressed, { maxOutputLength: MAX_ARCHIVE_ENTRY_BYTES });
  else throw new Error(`unsupported ZIP compression method ${method}`);
  if (output.length > MAX_ARCHIVE_ENTRY_BYTES) throw new Error('archive entry exceeds size limit');
  if (expectedSize !== 0xffffffff && output.length !== expectedSize) {
    throw new Error('archive entry size mismatch');
  }
  return output;
}

function findZipEnd(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('zip end record not found');
}

function zipEntries(buffer, budget) {
  const endOffset = findZipEnd(buffer);
  const count = buffer.readUInt16LE(endOffset + 10);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (count > MAX_ARCHIVE_ENTRIES || count === 0xffff || centralOffset === 0xffffffff) {
    throw new Error('zip entry limit or ZIP64 unsupported');
  }

  const entries = [];
  let offset = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('invalid zip central directory');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd > buffer.length) throw new Error('invalid zip entry name');
    const name = buffer.subarray(offset + 46, nameEnd).toString('utf8').replaceAll('\\', '/');
    offset = nameEnd + extraLength + commentLength;

    if (flags & 0x1) throw new Error('encrypted zip entries are unsupported');
    if (name.endsWith('/')) continue;
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff) throw new Error('ZIP64 unsupported');
    if (totalBytes + uncompressedSize > MAX_ARCHIVE_TOTAL_BYTES) throw new Error('archive total exceeds size limit');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('invalid zip local header');
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error('zip entry exceeds archive bounds');
    consumeArchiveBudget(budget, uncompressedSize);
    const data = boundedInflate(method, buffer.subarray(dataStart, dataEnd), uncompressedSize);
    if (data) {
      totalBytes += data.length;
      entries.push({ name: redactSecretShapes(name), data });
    }
  }
  return entries;
}

function parseTarSize(field) {
  const text = field.toString('ascii').replaceAll('\0', '').trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error('invalid tar entry size');
  return Number.parseInt(text, 8);
}

function tarEntries(buffer, budget) {
  const entries = [];
  let offset = 0;
  let totalBytes = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replaceAll('\0', '');
    const prefix = header.subarray(345, 500).toString('utf8').replaceAll('\0', '');
    const path = `${prefix ? `${prefix}/` : ''}${name}`.replaceAll('\\', '/');
    const size = parseTarSize(header.subarray(124, 136));
    const type = header[156];
    if (size > MAX_ARCHIVE_ENTRY_BYTES || totalBytes + size > MAX_ARCHIVE_TOTAL_BYTES) {
      throw new Error('tar entry exceeds size limit');
    }
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) throw new Error('tar entry exceeds archive bounds');
    if (type === 0 || type === 48) {
      consumeArchiveBudget(budget, size);
      const data = buffer.subarray(dataStart, dataEnd);
      totalBytes += data.length;
      entries.push({ name: redactSecretShapes(path), data });
      if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('tar entry limit exceeded');
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function isTar(buffer) {
  return buffer.length >= 512 && buffer.subarray(257, 262).toString('ascii') === 'ustar';
}

function archiveKind(path, buffer) {
  const lower = path.toLowerCase();
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) return 'zip';
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return 'gzip';
  if (isTar(buffer)) return 'tar';
  if ((buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'BZh')
    || (buffer.length >= 6 && buffer.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])))
    || (buffer.length >= 6 && buffer.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])))
    || (buffer.length >= 7 && buffer.subarray(0, 7).equals(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])))
    || /\.(?:7z|bz2|rar|xz)$/i.test(lower)) return 'unsupported';
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.gz')) return 'gzip';
  return null;
}

function scanBuffer(buffer, virtualPath, budget, depth = 0) {
  const kind = archiveKind(virtualPath, buffer);
  if (kind === 'unsupported') throw new Error('unsupported archive compression or format');
  if (kind && depth >= MAX_ARCHIVE_DEPTH) throw new Error('archive nesting exceeds limit');
  if (kind) {
    let entries;
    if (kind === 'zip') entries = zipEntries(buffer, budget);
    else if (kind === 'tar') entries = tarEntries(buffer, budget);
    else {
      const remaining = MAX_ARCHIVE_TOTAL_BYTES - budget.expandedBytes;
      if (remaining < 1) throw new Error('global archive decompressed-byte limit exceeded');
      let expanded;
      try {
        expanded = gunzipSync(buffer, { maxOutputLength: remaining });
      } catch (error) {
        if ((error && typeof error === 'object' && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE')
          || (error instanceof RangeError && /larger than/i.test(error.message))) {
          throw new Error('global archive decompressed-byte limit exceeded');
        }
        throw error;
      }
      consumeArchiveBudget(budget, expanded.length, false);
      entries = isTar(expanded)
        ? tarEntries(expanded, budget)
        : (() => {
          consumeArchiveBudget(budget, 0);
          return [{ name: virtualPath.replace(/\.gz$/i, ''), data: expanded }];
        })();
    }
    return entries.flatMap(({ name, data }) => scanBuffer(data, `${virtualPath}!${name}`, budget, depth + 1));
  }
  if (!looksTextual(buffer)) return [];
  return scanText(buffer.toString('utf8'), virtualPath);
}

export function trackedFiles(root) {
  const stdout = command('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root);
  return stdout.split('\0').filter(Boolean);
}

export function npmPackFiles(root) {
  const stdout = command('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], root);
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || !Array.isArray(result[0]?.files)) throw new Error('npm pack returned an invalid file list');
  return result[0].files.map((entry) => entry.path);
}

export function scanFiles(root, candidates) {
  const findings = [];
  const unique = [...new Set(candidates)].sort();
  const archiveBudget = createArchiveBudget();
  for (const candidate of unique) {
    const absolute = normalizeRepositoryPath(root, candidate);
    let stat;
    try {
      const linkStat = lstatSync(absolute, { throwIfNoEntry: false });
      if (linkStat?.isSymbolicLink() && !isInside(root, realpathSync(absolute))) {
        throw new Error('symbolic link escaped repository root');
      }
      stat = statSync(absolute, { throwIfNoEntry: false });
    } catch (error) {
      throw new Error(`cannot inspect ${displayPath(root, absolute)}: ${error.message}`);
    }
    if (!stat || !stat.isFile()) continue;
    if (stat.size > MAX_FILE_BYTES) throw new Error(`file exceeds scanner limit: ${displayPath(root, absolute)}`);
    try {
      findings.push(...scanBuffer(readFileSync(absolute), displayPath(root, absolute), archiveBudget));
    } catch (error) {
      throw new Error(`cannot scan ${displayPath(root, absolute)}: ${error.message}`);
    }
  }
  const keyed = new Map(findings.map((finding) => [`${finding.path}\0${finding.patternId}`, finding]));
  return [...keyed.values()].sort((left, right) =>
    left.path.localeCompare(right.path) || left.patternId.localeCompare(right.patternId));
}

export function scanRepository(root, options = {}) {
  const candidates = [];
  if (options.includeTracked !== false) candidates.push(...trackedFiles(root));
  if (options.includePack !== false) candidates.push(...npmPackFiles(root));
  return scanFiles(root, candidates);
}

function parseRoot(argv) {
  if (argv.length === 0) return process.cwd();
  if (argv.length === 2 && argv[0] === '--root') return resolve(argv[1]);
  throw new Error('usage: scan-secrets.mjs [--root <repository>]');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const root = parseRoot(process.argv.slice(2));
    const findings = scanRepository(root);
    if (findings.length) {
      console.error(`Secret scan failed with ${findings.length} finding(s):`);
      for (const finding of findings) console.error(`${finding.path}: ${finding.patternId}`);
      process.exitCode = 1;
    } else {
      console.log('Secret scan passed.');
    }
  } catch (error) {
    console.error(`Secret scan error: ${error.message}`);
    process.exitCode = 2;
  }
}
