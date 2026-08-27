import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli, type CliIo } from '../src/cli.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sparc-cli-'));
  roots.push(root);
  return root;
}

function capture(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (value: string | Uint8Array) => { stdout.push(String(value)); return true; } },
      stderr: { write: (value: string | Uint8Array) => { stderr.push(String(value)); return true; } },
    },
  };
}

describe('npx CLI', () => {
  it('reports the exact package version', async () => {
    const output = capture();
    await expect(runCli(['version'], output.io)).resolves.toBe(0);
    expect(output.stdout.join('')).toBe('1.0.0\n');
  });

  it('creates an isolated run and makes a blocked gate observable by exit code', async () => {
    const root = await temporaryRoot();
    const definition = join(root, 'definition.json');
    await writeFile(definition, JSON.stringify({
      requirements: [{ id: 'REQ-1', statement: 'Observable result', inScope: true, acceptanceTestIds: ['TEST-1'] }],
      acceptanceTests: [{ id: 'TEST-1', description: 'Result is observed' }],
    }));
    const started = capture();
    await expect(runCli([
      'start', '--root', join(root, 'state'), '--principal', 'alice', '--run-id', 'run-1',
      '--title', 'CLI test', '--definition', definition, '--idempotency-key', 'start-run-1',
    ], started.io)).resolves.toBe(0);
    expect(JSON.parse(started.stdout.join(''))).toMatchObject({ ok: true, revision: 1, phase: 'Specification' });

    const gate = capture();
    await expect(runCli([
      'gate', '--root', join(root, 'state'), '--principal', 'alice', '--run-id', 'run-1',
    ], gate.io)).resolves.toBe(2);
    expect(JSON.parse(gate.stdout.join(''))).toMatchObject({
      ok: false,
      gate: { ok: false, blockers: [{ code: 'MISSING_PHASE_ARTIFACT' }] },
    });
  });

  it('lists the three packaged skills', async () => {
    const output = capture();
    await expect(runCli(['skills', 'list'], output.io)).resolves.toBe(0);
    expect(JSON.parse(output.stdout.join(''))).toEqual({
      ok: true,
      skills: ['sparc', 'sparc-review', 'sparc-resume'],
      mcpPrerequisite: {
        serverName: 'sparc',
        command: 'npx',
        args: ['--yes', '@ruvnet/sparc@1.0.0', 'mcp', 'stdio'],
        configurationModified: false,
        requiredAction: expect.stringContaining('explicitly register'),
      },
    });
  });

  it('returns bounded run summaries and revision-bound trace pages', async () => {
    const root = await temporaryRoot();
    const state = join(root, 'state');
    const definition = join(root, 'definition.json');
    await writeFile(definition, JSON.stringify({
      requirements: [{ id: 'REQ-1', statement: 'Observable result', inScope: true, acceptanceTestIds: ['TEST-1'] }],
      acceptanceTests: [{ id: 'TEST-1', description: 'Result is observed' }],
    }));
    for (const runId of ['run-1', 'run-2', 'run-3']) {
      await expect(runCli([
        'start', '--root', state, '--principal', 'alice', '--run-id', runId,
        '--title', `CLI ${runId}`, '--definition', definition, '--idempotency-key', `start-${runId}`,
      ], capture().io)).resolves.toBe(0);
    }

    const firstList = capture();
    await expect(runCli([
      'list', '--root', state, '--principal', 'alice', '--limit', '1',
    ], firstList.io)).resolves.toBe(0);
    const firstListBody = JSON.parse(firstList.stdout.join('')) as {
      runs: Array<Record<string, unknown>>;
      nextCursor: string;
    };
    expect(firstListBody.runs).toHaveLength(1);
    expect(firstListBody.runs[0]).not.toHaveProperty('artifacts');
    expect(firstListBody.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);

    const secondList = capture();
    await expect(runCli([
      'list', '--root', state, '--principal', 'alice', '--limit', '1',
      '--cursor', firstListBody.nextCursor,
    ], secondList.io)).resolves.toBe(0);
    expect(JSON.parse(secondList.stdout.join('')).runs).toHaveLength(1);

    const status = capture();
    await expect(runCli([
      'status', '--root', state, '--principal', 'alice', '--run-id', 'run-1',
    ], status.io)).resolves.toBe(0);
    const statusBody = JSON.parse(status.stdout.join('')) as { run: Record<string, unknown> };
    expect(statusBody.run).not.toHaveProperty('requirements');
    expect(statusBody.run).toMatchObject({ counts: { requirements: 1, acceptanceTests: 1 } });

    const firstTrace = capture();
    await expect(runCli([
      'trace', '--root', state, '--principal', 'alice', '--run-id', 'run-1', '--limit', '1',
    ], firstTrace.io)).resolves.toBe(0);
    const firstTraceBody = JSON.parse(firstTrace.stdout.join('')) as {
      entries: Array<{ kind: string }>;
      pagination: { nextCursor: string; returned: number; serializedBytes: number };
    };
    expect(firstTraceBody.entries).toEqual([expect.objectContaining({ kind: 'requirement' })]);
    expect(firstTraceBody.pagination).toMatchObject({ returned: 1 });
    expect(firstTraceBody.pagination.serializedBytes).toBeLessThanOrEqual(512 * 1024);

    const secondTrace = capture();
    await expect(runCli([
      'trace', '--root', state, '--principal', 'alice', '--run-id', 'run-1', '--limit', '1',
      '--cursor', firstTraceBody.pagination.nextCursor,
    ], secondTrace.io)).resolves.toBe(0);
    expect(JSON.parse(secondTrace.stdout.join('')).entries)
      .toEqual([expect.objectContaining({ kind: 'acceptanceTest' })]);
    await expect(runCli([
      'trace', '--root', state, '--principal', 'alice', '--run-id', 'run-1', '--limit', '26',
    ], capture().io)).rejects.toThrow(/between 1 and 25/);
  });

  it('fails closed on malformed verifier key configuration', async () => {
    const root = await temporaryRoot();
    const previous = process.env.SPARC_EVIDENCE_VERIFIER_KEYS;
    process.env.SPARC_EVIDENCE_VERIFIER_KEYS = JSON.stringify({ verifier: 3 });
    try {
      await expect(runCli(['init', '--root', join(root, 'state')], capture().io))
        .rejects.toThrow(/public-key string/);
    } finally {
      if (previous === undefined) delete process.env.SPARC_EVIDENCE_VERIFIER_KEYS;
      else process.env.SPARC_EVIDENCE_VERIFIER_KEYS = previous;
    }
  });

  it('rejects unknown commands', async () => {
    await expect(runCli(['launch-missiles'], capture().io)).rejects.toThrow(/unknown command/);
  });
});
