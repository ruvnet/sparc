// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v3';
import {
  SPARC_IDENTIFIER_PATTERN,
  SPARC_PHASES,
  type JsonValue,
  type SparcPhase,
  type SparcRun,
} from '../domain.js';
import { SparcStore } from '../store.js';
import {
  SPARC_READ_SCOPE,
  SPARC_WRITE_SCOPE,
  type AuthenticatedPrincipal,
  type SparcScope,
} from './auth.js';
import { registerSparcResourcesAndPrompts } from './content.js';

const MAX_JSON_BYTES = 128 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;
export const DEFAULT_PAGE_LIMIT = 10;
export const MAX_PAGE_LIMIT = 25;
export const MAX_PAGE_BYTES = 512 * 1024;

const identifier = z.string().regex(SPARC_IDENTIFIER_PATTERN);
const runId = identifier.describe('Opaque run identifier owned by the authenticated principal.');
const idempotencyKey = identifier.describe('Bounded portable key reused only for an identical mutation.');
const expectedRevision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const phase = z.enum(SPARC_PHASES);
const boundedText = z.string().min(1).max(10_000);
const pageCursor = z.string().min(1).max(1_024).regex(/^[A-Za-z0-9_-]+$/);
const pageLimit = z.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT);

function inspectJson(value: unknown): string | undefined {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  while (stack.length > 0) {
    const next = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_JSON_NODES) return 'JSON value contains too many nodes';
    if (next.depth > MAX_JSON_DEPTH) return 'JSON value is too deeply nested';
    if (
      next.value === null
      || typeof next.value === 'boolean'
      || (typeof next.value === 'number' && Number.isFinite(next.value))
    ) continue;
    if (typeof next.value === 'string') {
      if (next.value.length > 32_768) return 'JSON string is too long';
      continue;
    }
    if (typeof next.value !== 'object') return 'value must be JSON serializable';
    if (seen.has(next.value)) return 'JSON value must not contain cycles';
    seen.add(next.value);
    if (Array.isArray(next.value)) {
      if (next.value.length > 512) return 'JSON array is too long';
      for (const child of next.value) stack.push({ value: child, depth: next.depth + 1 });
      continue;
    }
    const prototype = Object.getPrototypeOf(next.value);
    if (prototype !== Object.prototype && prototype !== null) {
      return 'JSON objects must have a plain prototype';
    }
    const entries = Object.entries(next.value as Record<string, unknown>);
    if (entries.length > 512) return 'JSON object has too many properties';
    for (const [key, child] of entries) {
      if (key.length > 256) return 'JSON property name is too long';
      stack.push({ value: child, depth: next.depth + 1 });
    }
  }
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_JSON_BYTES) {
      return 'JSON value is too large';
    }
  } catch {
    return 'value must be JSON serializable';
  }
  return undefined;
}

