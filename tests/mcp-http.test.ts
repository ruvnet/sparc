import { request } from 'node:http';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SparcStore } from '../src/store.js';
import { evidenceAttestationBytes } from '../src/domain.js';
import { SPARC_READ_SCOPE, SPARC_WRITE_SCOPE } from '../src/mcp/auth.js';
import {
  MAX_MCP_REQUEST_BYTES,
  createSparcMcpHttpRuntime,
  startSparcMcpHttpServer,
  type StartedSparcMcpHttpServer,
} from '../src/mcp/http.js';
import { MAX_PAGE_BYTES, SPARC_TOOL_INPUT_SCHEMAS } from '../src/mcp/server.js';

const OPERATOR_TOKEN = 'a'.repeat(64);
const READER_TOKEN = 'b'.repeat(64);
const OTHER_TOKEN = 'c'.repeat(64);

function payload(result: unknown): Record<string, unknown> {
  const structured = (result as { structuredContent?: unknown }).structuredContent;
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) {
    throw new Error('tool result has no structuredContent');
  }
  return structured as Record<string, unknown>;
}

function resourceText(result: unknown): string {
  const content = (result as { contents?: unknown[] }).contents?.[0] as { text?: unknown } | undefined;
  if (!content || typeof content.text !== 'string') throw new Error('resource is not text');
  return content.text;
}

