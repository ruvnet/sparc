import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';

const execute = promisify(execFile);

describe('SPARC stdio MCP', () => {
  let stateRoot: string;

  beforeAll(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), 'sparc-mcp-stdio-'));
    await execute(process.execPath, [
      'node_modules/typescript/bin/tsc',
      '-p',
      'tsconfig.build.json',
    ], { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 });
  }, 30_000);

  afterAll(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it('initializes, lists and calls tools through the official spawned stdio client', async () => {
    const bootstrap = [
      "import { SparcStore } from './dist/store.js';",
      "import { startSparcStdioServer } from './dist/mcp/stdio.js';",
      "const store = new SparcStore({ stateRoot: process.env.SPARC_TEST_STATE_ROOT });",
      "await startSparcStdioServer({ store, principalId: 'stdio-test' });",
    ].join('\n');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--input-type=module', '--eval', bootstrap],
      cwd: process.cwd(),
      stderr: 'pipe',
      env: {
        ...getDefaultEnvironment(),
        SPARC_TEST_STATE_ROOT: stateRoot,
      },
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    const client = new Client(
      { name: 'sparc-stdio-test', version: '1.0.0' },
      { capabilities: {} },
    );
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(8);
      const created = await client.callTool({
        name: 'sparc_run_start',
        arguments: {
          runId: 'stdio-run',
          title: 'Stdio lifecycle',
          requirements: [{
            id: 'REQ-STDIO',
            statement: 'Stdio must preserve the MCP framing stream',
            inScope: true,
            acceptanceTestIds: ['TEST-STDIO'],
          }],
          acceptanceTests: [{
            id: 'TEST-STDIO',
            description: 'The official stdio client initializes and calls a tool',
          }],
          expectedRevision: 0,
          idempotencyKey: 'start-stdio-run',
        },
      });
      expect(created.isError).not.toBe(true);
      expect(created.structuredContent).toEqual(expect.objectContaining({ ok: true }));
      const fetched = await client.callTool({
        name: 'sparc_run_get', arguments: { runId: 'stdio-run' },
      });
      expect(fetched.structuredContent).toEqual(expect.objectContaining({ ok: true }));
      expect(stderr).toBe('');
    } finally {
      await client.close();
    }
  }, 30_000);
});