const jsonValue = z.unknown().superRefine((value, context) => {
  const problem = inspectJson(value);
  if (problem) context.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

const requirement = z.object({
  id: identifier,
  statement: boundedText,
  inScope: z.boolean(),
  acceptanceTestIds: z.array(identifier).max(256),
  nonGoalReason: boundedText.optional(),
}).strict();

const acceptanceTest = z.object({
  id: identifier,
  description: boundedText,
  command: z.string().min(1).max(4_000).optional(),
}).strict();

const authorization = z.object({
  authorizedBy: identifier,
  reason: boundedText,
  reference: z.string().min(1).max(1_000).optional(),
}).strict();

const evidenceAttestation = z.object({
  keyId: identifier,
  issuedAt: z.string().datetime({ offset: false, precision: 3 }),
  algorithm: z.literal('Ed25519'),
  signature: z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/),
}).strict();

const evidenceInput = z.object({
  runId,
  evidenceId: identifier,
  requirementId: identifier,
  testId: identifier.optional(),
  status: z.enum(['pass', 'fail', 'exception']),
  summary: boundedText,
  details: jsonValue.optional(),
  authorization: authorization.optional(),
  attestation: evidenceAttestation.optional(),
  expectedRevision,
  idempotencyKey,
}).strict();

export const SPARC_TOOL_INPUT_ZOD_SCHEMAS = Object.freeze({
  sparc_run_get: z.object({ runId }).strict(),
  sparc_phase_get: z.object({
    runId,
    phase: phase.optional(),
    cursor: pageCursor.optional(),
    limit: pageLimit,
  }).strict(),
  sparc_gate_validate: z.object({ runId, phase: phase.optional() }).strict(),
  sparc_trace_get: z.object({
    runId,
    cursor: pageCursor.optional(),
    limit: pageLimit,
  }).strict(),
  sparc_run_start: z.object({
    runId,
    title: z.string().min(1).max(500),
    requirements: z.array(requirement).min(1).max(256),
    acceptanceTests: z.array(acceptanceTest).min(1).max(256),
    expectedRevision: z.literal(0),
    idempotencyKey,
  }).strict(),
  sparc_phase_submit: z.object({
    runId,
    phase,
    artifactId: identifier.optional(),
    content: jsonValue,
    expectedRevision,
    idempotencyKey,
  }).strict(),
  sparc_evidence_record: evidenceInput,
  sparc_phase_advance: z.object({ runId, expectedRevision, idempotencyKey }).strict(),
} as const);

export type SparcMcpToolName = keyof typeof SPARC_TOOL_INPUT_ZOD_SCHEMAS;

/** Exact JSON Schemas advertised on the wire, reusable by MetaHarness declarations. */
export const SPARC_TOOL_INPUT_SCHEMAS: Readonly<
  Record<SparcMcpToolName, Readonly<Record<string, unknown>>>
> = Object.freeze(Object.fromEntries(
  Object.entries(SPARC_TOOL_INPUT_ZOD_SCHEMAS).map(([name, schema]) => [
    name,
    Object.freeze(toJsonSchemaCompat(schema, {
      strictUnions: true,
      pipeStrategy: 'input',
    })),
  ]),
) as Record<SparcMcpToolName, Readonly<Record<string, unknown>>>);

const READ_ONLY: ToolAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const MUTATING: ToolAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const PHASE_ADVANCING: ToolAnnotations = Object.freeze({
  ...MUTATING,
  destructiveHint: true,
});

class ToolBoundaryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type PageScope = 'phase' | 'trace';

interface PageSnapshot {
  readonly scope: PageScope;
  readonly principalId: string;
  readonly runId: string;
  readonly phase?: SparcPhase;
  readonly revision: number;
  readonly digest: string;
}

interface CursorBody extends PageSnapshot {
  readonly version: 1;
  readonly offset: number;
}

const cursorTokenSchema = z.object({
  version: z.literal(1),
  scope: z.enum(['phase', 'trace']),
  principalId: identifier,
  runId: identifier,
  phase: phase.optional(),
  revision: expectedRevision,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  offset: z.number().int().nonnegative().max(1_000_000),
  checksum: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();

function cursorChecksum(body: CursorBody): string {
  return createHash('sha256').update(JSON.stringify(body), 'utf8').digest('base64url');
}

function encodeCursor(snapshot: PageSnapshot, offset: number): string {
  const body: CursorBody = {
    version: 1,
    scope: snapshot.scope,
    principalId: snapshot.principalId,
    runId: snapshot.runId,
    ...(snapshot.phase === undefined ? {} : { phase: snapshot.phase }),
    revision: snapshot.revision,
    digest: snapshot.digest,
    offset,
  };
  return Buffer.from(JSON.stringify({ ...body, checksum: cursorChecksum(body) }), 'utf8')
    .toString('base64url');
}

function decodeCursor(encoded: string, snapshot: PageSnapshot, total: number): number {
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) throw new Error('noncanonical cursor');
    const token = cursorTokenSchema.parse(JSON.parse(bytes.toString('utf8')));
    const body: CursorBody = {
      version: token.version,
      scope: token.scope,
      principalId: token.principalId,
      runId: token.runId,
      ...(token.phase === undefined ? {} : { phase: token.phase }),
      revision: token.revision,
      digest: token.digest,
      offset: token.offset,
    };
    if (
      token.checksum !== cursorChecksum(body)
      || token.scope !== snapshot.scope
      || token.principalId !== snapshot.principalId
      || token.runId !== snapshot.runId
      || (token.phase ?? null) !== (snapshot.phase ?? null)
      || token.revision !== snapshot.revision
      || token.digest !== snapshot.digest
      || token.offset >= total
    ) {
      throw new Error('cursor does not match snapshot');
    }
    return token.offset;
  } catch {
    throw new ToolBoundaryError(
      'INVALID_CURSOR',
      'page cursor is malformed, out of range, or stale for the requested snapshot',
    );
  }
}

function paginate<T>(
  entries: readonly T[],
  cursor: string | undefined,
  limit: number,
  snapshot: PageSnapshot,
): {
  entries: readonly T[];
  pagination: {
    limit: number;
    returned: number;
    total: number;
    serializedBytes: number;
    snapshotRevision: number;
    snapshotDigest: string;
    nextCursor?: string;
  };
} {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new ToolBoundaryError('INVALID_PAGE_LIMIT', `page limit must be between 1 and ${MAX_PAGE_LIMIT}`);
  }
  const offset = cursor ? decodeCursor(cursor, snapshot, entries.length) : 0;
  const page: T[] = [];
  let serializedBytes = 2; // Opening and closing JSON array brackets.
  for (let index = offset; index < entries.length && page.length < limit; index += 1) {
    const entry = entries[index];
    if (entry === undefined) break;
    const encoded = JSON.stringify(entry);
    if (encoded === undefined) {
      throw new ToolBoundaryError('PAGE_ENTRY_INVALID', 'trace entry is not JSON serializable');
    }
    const candidateBytes = serializedBytes
      + (page.length === 0 ? 0 : 1)
      + Buffer.byteLength(encoded, 'utf8');
    if (candidateBytes > MAX_PAGE_BYTES) {
      if (page.length === 0) {
        throw new ToolBoundaryError(
          'PAGE_ENTRY_TOO_LARGE',
          'one trace entry exceeds the maximum serialized page size',
        );
      }
      break;
    }
    page.push(entry);
    serializedBytes = candidateBytes;
  }
  const nextOffset = offset + page.length;
  if (nextOffset < entries.length && page.length === 0) {
    throw new ToolBoundaryError('PAGE_NO_PROGRESS', 'page could not make cursor progress');
  }
  return {
    entries: page,
    pagination: {
      limit,
      returned: page.length,
      total: entries.length,
      serializedBytes,
      snapshotRevision: snapshot.revision,
      snapshotDigest: snapshot.digest,
      ...(nextOffset < entries.length ? { nextCursor: encodeCursor(snapshot, nextOffset) } : {}),
    },
  };
}