async function connect(url: URL, token: string): Promise<Client> {
  const client = new Client(
    { name: 'sparc-mcp-test', version: '1.0.0' },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  // SDK 1.30's Transport declaration is not exactOptionalPropertyTypes-safe.
  await client.connect(transport as unknown as Transport);
  return client;
}

function rawRequest(
  url: URL,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      method: 'POST',
      headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

describe('SPARC stateless Streamable HTTP MCP', () => {
  let stateRoot: string;
  let started: StartedSparcMcpHttpServer;
  let store: SparcStore;
  let verifierPrivateKey: KeyObject;

  beforeAll(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), 'sparc-mcp-http-'));
    const verifier = generateKeyPairSync('ed25519');
    verifierPrivateKey = verifier.privateKey;
    store = new SparcStore({
      stateRoot,
      evidenceVerifierKeys: {
        'verifier-one': verifier.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
    });
    const isolationRun = store.createRun({
      principalId: 'operator-one',
      runId: 'isolation-seed',
      title: 'Principal isolation seed',
      requirements: [{
        id: 'REQ-SEED', statement: 'Remain isolated', inScope: true, acceptanceTestIds: ['TEST-SEED'],
      }],
      acceptanceTests: [{ id: 'TEST-SEED', description: 'Other principals cannot read this run' }],
      expectedRevision: 0,
      idempotencyKey: 'create-isolation-seed',
    });
    let isolationRevision = isolationRun.revision;
    for (let index = 1; index <= 3; index += 1) {
      const artifact = store.putArtifact({
        principalId: 'operator-one',
        runId: 'isolation-seed',
        phase: 'Specification',
        artifactId: `seed-artifact-${index}`,
        content: { index, purpose: 'pagination boundary' },
        expectedRevision: isolationRevision,
        idempotencyKey: `create-seed-artifact-${index}`,
      });
      isolationRevision = artifact.revision;
    }
    const largeRun = store.createRun({
      principalId: 'operator-one',
      runId: 'large-page-seed',
      title: 'Byte bounded page seed',
      requirements: [{
        id: 'REQ-LARGE', statement: 'Bound serialized pages', inScope: true, acceptanceTestIds: ['TEST-LARGE'],
      }],
      acceptanceTests: [{ id: 'TEST-LARGE', description: 'No page exceeds its byte budget' }],
      expectedRevision: 0,
      idempotencyKey: 'create-large-page-seed',
    });
    let largeRevision = largeRun.revision;
    for (let index = 1; index <= 3; index += 1) {
      const artifact = store.putArtifact({
        principalId: 'operator-one',
        runId: 'large-page-seed',
        phase: 'Specification',
        artifactId: `large-artifact-${index}`,
        content: { index, payload: 'x'.repeat(220 * 1024) },
        expectedRevision: largeRevision,
        idempotencyKey: `create-large-artifact-${index}`,
      });
      largeRevision = artifact.revision;
    }
    started = await startSparcMcpHttpServer({
      store,
      port: 0,
      auth: {
        bearerPrincipals: [
          {
            token: OPERATOR_TOKEN,
            principalId: 'operator-one',
            scopes: [SPARC_READ_SCOPE, SPARC_WRITE_SCOPE],
          },
          {
            token: READER_TOKEN,
            principalId: 'operator-one',
            scopes: [SPARC_READ_SCOPE],
          },
          {
            token: OTHER_TOKEN,
            principalId: 'operator-two',
            scopes: [SPARC_READ_SCOPE, SPARC_WRITE_SCOPE],
          },
        ],
      },
    });
  });

  afterAll(async () => {
    await started.close();
    await rm(stateRoot, { recursive: true, force: true });
  });

  it('initializes with the official client and exposes exactly the eight bounded tools', async () => {
    const client = await connect(started.url, OPERATOR_TOKEN);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        'sparc_run_get',
        'sparc_phase_get',
        'sparc_gate_validate',
        'sparc_trace_get',
        'sparc_run_start',
        'sparc_phase_submit',
        'sparc_evidence_record',
        'sparc_phase_advance',
      ]);
      for (const tool of listed.tools.slice(0, 4)) {
        expect(tool.annotations).toEqual(expect.objectContaining({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        }));
      }
      for (const tool of listed.tools.slice(4)) {
        expect(tool.annotations).toEqual(expect.objectContaining({
          readOnlyHint: false,
          destructiveHint: tool.name === 'sparc_phase_advance',
          idempotentHint: true,
          openWorldHint: false,
        }));
        const required = (tool.inputSchema as { required?: string[] }).required ?? [];
        expect(required).toEqual(expect.arrayContaining(['expectedRevision', 'idempotencyKey']));
      }
      for (const tool of listed.tools) {
        expect(tool.inputSchema).toEqual(
          SPARC_TOOL_INPUT_SCHEMAS[tool.name as keyof typeof SPARC_TOOL_INPUT_SCHEMAS],
        );
      }
      expect(listed.tools.some((tool) => /shell|exec|file|git|deploy|delete/i.test(tool.name)))
        .toBe(false);

      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toEqual([
        'sparc://methodology/v1',
        'sparc://schemas/artifact/v1',
      ]);
      const methodology = await client.readResource({ uri: 'sparc://methodology/v1' });
      expect(JSON.parse(resourceText(methodology))).toEqual(expect.objectContaining({
        phases: ['Specification', 'Pseudocode', 'Architecture', 'Refinement', 'Completion'],
      }));
      const artifactSchema = await client.readResource({ uri: 'sparc://schemas/artifact/v1' });
      expect(JSON.parse(resourceText(artifactSchema))).toEqual(expect.objectContaining({
        $id: 'sparc://schemas/artifact/v1',
        additionalProperties: false,
      }));

      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toEqual([
        'sparc_start',
        'sparc_resume',
        'sparc_gate_review',
      ]);
      const prompt = await client.getPrompt({
        name: 'sparc_start', arguments: { goal: 'Deliver an auditable service' },
      });
      expect(prompt.messages[0]?.content).toEqual(expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('Deliver an auditable service'),
      }));
      const unknownField = await client.callTool({
        name: 'sparc_run_get',
        arguments: { runId: 'not-created', unexpected: true },
      });
      expect(unknownField.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('returns bounded summaries and revision-bound phase and trace pages', async () => {
    const client = await connect(started.url, OPERATOR_TOKEN);
    try {
      const summary = payload(await client.callTool({
        name: 'sparc_run_get', arguments: { runId: 'isolation-seed' },
      })).run as Record<string, unknown>;
      expect(summary).toEqual(expect.objectContaining({
        runId: 'isolation-seed',
        counts: expect.objectContaining({ artifacts: 3, requirements: 1, acceptanceTests: 1 }),
      }));
      for (const omitted of ['requirements', 'acceptanceTests', 'artifacts', 'evidence', 'corrections', 'receipts']) {
        expect(summary).not.toHaveProperty(omitted);
      }
      expect(Buffer.byteLength(JSON.stringify(summary), 'utf8')).toBeLessThan(4_096);

      const largeSummary = payload(await client.callTool({
        name: 'sparc_run_get', arguments: { runId: 'large-page-seed' },
      })).run as Record<string, unknown>;
      expect(largeSummary).not.toHaveProperty('artifacts');
      expect(largeSummary).toEqual(expect.objectContaining({
        counts: expect.objectContaining({ artifacts: 3 }),
      }));
      expect(Buffer.byteLength(JSON.stringify(largeSummary), 'utf8')).toBeLessThan(4_096);

      const largeFirst = payload(await client.callTool({
        name: 'sparc_phase_get',
        arguments: { runId: 'large-page-seed', phase: 'Specification', limit: 25 },
      }));
      const largeFirstPage = largeFirst.pagination as {
        returned: number; total: number; serializedBytes: number; nextCursor?: string;
      };
      expect(largeFirstPage).toEqual(expect.objectContaining({
        returned: 2,
        total: 3,
        serializedBytes: expect.any(Number),
      }));
      expect(largeFirstPage.serializedBytes).toBeLessThanOrEqual(MAX_PAGE_BYTES);
      expect(Buffer.byteLength(JSON.stringify(largeFirst.entries), 'utf8'))
        .toBe(largeFirstPage.serializedBytes);
      const largeSecond = payload(await client.callTool({
        name: 'sparc_phase_get',
        arguments: {
          runId: 'large-page-seed',
          phase: 'Specification',
          cursor: largeFirstPage.nextCursor,
          limit: 25,
        },
      }));
      expect(largeSecond.entries as unknown[]).toHaveLength(1);
      expect(largeSecond.pagination as Record<string, unknown>).not.toHaveProperty('nextCursor');

      const firstPhase = payload(await client.callTool({
        name: 'sparc_phase_get',
        arguments: { runId: 'isolation-seed', phase: 'Specification', limit: 2 },
      }));
      const firstEntries = firstPhase.entries as Array<{ id: string }>;
      const firstPagination = firstPhase.pagination as {
        returned: number; total: number; nextCursor?: string;
      };
      expect(firstEntries).toHaveLength(2);
      expect(firstPagination).toEqual(expect.objectContaining({ returned: 2, total: 3 }));
      expect(firstPagination.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);

      const secondPhase = payload(await client.callTool({
        name: 'sparc_phase_get',
        arguments: {
          runId: 'isolation-seed',
          phase: 'Specification',
          cursor: firstPagination.nextCursor,
          limit: 2,
        },
      }));
      const secondEntries = secondPhase.entries as Array<{ id: string }>;
      expect(secondEntries).toHaveLength(1);
      expect((secondPhase.pagination as Record<string, unknown>)).not.toHaveProperty('nextCursor');
      expect(new Set([...firstEntries, ...secondEntries].map((entry) => entry.id)).size).toBe(3);

      const firstTrace = payload(await client.callTool({
        name: 'sparc_trace_get', arguments: { runId: 'isolation-seed', limit: 3 },
      }));
      const tracePagination = firstTrace.pagination as { total: number; nextCursor?: string };
      expect(firstTrace.entries as unknown[]).toHaveLength(3);
      expect(tracePagination.total).toBeGreaterThan(3);
      expect(tracePagination.nextCursor).toBeTypeOf('string');
      const secondTrace = payload(await client.callTool({
        name: 'sparc_trace_get',
        arguments: { runId: 'isolation-seed', cursor: tracePagination.nextCursor, limit: 3 },
      }));
      const firstTraceIds = (firstTrace.entries as Array<{ id: string }>).map((entry) => entry.id);
      const secondTraceIds = (secondTrace.entries as Array<{ id: string }>).map((entry) => entry.id);
      expect(firstTraceIds.some((id) => secondTraceIds.includes(id))).toBe(false);

      const beforeMutation = store.getRun({ principalId: 'operator-one', runId: 'isolation-seed' });
      store.putArtifact({
        principalId: 'operator-one',
        runId: 'isolation-seed',
        phase: 'Specification',
        artifactId: 'seed-artifact-4',
        content: { index: 4, purpose: 'invalidate prior cursors' },
        expectedRevision: beforeMutation.revision,
        idempotencyKey: 'create-seed-artifact-4',
      });
      const staleCursor = await client.callTool({
        name: 'sparc_phase_get',
        arguments: {
          runId: 'isolation-seed',
          phase: 'Specification',
          cursor: firstPagination.nextCursor,
          limit: 2,
        },
      });
      expect(staleCursor.isError).toBe(true);
      expect((payload(staleCursor).error as { code: string }).code).toBe('INVALID_CURSOR');

      const malformedCursor = await client.callTool({
        name: 'sparc_trace_get',
        arguments: { runId: 'isolation-seed', cursor: 'not-a-valid-cursor', limit: 1 },
      });
      expect(malformedCursor.isError).toBe(true);
      const excessiveLimit = await client.callTool({
        name: 'sparc_trace_get', arguments: { runId: 'isolation-seed', limit: 26 },
      });
      expect(excessiveLimit.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('enforces revision, phase, idempotency, read purity and receipt verification', async () => {
    const client = await connect(started.url, OPERATOR_TOKEN);
    try {
      const startArguments = {
        runId: 'run-http-one',
        title: 'HTTP lifecycle validation',
        requirements: [{
          id: 'REQ-1',
          statement: 'The run must be revision guarded',
          inScope: true,
          acceptanceTestIds: ['TEST-1'],
        }],
        acceptanceTests: [{
          id: 'TEST-1',
          description: 'A stale revision is rejected',
        }],
        expectedRevision: 0,
        idempotencyKey: 'start-http-run-one',
      };
      const created = payload(await client.callTool({
        name: 'sparc_run_start', arguments: startArguments,
      }));
      expect(created.ok).toBe(true);
      const startRevision = created.revision as number;

      const replay = payload(await client.callTool({
        name: 'sparc_run_start', arguments: startArguments,
      }));
      expect(replay.revision).toBe(startRevision);

      const before = payload(await client.callTool({
        name: 'sparc_run_get', arguments: { runId: 'run-http-one' },
      }));
      const beforeRun = before.run as {
        digest: string;
        genesisDigest: string;
        requirementsDigest: string;
      };
      const beforeDigest = beforeRun.digest;
      const gate = payload(await client.callTool({
        name: 'sparc_gate_validate', arguments: { runId: 'run-http-one' },
      }));
      expect((gate.gate as { ok: boolean }).ok).toBe(false);
      const after = payload(await client.callTool({
        name: 'sparc_run_get', arguments: { runId: 'run-http-one' },
      }));
      expect((after.run as { digest: string }).digest).toBe(beforeDigest);

      const submitted = payload(await client.callTool({
        name: 'sparc_phase_submit',
        arguments: {
          runId: 'run-http-one',
          phase: 'Specification',
          content: { outcome: 'A revision guarded run' },
          expectedRevision: startRevision,
          idempotencyKey: 'submit-http-specification',
        },
      }));
      expect(submitted.ok).toBe(true);

      const crossPhaseReplay = await client.callTool({
        name: 'sparc_phase_submit',
        arguments: {
          runId: 'run-http-one',
          phase: 'Pseudocode',
          content: { outcome: 'A revision guarded run' },
          expectedRevision: startRevision,
          idempotencyKey: 'submit-http-specification',
        },
      });
      expect(crossPhaseReplay.isError).toBe(true);
      expect((payload(crossPhaseReplay).error as { code: string }).code)
        .toBe('IDEMPOTENCY_MISMATCH');

      const evidenceRevision = submitted.revision as number;
      const evidenceBase = {
        runId: 'run-http-one',
        evidenceId: 'EVIDENCE-1',
        requirementId: 'REQ-1',
        testId: 'TEST-1',
        status: 'pass' as const,
        summary: 'The revision conflict test passed',
        details: { runner: 'vitest' },
        expectedRevision: evidenceRevision,
      };
      const missingAttestation = await client.callTool({
        name: 'sparc_evidence_record',
        arguments: { ...evidenceBase, idempotencyKey: 'missing-evidence-attestation' },
      });
      expect(missingAttestation.isError).toBe(true);

      const issuedAt = new Date().toISOString();
      const malformedAttestation = await client.callTool({
        name: 'sparc_evidence_record',
        arguments: {
          ...evidenceBase,
          idempotencyKey: 'malformed-evidence-attestation',
          attestation: {
            keyId: 'verifier-one',
            issuedAt,
            algorithm: 'Ed25519',
            signature: 'not-base64url',
          },
        },
      });
      expect(malformedAttestation.isError).toBe(true);

      const forgedAttestation = await client.callTool({
        name: 'sparc_evidence_record',
        arguments: {
          ...evidenceBase,
          idempotencyKey: 'forged-evidence-attestation',
          attestation: {
            keyId: 'verifier-one',
            issuedAt,
            algorithm: 'Ed25519',
            signature: 'A'.repeat(86),
          },
        },
      });
      expect(forgedAttestation.isError).toBe(true);
      expect((payload(forgedAttestation).error as { code: string }).code).toBe('VALIDATION');

      const signature = sign(null, evidenceAttestationBytes({
        principalId: 'operator-one',
        runId: evidenceBase.runId,
        genesisDigest: beforeRun.genesisDigest,
        requirementsDigest: beforeRun.requirementsDigest,
        expectedRevision: evidenceBase.expectedRevision,
        phase: 'Specification',
        evidenceId: evidenceBase.evidenceId,
        requirementId: evidenceBase.requirementId,
        testId: evidenceBase.testId,
        status: evidenceBase.status,
        summary: evidenceBase.summary,
        details: evidenceBase.details,
        attestation: { keyId: 'verifier-one', issuedAt, algorithm: 'Ed25519' },
      }), verifierPrivateKey).toString('base64url');
      const recordedEvidence = payload(await client.callTool({
        name: 'sparc_evidence_record',
        arguments: {
          ...evidenceBase,
          idempotencyKey: 'valid-evidence-attestation',
          attestation: { keyId: 'verifier-one', issuedAt, algorithm: 'Ed25519', signature },
        },
      }));
      expect(recordedEvidence.ok).toBe(true);
      expect((recordedEvidence.value as { attestation: Record<string, unknown> }).attestation)
        .toEqual(expect.objectContaining({
          keyId: 'verifier-one',
          issuedAt,
          algorithm: 'Ed25519',
          signature,
          verified: true,
        }));

      const stale = await client.callTool({
        name: 'sparc_phase_submit',
        arguments: {
          runId: 'run-http-one',
          phase: 'Specification',
          content: { outcome: 'A stale write' },
          expectedRevision: startRevision,
          idempotencyKey: 'submit-stale-specification',
        },
      });
      expect(stale.isError).toBe(true);
      expect((payload(stale).error as { code: string }).code).toBe('CAS_MISMATCH');

      const trace = payload(await client.callTool({
        name: 'sparc_trace_get', arguments: { runId: 'run-http-one' },
      }));
      expect((trace.verification as { ok: boolean }).ok).toBe(true);
      expect((trace.entries as Array<{ kind: string }>).some((entry) => entry.kind === 'receipt'))
        .toBe(true);
    } finally {
      await client.close();
    }
  });

  it('enforces write scope and principal isolation', async () => {
    const reader = await connect(started.url, READER_TOKEN);
    const other = await connect(started.url, OTHER_TOKEN);
    try {
      const denied = await reader.callTool({
        name: 'sparc_run_start',
        arguments: {
          runId: 'reader-run',
          title: 'Must not be created',
          requirements: [{
            id: 'REQ-X', statement: 'Denied', inScope: true, acceptanceTestIds: ['TEST-X'],
          }],
          acceptanceTests: [{ id: 'TEST-X', description: 'Denied' }],
          expectedRevision: 0,
          idempotencyKey: 'reader-denied-write',
        },
      });
      expect(denied.isError).toBe(true);
      expect((payload(denied).error as { code: string }).code).toBe('FORBIDDEN');

      const isolated = await other.callTool({
        name: 'sparc_run_get', arguments: { runId: 'isolation-seed' },
      });
      expect(isolated.isError).toBe(true);
      expect((payload(isolated).error as { code: string }).code).toBe('NOT_FOUND');
    } finally {
      await Promise.all([reader.close(), other.close()]);
    }
  });

  it('rejects host rebinding and oversized request bodies before MCP dispatch', async () => {
    const initialization = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'raw-test', version: '1.0.0' },
      },
    });
    const rebinding = await rawRequest(started.url, {
      host: 'attacker.example',
      authorization: `Bearer ${OPERATOR_TOKEN}`,
      'content-type': 'application/json',
    }, initialization);
    expect(rebinding.status).toBe(421);

    const oversized = await rawRequest(started.url, {
      authorization: `Bearer ${OPERATOR_TOKEN}`,
      'content-type': 'application/json',
    }, ' '.repeat(MAX_MCP_REQUEST_BYTES + 1));
    expect(oversized.status).toBe(413);
  });

  it('refuses an unauthenticated public proxy host configuration', () => {
    expect(() => createSparcMcpHttpRuntime({
      store,
      allowedHosts: ['sparc.example.test'],
      auth: { anonymousLoopbackPrincipalId: 'local-user' },
    })).toThrow(/require JWT or static bearer/);
  });

  it('serves RFC 9728 metadata at the path-derived well-known endpoint', async () => {
    const metadataServer = await startSparcMcpHttpServer({
      store,
      port: 0,
      auth: {
        jwt: {
          issuer: 'https://identity.example.test/tenant',
          audience: 'sparc-api',
          jwksUrl: 'https://identity.example.test/tenant/keys',
          resource: 'https://sparc.example.test/api/mcp',
        },
      },
    });
    try {
      const endpoint = new URL(
        '/.well-known/oauth-protected-resource/api/mcp',
        metadataServer.url,
      );
      const response = await fetch(endpoint);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        resource: 'https://sparc.example.test/api/mcp',
        authorization_servers: ['https://identity.example.test/tenant'],
      }));
      const fallback = await fetch(new URL('/.well-known/oauth-protected-resource', metadataServer.url));
      expect(fallback.status).toBe(200);
      await expect(fallback.json()).resolves.toEqual(expect.objectContaining({
        resource: 'https://sparc.example.test/api/mcp',
      }));
    } finally {
      await metadataServer.close();
    }
  });
});