export function summarizeSparcRun(run: SparcRun): Record<string, unknown> {
  return {
    schemaVersion: run.schemaVersion,
    principalId: run.principalId,
    runId: run.runId,
    title: run.title,
    phase: run.phase,
    status: run.status,
    revision: run.revision,
    genesisDigest: run.genesisDigest,
    requirementsDigest: run.requirementsDigest,
    counts: {
      requirements: run.requirements.length,
      acceptanceTests: run.acceptanceTests.length,
      artifacts: run.artifacts.length,
      evidence: run.evidence.length,
      corrections: run.corrections.length,
      receipts: run.receipts.length,
    },
    phaseHistory: run.phaseHistory,
    receiptTail: run.receipts.at(-1)?.thisHash ?? '0'.repeat(64),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
    digest: run.digest,
  };
}

function phaseEntries(run: SparcRun, selected: SparcPhase): readonly Record<string, unknown>[] {
  return [
    ...run.artifacts
      .filter((artifact) => artifact.phase === selected)
      .map((value) => ({ kind: 'artifact', id: `${value.artifactId}@${value.version}`, value })),
    ...run.evidence
      .filter((evidence) => evidence.phase === selected)
      .map((value) => ({ kind: 'evidence', id: `${value.evidenceId}@${value.version}`, value })),
  ];
}

function traceEntries(run: SparcRun): readonly Record<string, unknown>[] {
  return [
    ...run.requirements.map((value) => ({ kind: 'requirement', id: value.id, value })),
    ...run.acceptanceTests.map((value) => ({ kind: 'acceptanceTest', id: value.id, value })),
    ...run.artifacts.map((value) => ({
      kind: 'artifact', id: `${value.phase}:${value.artifactId}@${value.version}`, value,
    })),
    ...run.evidence.map((value) => ({
      kind: 'evidence', id: `${value.phase}:${value.evidenceId}@${value.version}`, value,
    })),
    ...run.corrections.map((value) => ({ kind: 'correction', id: value.correctionId, value })),
    ...run.phaseHistory.map((value) => ({
      kind: 'phaseHistory', id: `${value.phase}@${value.enteredRevision}`, value,
    })),
    ...run.receipts.map((value) => ({ kind: 'receipt', id: value.thisHash, value })),
  ];
}

/** Build one revision-bound, byte-bounded trace page for CLI or MCP adapters. */
export function paginateSparcTrace(
  run: SparcRun,
  cursor: string | undefined,
  limit: number = DEFAULT_PAGE_LIMIT,
) {
  return paginate(traceEntries(run), cursor, limit, {
    scope: 'trace',
    principalId: run.principalId,
    runId: run.runId,
    revision: run.revision,
    digest: run.digest,
  });
}

function exactPublicJson(value: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return { value: null };
  const parsed = JSON.parse(serialized) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : { value: parsed };
}

function structured(value: unknown, isError = false): CallToolResult {
  const body = exactPublicJson(value);
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
  };
}

function scope(context: SparcToolContext, required: SparcScope): void {
  if (!context.principal.scopes.has(required)) {
    throw new ToolBoundaryError('FORBIDDEN', `the ${required} scope is required`);
  }
}

function safeError(error: unknown): CallToolResult {
  if (error instanceof ToolBoundaryError) {
    return structured({ ok: false, error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    } }, true);
  }
  if (error && typeof error === 'object') {
    const candidate = error as {
      code?: unknown;
      blockers?: unknown;
    };
    if (typeof candidate.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(candidate.code)) {
      return structured({ ok: false, error: {
        code: candidate.code,
        message: 'SPARC operation was rejected by the state boundary',
        ...(candidate.blockers === undefined ? {} : { blockers: candidate.blockers }),
      } }, true);
    }
  }
  return structured({ ok: false, error: {
    code: 'INTERNAL_ERROR',
    message: 'SPARC operation failed at the protected state boundary',
  } }, true);
}

async function invoke(
  context: SparcToolContext,
  required: SparcScope,
  operation: () => unknown | Promise<unknown>,
): Promise<CallToolResult> {
  try {
    scope(context, required);
    return structured(await operation());
  } catch (error) {
    return safeError(error);
  }
}

export interface SparcToolContext {
  readonly store: SparcStore;
  readonly principal: AuthenticatedPrincipal;
  readonly oauth?: boolean;
}

function securityMetadata(context: SparcToolContext, required: SparcScope): Record<string, unknown> {
  return context.oauth
    ? { securitySchemes: [{ type: 'oauth2', scopes: [required] }] }
    : context.principal.authentication === 'anonymous-loopback'
      ? { securitySchemes: [{ type: 'noauth' }] }
      : {};
}

export function registerSparcTools(server: McpServer, context: SparcToolContext): void {
  const principalId = context.principal.principalId;

  server.registerTool('sparc_run_get', {
    title: 'Read SPARC run',
    description: 'Read a bounded run summary and collection counts without returning the potentially multi-megabyte trace.',
    inputSchema: SPARC_TOOL_INPUT_ZOD_SCHEMAS.sparc_run_get,
    annotations: READ_ONLY,
    _meta: securityMetadata(context, SPARC_READ_SCOPE),
  }, async ({ runId: id }) => invoke(context, SPARC_READ_SCOPE, () => ({
    ok: true,
    run: summarizeSparcRun(context.store.getRun({ principalId, runId: id })),
  })));

  server.registerTool('sparc_phase_get', {
    title: 'Read SPARC phase',
    description: 'Read a revision-bound page of artifacts and evidence for one phase without changing state.',
    inputSchema: SPARC_TOOL_INPUT_ZOD_SCHEMAS.sparc_phase_get,
    annotations: READ_ONLY,
    _meta: securityMetadata(context, SPARC_READ_SCOPE),
  }, async ({ runId: id, phase: requestedPhase, cursor, limit }) => invoke(context, SPARC_READ_SCOPE, () => {
    const run = context.store.getRun({ principalId, runId: id });
    const selected = (requestedPhase ?? run.phase) as SparcPhase;
    const page = paginate(phaseEntries(run, selected), cursor, limit, {
      scope: 'phase',
      principalId,
      runId: id,
      phase: selected,
      revision: run.revision,
      digest: run.digest,
    });
    return {
      ok: true,
      runId: id,
      revision: run.revision,
      phase: selected,
      status: run.status,
      digest: run.digest,
      ...page,
    };
  }));

  server.registerTool('sparc_gate_validate', {
    title: 'Validate SPARC gate',
    description: 'Evaluate the deterministic gate for a phase without advancing or changing the run.',
    inputSchema: SPARC_TOOL_INPUT_ZOD_SCHEMAS.sparc_gate_validate,
    annotations: READ_ONLY,
    _meta: securityMetadata(context, SPARC_READ_SCOPE),
  }, async ({ runId: id, phase: requestedPhase }) => invoke(
    context,
    SPARC_READ_SCOPE,
    () => ({
      ok: true,
      gate: context.store.evaluateGate({
        principalId,
        runId: id,
        ...(requestedPhase ? { phase: requestedPhase as SparcPhase } : {}),
      }),
    }),
  ));

  server.registerTool('sparc_trace_get', {
    title: 'Read SPARC trace',
    description: 'Read a revision-bound page of requirements, tests, artifacts, evidence, corrections, history, and receipts.',
    inputSchema: SPARC_TOOL_INPUT_ZOD_SCHEMAS.sparc_trace_get,
    annotations: READ_ONLY,
    _meta: securityMetadata(context, SPARC_READ_SCOPE),
  }, async ({ runId: id, cursor, limit }) => invoke(context, SPARC_READ_SCOPE, () => {
    const run = context.store.getRun({ principalId, runId: id });
    const page = paginateSparcTrace(run, cursor, limit);
    return {
      ok: true,
      runId: id,
      revision: run.revision,
      phase: run.phase,
      status: run.status,
      digest: run.digest,
      verification: context.store.verify({ principalId, runId: id }),
      ...page,
    };
  }));

  server.registerTool('sparc_run_start', {
    title: 'Start SPARC run',
    description: 'Create an isolated SPARC run using expected revision zero. Replays require the same idempotency key and payload.',
    inputSchema: SPARC_TOOL_INPUT_ZOD_SCHEMAS.sparc_run_start,
    annotations: MUTATING,
    _meta: securityMetadata(context, SPARC_WRITE_SCOPE),
  }, async (input) => invoke(context, SPARC_WRITE_SCOPE, () => context.store.createRun({
    principalId,
    runId: input.runId,
    title: input.title,
    requirements: input.requirements.map(({ nonGoalReason, ...item }) => ({
      ...item,
      ...(nonGoalReason === undefined ? {} : { nonGoalReason }),
    })),
    acceptanceTests: input.acceptanceTests.map(({ command, ...item }) => ({
      ...item,
      ...(command === undefined ? {} : { command }),
    })),
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
  })));

  server.registerTool('sparc_phase_submit', {
    title: 'Submit SPARC phase artifact',
    description: 'Append a versioned JSON artifact to the current phase under exact revision and idempotency guards.',
    inputSchema: SPARC_TOOL_INPUT_ZOD_SCHEMAS.sparc_phase_submit,
    annotations: MUTATING,
    _meta: securityMetadata(context, SPARC_WRITE_SCOPE),
  }, async (input) => invoke(context, SPARC_WRITE_SCOPE, () => context.store.putArtifact({
    principalId,
    runId: input.runId,
    phase: input.phase as SparcPhase,
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    content: input.content as JsonValue,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
  })));

  server.registerTool('sparc_evidence_record', {
    title: 'Record SPARC evidence',
    description: 'Append requirement and test evidence under exact revision, idempotency, and Ed25519 verifier guards.',
    inputSchema: SPARC_TOOL_INPUT_ZOD_SCHEMAS.sparc_evidence_record,
    annotations: MUTATING,
    _meta: securityMetadata(context, SPARC_WRITE_SCOPE),
  }, async (input) => invoke(context, SPARC_WRITE_SCOPE, () => context.store.appendEvidence({
    principalId,
    runId: input.runId,
    evidenceId: input.evidenceId,
    requirementId: input.requirementId,
    ...(input.testId ? { testId: input.testId } : {}),
    status: input.status,
    summary: input.summary,
    ...(input.details === undefined ? {} : { details: input.details as JsonValue }),
    ...(input.authorization ? {
      authorization: {
        authorizedBy: input.authorization.authorizedBy,
        reason: input.authorization.reason,
        ...(input.authorization.reference === undefined
          ? {}
          : { reference: input.authorization.reference }),
      },
    } : {}),
    ...(input.attestation ? { attestation: input.attestation } : {}),
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
  })));

  server.registerTool('sparc_phase_advance', {
    title: 'Advance SPARC phase',
    description: 'Advance exactly one phase after its gate passes, or complete a gated Completion phase.',
    inputSchema: SPARC_TOOL_INPUT_ZOD_SCHEMAS.sparc_phase_advance,
    annotations: PHASE_ADVANCING,
    _meta: securityMetadata(context, SPARC_WRITE_SCOPE),
  }, async (input) => invoke(context, SPARC_WRITE_SCOPE, () => {
    const mutation = {
      principalId,
      runId: input.runId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    };
    const current = context.store.getRun({ principalId, runId: input.runId });
    return current.phase === 'Completion'
      ? context.store.completeRun(mutation)
      : context.store.advancePhase(mutation);
  }));
}

export interface CreateSparcMcpServerOptions {
  readonly store: SparcStore;
  readonly principal: AuthenticatedPrincipal;
  readonly oauth?: boolean;
}

export function createSparcMcpServer(options: CreateSparcMcpServerOptions): McpServer {
  const server = new McpServer(
    { name: 'sparc-metaharness', version: '1.0.0' },
    {
      instructions: [
        'SPARC is a deterministic five-phase state machine.',
        'Proceed only Specification, Pseudocode, Architecture, Refinement, Completion.',
        'Read the current revision before every mutation.',
        'Reuse an idempotency key only for an identical request.',
        'Record requirement evidence before completing the run.',
        'This server never calls a model, executes a shell command, or edits a repository.',
      ].join(' '),
    },
  );
  registerSparcTools(server, options);
  registerSparcResourcesAndPrompts(server);
  return server;
}
