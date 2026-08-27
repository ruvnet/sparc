import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { createPublicKey, randomBytes, verify as verifySignature, type KeyObject } from 'node:crypto';
import { ReceiptLog, canonical, hash, type Receipt } from '@metaharness/harness';
import {
  SPARC_LIMITS,
  SPARC_PHASES,
  SPARC_RUN_GENESIS_SCHEMA,
  SPARC_RUN_LIST_LIMITS,
  type AcceptanceTest,
  type AdvancePhaseInput,
  type AdvancePhaseResult,
  type AppendCorrectionInput,
  type AppendEvidenceInput,
  type ArtifactVersion,
  type BlockedMutationResult,
  type CompleteRunResult,
  type CorrectionRecord,
  type CreateRunInput,
  type EvaluateGateInput,
  type EvidenceAttestation,
  type EvidenceAttestationInput,
  type EvidenceAttestationPayloadInput,
  type EvidenceVersion,
  type GateBlocker,
  type GateResult,
  type JsonValue,
  type ListRunsInput,
  type ListRunsResult,
  type MutationContext,
  type MutationSuccess,
  type PhaseHistoryEntry,
  type PutArtifactInput,
  type Requirement,
  type RunLocator,
  type RunSummary,
  type RunStatus,
  type SparcPhase,
  type SparcRun,
  SparcError,
  assertIdentifier,
  assertJsonValue,
  assertMutationContext,
  assertText,
  cloneJson,
  evidenceAttestationBytes,
  evidenceAttestationPayload,
  isSparcPhase,
  phaseArtifactId,
} from './domain.js';
import { evaluatePhaseGate } from './gates.js';

const STORE_SCHEMA_VERSION = 1 as const;
const CORE_MODEL = 'sparc-metaharness-core';
const HEX_256 = /^[a-f0-9]{64}$/;
const RUN_STATE_FILE = /^[a-f0-9]{64}\.json$/;
const CURSOR_ENCODING = /^[A-Za-z0-9_-]+$/;
const RUN_GENESIS_NONCE = /^[A-Za-z0-9_-]{43}$/;

export const SPARC_LOCK_LEASE_LIMITS = Object.freeze({
  minimumMs: 100,
  maximumMs: 300_000,
  defaultMs: 30_000,
  metadataBytes: 1_024,
} as const);

interface LockLease {
  schema: 1;
  pid: number;
  acquiredAtMs: number;
  expiresAtMs: number;
  ownerToken: string;
}

interface RunListCursor {
  schema: 1;
  principalDigest: string;
  afterStateFile: string;
}

interface AuditEvent {
  revision: number;
  operation: string;
  requestDigest: string;
  output: JsonValue;
  receiptHash: string;
}

interface StoredIdempotencyRecord {
  key: string;
  operation: string;
  requestDigest: string;
  response: MutationSuccess<unknown>;
}

interface StoredRun {
  schemaVersion: 1;
  principalId: string;
  runId: string;
  title: string;
  phase: SparcPhase;
  status: RunStatus;
  revision: number;
  requirements: Requirement[];
  acceptanceTests: AcceptanceTest[];
  genesisNonce: string;
  genesisDigest: string;
  requirementsDigest: string;
  artifacts: ArtifactVersion[];
  evidence: EvidenceVersion[];
  corrections: CorrectionRecord[];
  phaseHistory: PhaseHistoryEntry[];
  receiptLog: { receipts: Receipt[] };
  auditEvents: AuditEvent[];
  idempotency: StoredIdempotencyRecord[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  integrityHash: string;
}

interface ApplySuccess<T> {
  ok: true;
  value: T;
  auditOutput: JsonValue;
}

type ApplyOutcome<T> = ApplySuccess<T> | BlockedMutationResult;

export interface SparcStoreOptions {
  /** Absolute, dedicated directory. Files are persisted with mode 0600. */
  readonly stateRoot: string;
  /** Principals allowed to approve explicit Completion evidence exceptions. Default: none. */
  readonly exceptionApprovers?: readonly string[];
  /** Trusted Ed25519 verifier keys, indexed by bounded keyId. Default: none. */
  readonly evidenceVerifierKeys?: Readonly<Record<string, string>>;
  /** Injectable clock for deterministic tests. */
  readonly clock?: () => Date;
  /** Crash-recovery lease. A live PID is never preempted after expiry. */
  readonly lockLeaseMs?: number;
}

export interface StoreVerification {
  readonly ok: true;
  readonly runId: string;
  readonly revision: number;
  readonly digest: string;
  readonly receiptCount: number;
  readonly receiptTail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertFiniteDate(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new SparcError('VALIDATION', `${field} must be an ISO timestamp`, { field });
  }
}

function withoutIntegrity(state: StoredRun): Omit<StoredRun, 'integrityHash'> {
  const { integrityHash: _ignored, ...body } = state;
  return body;
}

function artifactDigest(record: Omit<ArtifactVersion, 'digest'>): string {
  return hash(record);
}

function evidenceDigest(record: Omit<EvidenceVersion, 'digest'>): string {
  return hash(record);
}

function correctionDigest(record: Omit<CorrectionRecord, 'digest'>): string {
  return hash(record);
}

function latestVersion<T extends { version: number }>(records: readonly T[]): number {
  return records.reduce((maximum, record) => Math.max(maximum, record.version), 0);
}

function stablePayload(operation: string, payload: JsonValue): string {
  return hash({ operation, payload });
}

function computeRunGenesisDigest(input: {
  principalId: string;
  runId: string;
  title: string;
  requirements: readonly Requirement[];
  acceptanceTests: readonly AcceptanceTest[];
  genesisNonce: string;
}): string {
  return hash({
    schema: SPARC_RUN_GENESIS_SCHEMA,
    principalId: input.principalId,
    runId: input.runId,
    title: input.title,
    requirements: input.requirements,
    acceptanceTests: input.acceptanceTests,
    genesisNonce: input.genesisNonce,
  });
}

function ensureStateSize(state: StoredRun): string {
  const serialized = canonical(state);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > SPARC_LIMITS.stateBytes) {
    throw new SparcError('STATE_LIMIT', 'run state exceeds the persistence limit', {
      bytes,
      maximumBytes: SPARC_LIMITS.stateBytes,
    });
  }
  return serialized;
}

function blocker(
  phase: SparcPhase,
  code: string,
  path: string,
  message: string,
): GateBlocker {
  return { phase, code, path, message };
}

/** Durable, principal-isolated SPARC state machine with CAS and idempotent mutations. */
export class SparcStore {
  readonly stateRoot: string;
  private readonly runsRoot: string;
  private readonly exceptionApprovers: ReadonlySet<string>;
  private readonly evidenceVerifierKeys: ReadonlyMap<string, KeyObject>;
  private readonly clock: () => Date;
  private readonly lockLeaseMs: number;
  private temporaryCounter = 0;

  constructor(options: SparcStoreOptions) {
    if (!options || typeof options.stateRoot !== 'string' || !isAbsolute(options.stateRoot)) {
      throw new SparcError('ISOLATION_VIOLATION', 'stateRoot must be an absolute dedicated directory');
    }
    const requestedRoot = resolve(options.stateRoot);
    if (requestedRoot === parse(requestedRoot).root) {
      throw new SparcError('ISOLATION_VIOLATION', 'the filesystem root cannot be used as stateRoot');
    }
    mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
    this.rejectSymlinkSegments(requestedRoot);
    const rootStat = lstatSync(requestedRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new SparcError('ISOLATION_VIOLATION', 'stateRoot must be a real directory');
    }
    if ((rootStat.mode & 0o077) !== 0) {
      throw new SparcError('ISOLATION_VIOLATION', 'stateRoot must not be accessible to group or other users', {
        mode: (rootStat.mode & 0o777).toString(8),
      });
    }
    this.stateRoot = realpathSync(requestedRoot);
    if (this.stateRoot === parse(this.stateRoot).root) {
      throw new SparcError('ISOLATION_VIOLATION', 'resolved stateRoot cannot be the filesystem root');
    }
    this.runsRoot = this.safePath(this.stateRoot, 'runs');
    this.ensureSecureDirectory(this.runsRoot);
    const approvers = options.exceptionApprovers ?? [];
    approvers.forEach((principal, index) => assertIdentifier(principal, `exceptionApprovers[${index}]`));
    this.exceptionApprovers = new Set(approvers);
    const verifierKeys = new Map<string, KeyObject>();
    for (const [keyId, encodedKey] of Object.entries(options.evidenceVerifierKeys ?? {})) {
      assertIdentifier(keyId, 'evidenceVerifierKeys.keyId');
      assertText(encodedKey, `evidenceVerifierKeys.${keyId}`, 16_384);
      let key: KeyObject;
      try {
        key = createPublicKey(encodedKey);
      } catch (error) {
        throw new SparcError('VALIDATION', 'evidence verifier key is not a valid public key', {
          keyId,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      if (key.asymmetricKeyType !== 'ed25519') {
        throw new SparcError('VALIDATION', 'evidence verifier key must be Ed25519', {
          keyId,
          asymmetricKeyType: key.asymmetricKeyType,
        });
      }
      verifierKeys.set(keyId, key);
    }
    this.evidenceVerifierKeys = verifierKeys;
    this.clock = options.clock ?? (() => new Date());
    const lockLeaseMs = options.lockLeaseMs ?? SPARC_LOCK_LEASE_LIMITS.defaultMs;
    if (
      !Number.isSafeInteger(lockLeaseMs) ||
      lockLeaseMs < SPARC_LOCK_LEASE_LIMITS.minimumMs ||
      lockLeaseMs > SPARC_LOCK_LEASE_LIMITS.maximumMs
    ) {
      throw new SparcError('VALIDATION', 'lockLeaseMs is outside the bounded lease range', {
        lockLeaseMs,
        minimumMs: SPARC_LOCK_LEASE_LIMITS.minimumMs,
        maximumMs: SPARC_LOCK_LEASE_LIMITS.maximumMs,
      });
    }
    this.lockLeaseMs = lockLeaseMs;
  }

  createRun(input: CreateRunInput): MutationSuccess<{
    requirementsDigest: string;
    genesisDigest: string;
  }> {
    assertMutationContext(input);
    if (input.expectedRevision !== 0) {
      throw new SparcError('CAS_MISMATCH', 'a new run requires expectedRevision 0', {
        expectedRevision: input.expectedRevision,
        actualRevision: 0,
      });
    }
    assertText(input.title, 'title', SPARC_LIMITS.titleCharacters);
    this.validateDefinitions(input.requirements, input.acceptanceTests);
    const definitions = {
      requirements: cloneJson(input.requirements) as Requirement[],
      acceptanceTests: cloneJson(input.acceptanceTests) as AcceptanceTest[],
    };
    const requirementsDigest = hash(definitions);
    const payload: JsonValue = {
      principalId: input.principalId,
      runId: input.runId,
      expectedRevision: input.expectedRevision,
      title: input.title,
      requirements: definitions.requirements as unknown as JsonValue,
      acceptanceTests: definitions.acceptanceTests as unknown as JsonValue,
    };
    const requestDigest = stablePayload('run.create', payload);
    const statePath = this.statePath(input.principalId, input.runId, true);

    return this.withLock(statePath, () => {
      if (existsSync(statePath)) {
        const existing = this.loadState(statePath, input.principalId, input.runId);
        const replay = this.idempotentReplay<{
          requirementsDigest: string;
          genesisDigest: string;
        }>(
          existing,
          input.idempotencyKey,
          'run.create',
          requestDigest,
        );
        if (replay) return replay;
        throw new SparcError('RUN_EXISTS', 'run already exists for this principal', {
          runId: input.runId,
          revision: existing.revision,
        });
      }

      const now = this.now();
      const genesisNonce = randomBytes(32).toString('base64url');
      const genesisDigest = computeRunGenesisDigest({
        principalId: input.principalId,
        runId: input.runId,
        title: input.title,
        requirements: definitions.requirements,
        acceptanceTests: definitions.acceptanceTests,
        genesisNonce,
      });
      const state: StoredRun = {
        schemaVersion: STORE_SCHEMA_VERSION,
        principalId: input.principalId,
        runId: input.runId,
        title: input.title,
        phase: 'Specification',
        status: 'active',
        revision: 1,
        requirements: definitions.requirements,
        acceptanceTests: definitions.acceptanceTests,
        genesisNonce,
        genesisDigest,
        requirementsDigest,
        artifacts: [],
        evidence: [],
        corrections: [],
        phaseHistory: [{ phase: 'Specification', enteredRevision: 1 }],
        receiptLog: { receipts: [] },
        auditEvents: [],
        idempotency: [],
        createdAt: now,
        updatedAt: now,
        integrityHash: '',
      };
      const output: JsonValue = {
        revision: 1,
        phase: 'Specification',
        requirementsDigest,
        genesisDigest,
      };
      const receiptLog = new ReceiptLog();
      const receipt = receiptLog.append({
        runId: input.runId,
        step: 'run.create',
        input: requestDigest,
        output,
        agent: input.principalId,
        model: CORE_MODEL,
        costUsd: 0,
        latencyMs: 0,
        verdict: 'pass',
      });
      state.receiptLog = receiptLog.toJSON();
      state.auditEvents.push({
        revision: 1,
        operation: 'run.create',
        requestDigest,
        output,
        receiptHash: receipt.thisHash,
      });
      const response: MutationSuccess<{
        requirementsDigest: string;
        genesisDigest: string;
      }> = {
        ok: true,
        runId: input.runId,
        revision: 1,
        phase: 'Specification',
        status: 'active',
        value: { requirementsDigest, genesisDigest },
        receipt,
      };
      state.idempotency.push({
        key: input.idempotencyKey,
        operation: 'run.create',
        requestDigest,
        response,
      });
      this.persist(statePath, state);
      return cloneJson(response);
    });
  }

  getRun(input: RunLocator): SparcRun {
    this.validateLocator(input);
    const state = this.loadState(this.statePath(input.principalId, input.runId, false), input.principalId, input.runId);
    return this.toPublic(state);
  }

  listRuns(input: ListRunsInput): ListRunsResult {
    assertIdentifier(input.principalId, 'principalId');
    const limit = input.limit ?? SPARC_RUN_LIST_LIMITS.default;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > SPARC_RUN_LIST_LIMITS.maximum) {
      throw new SparcError('VALIDATION', 'listRuns limit must be a bounded positive integer', {
        limit,
        maximum: SPARC_RUN_LIST_LIMITS.maximum,
      });
    }
    const cursor = input.cursor === undefined
      ? undefined
      : this.decodeRunListCursor(input.cursor, input.principalId);
    const directory = this.principalPath(input.principalId);
    if (!existsSync(directory)) {
      if (cursor !== undefined) {
        throw new SparcError('VALIDATION', 'listRuns cursor no longer identifies a valid page');
      }
      return { runs: [] };
    }
    this.assertSecureDirectory(directory);
    const names = readdirSync(directory).filter((entry) => RUN_STATE_FILE.test(entry)).sort();
    let start = 0;
    if (cursor !== undefined) {
      const cursorIndex = names.indexOf(cursor.afterStateFile);
      if (cursorIndex < 0) {
        throw new SparcError('VALIDATION', 'listRuns cursor no longer identifies a valid page');
      }
      start = cursorIndex + 1;
    }
    const pageNames = names.slice(start, start + limit);
    const runs: RunSummary[] = [];
    for (const name of pageNames) {
      const file = this.safePath(directory, name);
      const state = this.loadState(file, input.principalId);
      if (name !== `${hash(state.runId)}.json`) {
        throw new SparcError('TAMPERED_STATE', 'stored SPARC state filename does not match its runId', {
          runId: state.runId,
        });
      }
      runs.push(this.toSummary(state));
    }
    const hasMore = start + pageNames.length < names.length;
    return {
      runs,
      ...(hasMore && pageNames.length > 0
        ? { nextCursor: this.encodeRunListCursor(input.principalId, pageNames[pageNames.length - 1]!) }
        : {}),
    };
  }

  putArtifact(input: PutArtifactInput): MutationSuccess<ArtifactVersion> {
    assertMutationContext(input);
    if (!isSparcPhase(input.phase)) {
      throw new SparcError('VALIDATION', 'phase is not a SPARC phase', { phase: input.phase });
    }
    if (input.artifactId !== undefined) assertIdentifier(input.artifactId, 'artifactId');
    assertJsonValue(input.content, 'content');
    const payload: JsonValue = {
      phase: input.phase,
      artifactId: input.artifactId ?? null,
      content: input.content,
      expectedRevision: input.expectedRevision,
    };
    const result = this.mutate(input, 'artifact.put', payload, (state, now) => {
      this.assertActive(state, 'put artifacts');
      if (state.phase !== input.phase) {
        throw new SparcError('VALIDATION', 'artifact phase does not match the current phase', {
          requestedPhase: input.phase,
          currentPhase: state.phase,
        });
      }
      if (state.artifacts.length >= SPARC_LIMITS.artifacts) {
        throw new SparcError('STATE_LIMIT', 'artifact count limit reached');
      }
      const artifactId = input.artifactId ?? phaseArtifactId(input.phase);
      const version = latestVersion(
        state.artifacts.filter((entry) => entry.artifactId === artifactId && entry.phase === state.phase),
      ) + 1;
      const body: Omit<ArtifactVersion, 'digest'> = {
        artifactId,
        version,
        phase: state.phase,
        content: cloneJson(input.content),
        createdAt: now,
        createdBy: input.principalId,
      };
      const artifact: ArtifactVersion = { ...body, digest: artifactDigest(body) };
      state.artifacts.push(artifact);
      return {
        ok: true,
        value: artifact,
        auditOutput: {
          kind: 'artifact',
          artifactId,
          phase: state.phase,
          version,
          digest: artifact.digest,
        },
      };
    });
    if (!result.ok) throw new SparcError('VALIDATION', 'artifact mutation was unexpectedly blocked');
    return result;
  }

  appendEvidence(input: AppendEvidenceInput): MutationSuccess<EvidenceVersion> {
    assertMutationContext(input);
    assertIdentifier(input.evidenceId, 'evidenceId');
    assertIdentifier(input.requirementId, 'requirementId');
    if (input.testId !== undefined) assertIdentifier(input.testId, 'testId');
    if (!['pass', 'fail', 'exception'].includes(input.status)) {
      throw new SparcError('VALIDATION', 'status must be pass, fail, or exception');
    }
    assertText(input.summary, 'summary');
    if (input.details !== undefined) assertJsonValue(input.details, 'details');
    if (input.authorization !== undefined) {
      assertIdentifier(input.authorization.authorizedBy, 'authorization.authorizedBy');
      assertText(input.authorization.reason, 'authorization.reason');
      if (input.authorization.reference !== undefined) {
        assertText(input.authorization.reference, 'authorization.reference');
      }
    }
    if (input.attestation !== undefined) this.validateEvidenceAttestationInput(input.attestation);
    if (input.status === 'exception') {
      if (
        !input.authorization ||
        input.authorization.authorizedBy !== input.principalId ||
        !this.exceptionApprovers.has(input.authorization.authorizedBy)
      ) {
        throw new SparcError('VALIDATION', 'exception evidence requires the authenticated principal to be an explicitly configured approver', {
          authorizedBy: input.authorization?.authorizedBy,
          principalId: input.principalId,
        });
      }
    } else if (input.authorization !== undefined) {
      throw new SparcError('VALIDATION', 'authorization is only valid for exception evidence');
    }
    if ((input.status === 'pass' || input.status === 'exception') && input.attestation === undefined) {
      throw new SparcError('VALIDATION', 'pass and exception evidence require verifier attestation', {
        status: input.status,
      });
    }
    const payload: JsonValue = {
      evidenceId: input.evidenceId,
      requirementId: input.requirementId,
      testId: input.testId ?? null,
      status: input.status,
      summary: input.summary,
      details: input.details ?? null,
      authorization: input.authorization ? (cloneJson(input.authorization) as unknown as JsonValue) : null,
      attestation: input.attestation ? (cloneJson(input.attestation) as unknown as JsonValue) : null,
      expectedRevision: input.expectedRevision,
    };
    const result = this.mutate(input, 'evidence.append', payload, (state, now) => {
      this.assertActive(state, 'append evidence');
      if (state.evidence.length >= SPARC_LIMITS.evidence) {
        throw new SparcError('STATE_LIMIT', 'evidence count limit reached');
      }
      const requirement = state.requirements.find((entry) => entry.id === input.requirementId);
      if (!requirement) {
        throw new SparcError('VALIDATION', 'evidence references an unknown requirement', {
          requirementId: input.requirementId,
        });
      }
      if (!requirement.inScope) {
        throw new SparcError('VALIDATION', 'evidence cannot be attached to an explicit non-goal', {
          requirementId: input.requirementId,
        });
      }
      if (input.testId !== undefined && !requirement.acceptanceTestIds.includes(input.testId)) {
        throw new SparcError('VALIDATION', 'testId is not registered for the requirement', {
          requirementId: input.requirementId,
          testId: input.testId,
        });
      }
      const existingIdentity = state.evidence.find((entry) => entry.evidenceId === input.evidenceId);
      if (
        existingIdentity &&
        (existingIdentity.requirementId !== input.requirementId ||
          (existingIdentity.testId ?? null) !== (input.testId ?? null))
      ) {
        throw new SparcError('VALIDATION', 'an evidenceId cannot be rebound to another requirement or test', {
          evidenceId: input.evidenceId,
          existingRequirementId: existingIdentity.requirementId,
          requestedRequirementId: input.requirementId,
          existingTestId: existingIdentity.testId ?? null,
          requestedTestId: input.testId ?? null,
        });
      }
      const attestation = input.attestation === undefined
        ? undefined
        : this.verifyEvidenceAttestation(input, state);
      const version = latestVersion(state.evidence.filter((entry) => entry.evidenceId === input.evidenceId)) + 1;
      const authorization = input.authorization
        ? {
            ...cloneJson(input.authorization),
            authorizedAt: now,
            approved: true as const,
          }
        : undefined;
      const body: Omit<EvidenceVersion, 'digest'> = {
        evidenceId: input.evidenceId,
        version,
        phase: state.phase,
        requirementId: input.requirementId,
        ...(input.testId === undefined ? {} : { testId: input.testId }),
        status: input.status,
        summary: input.summary,
        ...(input.details === undefined ? {} : { details: cloneJson(input.details) }),
        ...(authorization === undefined ? {} : { authorization }),
        ...(attestation === undefined ? {} : { attestation }),
        createdAt: now,
        createdBy: input.principalId,
      };
      const evidence: EvidenceVersion = { ...body, digest: evidenceDigest(body) };
      state.evidence.push(evidence);
      return {
        ok: true,
        value: evidence,
        auditOutput: {
          kind: 'evidence',
          evidenceId: evidence.evidenceId,
          version,
          requirementId: evidence.requirementId,
          status: evidence.status,
          digest: evidence.digest,
        },
      };
    });
    if (!result.ok) throw new SparcError('VALIDATION', 'evidence mutation was unexpectedly blocked');
    return result;
  }

  appendCorrection(input: AppendCorrectionInput): MutationSuccess<CorrectionRecord> {
    assertMutationContext(input);
    assertIdentifier(input.correctionId, 'correctionId');
    if (!input.target || !['artifact', 'evidence'].includes(input.target.kind)) {
      throw new SparcError('VALIDATION', 'correction target kind must be artifact or evidence');
    }
    assertIdentifier(input.target.id, 'target.id');
    if (!Number.isSafeInteger(input.target.version) || input.target.version < 1) {
      throw new SparcError('VALIDATION', 'target.version must be a positive safe integer');
    }
    assertText(input.reason, 'reason');
    if (input.replacement !== undefined) assertJsonValue(input.replacement, 'replacement');
    const payload: JsonValue = {
      correctionId: input.correctionId,
      target: cloneJson(input.target) as unknown as JsonValue,
      reason: input.reason,
      replacement: input.replacement ?? null,
      expectedRevision: input.expectedRevision,
    };
    const result = this.mutate(input, 'correction.append', payload, (state, now) => {
      this.assertActive(state, 'append corrections');
      if (state.corrections.length >= SPARC_LIMITS.corrections) {
        throw new SparcError('STATE_LIMIT', 'correction count limit reached');
      }
      if (state.corrections.some((entry) => entry.correctionId === input.correctionId)) {
        throw new SparcError('VALIDATION', 'correctionId already exists; corrections are append-only', {
          correctionId: input.correctionId,
        });
      }
      const targetExists = input.target.kind === 'artifact'
        ? state.artifacts.some(
            (entry) => entry.artifactId === input.target.id && entry.version === input.target.version,
          )
        : state.evidence.some(
            (entry) => entry.evidenceId === input.target.id && entry.version === input.target.version,
          );
      if (!targetExists) {
        throw new SparcError('VALIDATION', 'correction target does not exist', { target: input.target });
      }
      const body: Omit<CorrectionRecord, 'digest'> = {
        correctionId: input.correctionId,
        target: cloneJson(input.target),
        reason: input.reason,
        ...(input.replacement === undefined ? {} : { replacement: cloneJson(input.replacement) }),
        createdAt: now,
        createdBy: input.principalId,
      };
      const correction: CorrectionRecord = { ...body, digest: correctionDigest(body) };
      state.corrections.push(correction);
      return {
        ok: true,
        value: correction,
        auditOutput: {
          kind: 'correction',
          correctionId: correction.correctionId,
          target: correction.target as unknown as JsonValue,
          digest: correction.digest,
        },
      };
    });
    if (!result.ok) throw new SparcError('VALIDATION', 'correction mutation was unexpectedly blocked');
    return result;
  }

  evaluateGate(input: EvaluateGateInput): GateResult {
    this.validateLocator(input);
    if (input.phase !== undefined && !isSparcPhase(input.phase)) {
      throw new SparcError('VALIDATION', 'phase is not a SPARC phase', { phase: input.phase });
    }
    const run = this.getRun(input);
    return evaluatePhaseGate(run, input.phase ?? run.phase);
  }

  advancePhase(input: AdvancePhaseInput): AdvancePhaseResult {
    assertMutationContext(input);
    if (input.targetPhase !== undefined && !isSparcPhase(input.targetPhase)) {
      throw new SparcError('VALIDATION', 'targetPhase is not a SPARC phase', { targetPhase: input.targetPhase });
    }
    const payload: JsonValue = {
      expectedRevision: input.expectedRevision,
      targetPhase: input.targetPhase ?? null,
    };
    return this.mutate(input, 'phase.advance', payload, (state) => {
      this.assertActive(state, 'advance phases');
      const index = SPARC_PHASES.indexOf(state.phase);
      if (index < 0 || index >= SPARC_PHASES.length - 1) {
        return this.blockedTransition(
          state,
          'INVALID_TRANSITION',
          blocker(state.phase, 'NO_NEXT_PHASE', 'phase', 'Completion must be finalized with completeRun'),
        );
      }
      const next = SPARC_PHASES[index + 1] as SparcPhase;
      if (input.targetPhase !== undefined && input.targetPhase !== next) {
        return this.blockedTransition(
          state,
          'INVALID_TRANSITION',
          blocker(
            state.phase,
            'PHASE_SKIP',
            'targetPhase',
            `only the immediate next phase ${next} is permitted`,
          ),
        );
      }
      const gate = evaluatePhaseGate(this.toPublic(state), state.phase);
      if (!gate.ok) return this.blockedByGate(state, gate);
      const from = state.phase;
      state.phase = next;
      state.phaseHistory.push({ phase: next, enteredRevision: state.revision + 1, gateDigest: gate.digest });
      return {
        ok: true,
        value: { from, to: next },
        auditOutput: { kind: 'transition', from, to: next, gateDigest: gate.digest },
      };
    });
  }

  completeRun(input: MutationContext): CompleteRunResult {
    assertMutationContext(input);
    const payload: JsonValue = { expectedRevision: input.expectedRevision };
    return this.mutate(input, 'run.complete', payload, (state, now) => {
      this.assertActive(state, 'complete the run');
      if (state.phase !== 'Completion') {
        return this.blockedTransition(
          state,
          'INVALID_TRANSITION',
          blocker(state.phase, 'NOT_IN_COMPLETION', 'phase', 'the run must reach Completion before finalization'),
        );
      }
      const gate = evaluatePhaseGate(this.toPublic(state), 'Completion');
      if (!gate.ok) return this.blockedByGate(state, gate);
      state.status = 'completed';
      state.completedAt = now;
      return {
        ok: true,
        value: { completed: true as const },
        auditOutput: { kind: 'completion', phase: 'Completion', gateDigest: gate.digest },
      };
    });
  }

  verify(input: RunLocator): StoreVerification {
    this.validateLocator(input);
    const state = this.loadState(this.statePath(input.principalId, input.runId, false), input.principalId, input.runId);
    const receipts = ReceiptLog.fromJSON(state.receiptLog).entries();
    return {
      ok: true,
      runId: state.runId,
      revision: state.revision,
      digest: state.integrityHash,
      receiptCount: receipts.length,
      receiptTail: receipts[receipts.length - 1]?.thisHash ?? '0'.repeat(64),
    };
  }

  private mutate<T>(
    input: MutationContext,
    operation: string,
    payload: JsonValue,
    apply: (state: StoredRun, now: string) => ApplyOutcome<T>,
  ): MutationSuccess<T> | BlockedMutationResult {
    assertMutationContext(input);
    assertJsonValue(payload, 'mutationPayload');
    const requestDigest = stablePayload(operation, payload);
    const statePath = this.statePath(input.principalId, input.runId, true);
    return this.withLock(statePath, () => {
      const state = this.loadState(statePath, input.principalId, input.runId);
      const replay = this.idempotentReplay<T>(state, input.idempotencyKey, operation, requestDigest);
      if (replay) return replay;
      if (state.revision !== input.expectedRevision) {
        throw new SparcError('CAS_MISMATCH', 'expectedRevision does not match the current run revision', {
          expectedRevision: input.expectedRevision,
          actualRevision: state.revision,
          runId: state.runId,
        });
      }
      if (state.idempotency.length >= SPARC_LIMITS.idempotencyRecords) {
        throw new SparcError('STATE_LIMIT', 'idempotency record limit reached');
      }
      const now = this.now();
      const applied = apply(state, now);
      if (!applied.ok) return cloneJson(applied);

      state.revision += 1;
      state.updatedAt = now;
      const auditOutput: JsonValue = {
        revision: state.revision,
        phase: state.phase,
        status: state.status,
        result: applied.auditOutput,
      };
      const receiptLog = ReceiptLog.fromJSON(state.receiptLog);
      const receipt = receiptLog.append({
        runId: state.runId,
        step: operation,
        input: requestDigest,
        output: auditOutput,
        agent: input.principalId,
        model: CORE_MODEL,
        costUsd: 0,
        latencyMs: 0,
        verdict: 'pass',
      });
      state.receiptLog = receiptLog.toJSON();
      state.auditEvents.push({
        revision: state.revision,
        operation,
        requestDigest,
        output: auditOutput,
        receiptHash: receipt.thisHash,
      });
      const response: MutationSuccess<T> = {
        ok: true,
        runId: state.runId,
        revision: state.revision,
        phase: state.phase,
        status: state.status,
        value: cloneJson(applied.value),
        receipt,
      };
      state.idempotency.push({ key: input.idempotencyKey, operation, requestDigest, response });
      this.persist(statePath, state);
      return cloneJson(response);
    });
  }

  private idempotentReplay<T>(
    state: StoredRun,
    key: string,
    operation: string,
    requestDigest: string,
  ): MutationSuccess<T> | undefined {
    const previous = state.idempotency.find((entry) => entry.key === key);
    if (!previous) return undefined;
    if (previous.operation !== operation || previous.requestDigest !== requestDigest) {
      throw new SparcError('IDEMPOTENCY_MISMATCH', 'idempotencyKey was already used for a different request', {
        key,
        previousOperation: previous.operation,
        operation,
      });
    }
    return cloneJson(previous.response) as MutationSuccess<T>;
  }

  private blockedByGate(state: StoredRun, gate: GateResult): BlockedMutationResult {
    return {
      ok: false,
      code: 'GATE_BLOCKED',
      runId: state.runId,
      revision: state.revision,
      phase: state.phase,
      blockers: gate.blockers,
      gate,
    };
  }

  private blockedTransition(
    state: StoredRun,
    code: 'INVALID_TRANSITION',
    transitionBlocker: GateBlocker,
  ): BlockedMutationResult {
    const blockers = [transitionBlocker];
    const gate: GateResult = {
      ok: false,
      phase: state.phase,
      blockers,
      digest: hash({
        phase: state.phase,
        revision: state.revision,
        genesisDigest: state.genesisDigest,
        blockers,
      }),
    };
    return { ok: false, code, runId: state.runId, revision: state.revision, phase: state.phase, blockers, gate };
  }

  private validateEvidenceAttestationInput(attestation: EvidenceAttestationInput): void {
    if (!attestation || typeof attestation !== 'object') {
      throw new SparcError('VALIDATION', 'attestation must be an object');
    }
    assertIdentifier(attestation.keyId, 'attestation.keyId');
    if (attestation.algorithm !== 'Ed25519') {
      throw new SparcError('VALIDATION', 'attestation.algorithm must be Ed25519');
    }
    if (
      typeof attestation.issuedAt !== 'string' ||
      !Number.isFinite(Date.parse(attestation.issuedAt)) ||
      new Date(attestation.issuedAt).toISOString() !== attestation.issuedAt
    ) {
      throw new SparcError(
        'VALIDATION',
        'attestation.issuedAt must be canonical UTC ISO 8601 with millisecond precision',
      );
    }
    if (
      typeof attestation.signature !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(attestation.signature)
    ) {
      throw new SparcError('VALIDATION', 'attestation.signature must be unpadded base64url');
    }
    let decoded: Buffer;
    try {
      decoded = Buffer.from(attestation.signature, 'base64url');
    } catch {
      throw new SparcError('VALIDATION', 'attestation.signature is malformed base64url');
    }
    if (decoded.length !== 64 || decoded.toString('base64url') !== attestation.signature) {
      throw new SparcError('VALIDATION', 'attestation.signature must encode exactly 64 bytes');
    }
  }

  private evidencePayloadInput(
    input: Pick<
      AppendEvidenceInput,
      | 'principalId'
      | 'runId'
      | 'expectedRevision'
      | 'evidenceId'
      | 'requirementId'
      | 'testId'
      | 'status'
      | 'summary'
      | 'details'
      | 'authorization'
    >,
    state: StoredRun,
    attestation: EvidenceAttestationInput,
  ): EvidenceAttestationPayloadInput {
    return {
      principalId: input.principalId,
      runId: input.runId,
      genesisDigest: state.genesisDigest,
      requirementsDigest: state.requirementsDigest,
      expectedRevision: input.expectedRevision,
      phase: state.phase,
      evidenceId: input.evidenceId,
      requirementId: input.requirementId,
      ...(input.testId === undefined ? {} : { testId: input.testId }),
      status: input.status,
      summary: input.summary,
      ...(input.details === undefined ? {} : { details: input.details }),
      ...(input.authorization === undefined ? {} : { authorization: input.authorization }),
      attestation: {
        keyId: attestation.keyId,
        issuedAt: attestation.issuedAt,
        algorithm: attestation.algorithm,
      },
    };
  }

  private verifyEvidenceAttestation(input: AppendEvidenceInput, state: StoredRun): EvidenceAttestation {
    const attestation = input.attestation;
    if (!attestation) throw new SparcError('VALIDATION', 'verifier attestation is required');
    this.validateEvidenceAttestationInput(attestation);
    const payloadInput = this.evidencePayloadInput(input, state, attestation);
    this.verifyEvidenceSignature(payloadInput, attestation.signature);
    return {
      ...cloneJson(attestation),
      expectedRevision: input.expectedRevision,
      genesisDigest: state.genesisDigest,
      requirementsDigest: state.requirementsDigest,
      payloadDigest: hash(evidenceAttestationPayload(payloadInput)),
      verified: true,
    };
  }

  private verifyEvidenceSignature(payload: EvidenceAttestationPayloadInput, signature: string): void {
    const key = this.evidenceVerifierKeys.get(payload.attestation.keyId);
    if (!key) {
      throw new SparcError('VALIDATION', 'attestation references an unknown verifier key', {
        keyId: payload.attestation.keyId,
      });
    }
    let verified = false;
    try {
      verified = verifySignature(
        null,
        evidenceAttestationBytes(payload),
        key,
        Buffer.from(signature, 'base64url'),
      );
    } catch (error) {
      throw new SparcError('VALIDATION', 'evidence attestation verification failed', {
        keyId: payload.attestation.keyId,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (!verified) {
      throw new SparcError('VALIDATION', 'evidence attestation signature does not match the evidence payload', {
        keyId: payload.attestation.keyId,
      });
    }
  }

  private verifyPersistedEvidenceAttestation(state: StoredRun, evidence: EvidenceVersion): void {
    const attestation = evidence.attestation;
    if (!attestation) {
      if (evidence.status === 'pass' || evidence.status === 'exception') {
        throw new Error('usable evidence is missing verifier attestation');
      }
      return;
    }
    this.validateEvidenceAttestationInput(attestation);
    if (!Number.isSafeInteger(attestation.expectedRevision) || attestation.expectedRevision < 0) {
      throw new Error('attestation expectedRevision is invalid');
    }
    if (
      !HEX_256.test(attestation.genesisDigest)
      || attestation.genesisDigest !== state.genesisDigest
      || !HEX_256.test(attestation.requirementsDigest)
      || attestation.requirementsDigest !== state.requirementsDigest
    ) {
      throw new Error('attestation run genesis binding is invalid');
    }
    if (attestation.verified !== true || !HEX_256.test(attestation.payloadDigest)) {
      throw new Error('persisted attestation verification marker is invalid');
    }
    const authorization = evidence.authorization === undefined
      ? undefined
      : {
          authorizedBy: evidence.authorization.authorizedBy,
          reason: evidence.authorization.reason,
          ...(evidence.authorization.reference === undefined
            ? {}
            : { reference: evidence.authorization.reference }),
        };
    const payloadInput: EvidenceAttestationPayloadInput = {
      principalId: state.principalId,
      runId: state.runId,
      genesisDigest: state.genesisDigest,
      requirementsDigest: state.requirementsDigest,
      expectedRevision: attestation.expectedRevision,
      phase: evidence.phase,
      evidenceId: evidence.evidenceId,
      requirementId: evidence.requirementId,
      ...(evidence.testId === undefined ? {} : { testId: evidence.testId }),
      status: evidence.status,
      summary: evidence.summary,
      ...(evidence.details === undefined ? {} : { details: evidence.details }),
      ...(authorization === undefined ? {} : { authorization }),
      attestation: {
        keyId: attestation.keyId,
        issuedAt: attestation.issuedAt,
        algorithm: attestation.algorithm,
      },
    };
    if (hash(evidenceAttestationPayload(payloadInput)) !== attestation.payloadDigest) {
      throw new Error('persisted attestation payload digest mismatch');
    }
    this.verifyEvidenceSignature(payloadInput, attestation.signature);
  }

  private validateDefinitions(
    requirementsInput: readonly Requirement[],
    acceptanceTestsInput: readonly AcceptanceTest[],
  ): void {
    if (!Array.isArray(requirementsInput) || requirementsInput.length === 0) {
      throw new SparcError('VALIDATION', 'at least one stable requirement is required');
    }
    if (requirementsInput.length > SPARC_LIMITS.requirements) {
      throw new SparcError('STATE_LIMIT', 'requirement count limit exceeded');
    }
    if (!Array.isArray(acceptanceTestsInput) || acceptanceTestsInput.length > SPARC_LIMITS.acceptanceTests) {
      throw new SparcError('STATE_LIMIT', 'acceptance-test count limit exceeded');
    }
    const tests = new Map<string, AcceptanceTest>();
    acceptanceTestsInput.forEach((test, index) => {
      if (!test || typeof test !== 'object') throw new SparcError('VALIDATION', `acceptanceTests[${index}] is invalid`);
      assertIdentifier(test.id, `acceptanceTests[${index}].id`);
      assertText(test.description, `acceptanceTests[${index}].description`);
      if (test.command !== undefined) assertText(test.command, `acceptanceTests[${index}].command`);
      if (tests.has(test.id)) throw new SparcError('VALIDATION', `duplicate acceptance test ${test.id}`);
      tests.set(test.id, test);
    });
    const requirements = new Set<string>();
    requirementsInput.forEach((requirement, index) => {
      if (!requirement || typeof requirement !== 'object') {
        throw new SparcError('VALIDATION', `requirements[${index}] is invalid`);
      }
      assertIdentifier(requirement.id, `requirements[${index}].id`);
      assertText(requirement.statement, `requirements[${index}].statement`);
      if (requirements.has(requirement.id)) throw new SparcError('VALIDATION', `duplicate requirement ${requirement.id}`);
      requirements.add(requirement.id);
      if (typeof requirement.inScope !== 'boolean') {
        throw new SparcError('VALIDATION', `requirements[${index}].inScope must be boolean`);
      }
      if (!Array.isArray(requirement.acceptanceTestIds)) {
        throw new SparcError('VALIDATION', `requirements[${index}].acceptanceTestIds must be an array`);
      }
      const ids = new Set<string>();
      (requirement.acceptanceTestIds as readonly string[]).forEach((testId: string, testIndex: number) => {
        assertIdentifier(testId, `requirements[${index}].acceptanceTestIds[${testIndex}]`);
        if (ids.has(testId)) throw new SparcError('VALIDATION', `requirement ${requirement.id} repeats ${testId}`);
        if (!tests.has(testId)) throw new SparcError('VALIDATION', `requirement ${requirement.id} references unknown ${testId}`);
        ids.add(testId);
      });
      if (requirement.inScope) {
        if (ids.size === 0) {
          throw new SparcError('VALIDATION', `in-scope requirement ${requirement.id} requires an acceptance test`);
        }
        if (requirement.nonGoalReason !== undefined) {
          throw new SparcError('VALIDATION', `in-scope requirement ${requirement.id} cannot be a non-goal`);
        }
      } else {
        if (ids.size !== 0) {
          throw new SparcError('VALIDATION', `non-goal requirement ${requirement.id} cannot reference acceptance tests`);
        }
        assertText(requirement.nonGoalReason, `requirements[${index}].nonGoalReason`);
      }
    });
  }

  private assertActive(state: StoredRun, action: string): void {
    if (state.status !== 'active') {
      throw new SparcError('VALIDATION', `cannot ${action} after Completion has been finalized`, {
        status: state.status,
      });
    }
  }

  private validateLocator(input: RunLocator): void {
    assertIdentifier(input.principalId, 'principalId');
    assertIdentifier(input.runId, 'runId');
  }

  private toPublic(state: StoredRun): SparcRun {
    return cloneJson({
      schemaVersion: state.schemaVersion,
      principalId: state.principalId,
      runId: state.runId,
      title: state.title,
      phase: state.phase,
      status: state.status,
      revision: state.revision,
      requirements: state.requirements,
      acceptanceTests: state.acceptanceTests,
      genesisDigest: state.genesisDigest,
      requirementsDigest: state.requirementsDigest,
      artifacts: state.artifacts,
      evidence: state.evidence,
      corrections: state.corrections,
      phaseHistory: state.phaseHistory,
      receipts: state.receiptLog.receipts,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      ...(state.completedAt === undefined ? {} : { completedAt: state.completedAt }),
      digest: state.integrityHash,
    });
  }

  private toSummary(state: StoredRun): RunSummary {
    return {
      principalId: state.principalId,
      runId: state.runId,
      title: state.title,
      phase: state.phase,
      status: state.status,
      revision: state.revision,
      genesisDigest: state.genesisDigest,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      ...(state.completedAt === undefined ? {} : { completedAt: state.completedAt }),
      digest: state.integrityHash,
    };
  }

  private encodeRunListCursor(principalId: string, afterStateFile: string): string {
    const cursor: RunListCursor = {
      schema: 1,
      principalDigest: hash(principalId),
      afterStateFile,
    };
    const encoded = Buffer.from(canonical(cursor), 'utf8').toString('base64url');
    if (encoded.length > SPARC_RUN_LIST_LIMITS.cursorCharacters) {
      throw new SparcError('PERSISTENCE_FAILURE', 'generated listRuns cursor exceeds its bound');
    }
    return encoded;
  }

  private decodeRunListCursor(encoded: string, principalId: string): RunListCursor {
    if (
      encoded.length === 0 ||
      encoded.length > SPARC_RUN_LIST_LIMITS.cursorCharacters ||
      !CURSOR_ENCODING.test(encoded)
    ) {
      throw new SparcError('VALIDATION', 'listRuns cursor is malformed');
    }
    let parsed: unknown;
    try {
      const bytes = Buffer.from(encoded, 'base64url');
      if (bytes.toString('base64url') !== encoded) throw new Error('cursor encoding is not canonical');
      parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      throw new SparcError('VALIDATION', 'listRuns cursor is malformed');
    }
    if (!isRecord(parsed)) throw new SparcError('VALIDATION', 'listRuns cursor is malformed');
    const keys = Object.keys(parsed).sort();
    if (
      keys.length !== 3 ||
      keys[0] !== 'afterStateFile' ||
      keys[1] !== 'principalDigest' ||
      keys[2] !== 'schema' ||
      parsed.schema !== 1 ||
      typeof parsed.principalDigest !== 'string' ||
      !HEX_256.test(parsed.principalDigest) ||
      typeof parsed.afterStateFile !== 'string' ||
      !RUN_STATE_FILE.test(parsed.afterStateFile)
    ) {
      throw new SparcError('VALIDATION', 'listRuns cursor is malformed');
    }
    if (parsed.principalDigest !== hash(principalId)) {
      throw new SparcError('ISOLATION_VIOLATION', 'listRuns cursor belongs to a different principal');
    }
    return {
      schema: 1,
      principalDigest: parsed.principalDigest,
      afterStateFile: parsed.afterStateFile,
    };
  }

  private now(): string {
    const date = this.clock();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new SparcError('PERSISTENCE_FAILURE', 'clock returned an invalid date');
    }
    return date.toISOString();
  }

  private principalPath(principalId: string): string {
    return this.safePath(this.runsRoot, hash(principalId));
  }

  private statePath(principalId: string, runId: string, createDirectory: boolean): string {
    const directory = this.principalPath(principalId);
    if (createDirectory) this.ensureSecureDirectory(directory);
    return this.safePath(directory, `${hash(runId)}.json`);
  }

  private safePath(root: string, ...segments: string[]): string {
    const candidate = resolve(root, ...segments);
    const relation = relative(root, candidate);
    if (relation === '' && segments.length > 0) return candidate;
    if (relation.startsWith(`..${sep}`) || relation === '..' || isAbsolute(relation)) {
      throw new SparcError('ISOLATION_VIOLATION', 'resolved path escapes its configured root');
    }
    return candidate;
  }

  private rejectSymlinkSegments(target: string): void {
    const root = parse(target).root;
    const parts = relative(root, target).split(sep).filter(Boolean);
    let cursor = root;
    for (const part of parts) {
      cursor = join(cursor, part);
      if (lstatSync(cursor).isSymbolicLink()) {
        throw new SparcError('ISOLATION_VIOLATION', 'stateRoot may not traverse symbolic links', { cursor });
      }
    }
  }

  private ensureSecureDirectory(directory: string): void {
    this.safePath(this.stateRoot, relative(this.stateRoot, directory));
    if (existsSync(directory)) {
      this.assertSecureDirectory(directory);
      return;
    }
    mkdirSync(directory, { recursive: false, mode: 0o700 });
    this.assertSecureDirectory(directory);
  }

  private assertSecureDirectory(directory: string): void {
    const status = lstatSync(directory);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new SparcError('ISOLATION_VIOLATION', 'state directory must not be a symlink', { directory });
    }
    const resolved = realpathSync(directory);
    const relation = relative(this.stateRoot, resolved);
    if (relation.startsWith(`..${sep}`) || relation === '..' || isAbsolute(relation)) {
      throw new SparcError('ISOLATION_VIOLATION', 'state directory resolves outside stateRoot', { directory });
    }
    if ((status.mode & 0o077) !== 0) {
      throw new SparcError('ISOLATION_VIOLATION', 'state directory permissions are broader than 0700', {
        directory,
        mode: (status.mode & 0o777).toString(8),
      });
    }
  }

  private withLock<T>(statePath: string, operation: () => T): T {
    const directory = dirname(statePath);
    this.assertSecureDirectory(directory);
    const lockPath = this.safePath(directory, `${statePath.slice(directory.length + 1)}.lock`);
    const descriptor = this.acquireLock(lockPath);
    const ownedStatus = fstatSync(descriptor);
    try {
      return operation();
    } finally {
      closeSync(descriptor);
      try {
        const current = lstatSync(lockPath);
        if (
          current.isSymbolicLink() ||
          !current.isFile() ||
          current.dev !== ownedStatus.dev ||
          current.ino !== ownedStatus.ino
        ) {
          throw new SparcError('ISOLATION_VIOLATION', 'owned lock file was replaced during mutation');
        }
        unlinkSync(lockPath);
      } catch (error) {
        const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
        if (code !== 'ENOENT') throw error;
      }
    }
  }

  private acquireLock(lockPath: string): number {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ownerToken = randomBytes(16).toString('base64url');
      const candidatePath = this.safePath(
        dirname(lockPath),
        `.${basename(lockPath)}.${process.pid}.${ownerToken}.lease`,
      );
      let descriptor: number | undefined;
      let linked = false;
      let ownedDevice: number | undefined;
      let ownedInode: number | undefined;
      try {
        descriptor = openSync(
          candidatePath,
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0),
          0o600,
        );
        fchmodSync(descriptor, 0o600);
        const acquiredAtMs = Date.now();
        const lease: LockLease = {
          schema: 1,
          pid: process.pid,
          acquiredAtMs,
          expiresAtMs: acquiredAtMs + this.lockLeaseMs,
          ownerToken,
        };
        writeFileSync(descriptor, canonical(lease), 'utf8');
        fsyncSync(descriptor);
        const ownedStatus = fstatSync(descriptor);
        ownedDevice = ownedStatus.dev;
        ownedInode = ownedStatus.ino;
        linkSync(candidatePath, lockPath);
        linked = true;
        unlinkSync(candidatePath);
        return descriptor;
      } catch (error) {
        if (descriptor !== undefined) {
          closeSync(descriptor);
          if (linked && ownedDevice !== undefined && ownedInode !== undefined) {
            this.unlinkOwnedLock(lockPath, ownedDevice, ownedInode);
          }
          if (ownedDevice !== undefined && ownedInode !== undefined) {
            this.unlinkOwnedLock(candidatePath, ownedDevice, ownedInode);
          }
        }
        const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
        if (code !== 'EEXIST') {
          if (error instanceof SparcError) throw error;
          throw new SparcError('PERSISTENCE_FAILURE', 'failed to acquire the run lock', {
            cause: error instanceof Error ? error.message : String(error),
          });
        }
        if (!this.reclaimExpiredDeadLock(lockPath)) {
          throw new SparcError('STORE_BUSY', 'run is locked by a live or unexpired mutation');
        }
      }
    }
    throw new SparcError('STORE_BUSY', 'run lock contention exceeded the bounded acquisition attempts');
  }

  private reclaimExpiredDeadLock(lockPath: string): boolean {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(lockPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      const status = fstatSync(descriptor);
      if (!status.isFile() || (status.mode & 0o777) !== 0o600) {
        throw new SparcError('ISOLATION_VIOLATION', 'existing run lock is not a mode-0600 regular file');
      }
      if (status.size < 2 || status.size > SPARC_LOCK_LEASE_LIMITS.metadataBytes) {
        throw new SparcError('STORE_BUSY', 'existing run lock has invalid bounded lease metadata');
      }
      const parsed = JSON.parse(readFileSync(descriptor, 'utf8')) as unknown;
      const lease = this.validateLockLease(parsed);
      if (Date.now() < lease.expiresAtMs || this.isProcessAlive(lease.pid)) return false;
      closeSync(descriptor);
      descriptor = undefined;
      const current = lstatSync(lockPath);
      if (
        current.isSymbolicLink() ||
        !current.isFile() ||
        current.dev !== status.dev ||
        current.ino !== status.ino
      ) {
        return true;
      }
      unlinkSync(lockPath);
      const candidatePath = this.safePath(
        dirname(lockPath),
        `.${basename(lockPath)}.${lease.pid}.${lease.ownerToken}.lease`,
      );
      this.unlinkOwnedLock(candidatePath, status.dev, status.ino);
      const directoryDescriptor = openSync(dirname(lockPath), fsConstants.O_RDONLY);
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
      return true;
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
      if (code === 'ENOENT') return true;
      if (error instanceof SparcError) throw error;
      if (error instanceof SyntaxError) {
        throw new SparcError('STORE_BUSY', 'existing run lock has malformed lease metadata');
      }
      throw new SparcError('PERSISTENCE_FAILURE', 'failed to inspect existing run lock', {
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  private validateLockLease(value: unknown): LockLease {
    if (!isRecord(value) || value.schema !== 1) {
      throw new SparcError('STORE_BUSY', 'existing run lock has unsupported lease metadata');
    }
    const pid = value.pid;
    const acquiredAtMs = value.acquiredAtMs;
    const expiresAtMs = value.expiresAtMs;
    const ownerToken = value.ownerToken;
    if (
      !Number.isSafeInteger(pid) ||
      (pid as number) < 1 ||
      !Number.isSafeInteger(acquiredAtMs) ||
      !Number.isSafeInteger(expiresAtMs) ||
      (expiresAtMs as number) <= (acquiredAtMs as number) ||
      (expiresAtMs as number) - (acquiredAtMs as number) < SPARC_LOCK_LEASE_LIMITS.minimumMs ||
      (expiresAtMs as number) - (acquiredAtMs as number) > SPARC_LOCK_LEASE_LIMITS.maximumMs ||
      typeof ownerToken !== 'string' ||
      !/^[A-Za-z0-9_-]{22}$/.test(ownerToken)
    ) {
      throw new SparcError('STORE_BUSY', 'existing run lock has invalid lease metadata');
    }
    return {
      schema: 1,
      pid: pid as number,
      acquiredAtMs: acquiredAtMs as number,
      expiresAtMs: expiresAtMs as number,
      ownerToken,
    };
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
      return code !== 'ESRCH';
    }
  }

  private unlinkOwnedLock(lockPath: string, device: number, inode: number): void {
    try {
      const current = lstatSync(lockPath);
      if (!current.isSymbolicLink() && current.isFile() && current.dev === device && current.ino === inode) {
        unlinkSync(lockPath);
      }
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
      if (code !== 'ENOENT') throw error;
    }
  }

  private persist(statePath: string, state: StoredRun): void {
    state.integrityHash = hash(withoutIntegrity(state));
    const serialized = ensureStateSize(state);
    const directory = dirname(statePath);
    this.assertSecureDirectory(directory);
    if (existsSync(statePath)) {
      const status = lstatSync(statePath);
      if (!status.isFile() || status.isSymbolicLink()) {
        throw new SparcError('ISOLATION_VIOLATION', 'state target must be a regular file');
      }
    }
    this.temporaryCounter += 1;
    const temporaryPath = this.safePath(
      directory,
      `.${statePath.slice(directory.length + 1)}.${process.pid}.${this.temporaryCounter}.tmp`,
    );
    let descriptor: number | undefined;
    try {
      descriptor = openSync(
        temporaryPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0),
        0o600,
      );
      fchmodSync(descriptor, 0o600);
      writeFileSync(descriptor, serialized, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, statePath);
      const persisted = lstatSync(statePath);
      if (!persisted.isFile() || persisted.isSymbolicLink() || (persisted.mode & 0o777) !== 0o600) {
        throw new SparcError('PERSISTENCE_FAILURE', 'persisted state is not a mode-0600 regular file');
      }
      const directoryDescriptor = openSync(directory, fsConstants.O_RDONLY);
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
      if (error instanceof SparcError) throw error;
      throw new SparcError('PERSISTENCE_FAILURE', 'atomic state persistence failed', { cause: String(error) });
    }
  }

  private loadState(statePath: string, principalId: string, runId?: string): StoredRun {
    if (!existsSync(statePath)) {
      throw new SparcError('NOT_FOUND', 'SPARC run was not found', { runId });
    }
    try {
      const status = lstatSync(statePath);
      if (!status.isFile() || status.isSymbolicLink()) throw new Error('state path is not a regular file');
      if ((status.mode & 0o777) !== 0o600) throw new Error('state file mode is not 0600');
      const resolved = realpathSync(statePath);
      const relation = relative(this.stateRoot, resolved);
      if (relation.startsWith(`..${sep}`) || relation === '..' || isAbsolute(relation)) {
        throw new Error('state file resolves outside stateRoot');
      }
      const descriptor = openSync(statePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      let bytes: Buffer;
      try {
        if (fstatSync(descriptor).size > SPARC_LIMITS.stateBytes) throw new Error('state file exceeds size limit');
        bytes = readFileSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      return this.validateStoredState(parsed, principalId, runId);
    } catch (error) {
      if (error instanceof SparcError && error.code === 'NOT_FOUND') throw error;
      throw new SparcError('TAMPERED_STATE', 'stored SPARC state failed integrity validation', {
        runId,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private validateStoredState(value: unknown, principalId: string, runId?: string): StoredRun {
    if (!isRecord(value)) throw new Error('state is not an object');
    const state = value as unknown as StoredRun;
    if (state.schemaVersion !== STORE_SCHEMA_VERSION) throw new Error('unsupported schemaVersion');
    assertIdentifier(state.principalId, 'state.principalId');
    assertIdentifier(state.runId, 'state.runId');
    if (state.principalId !== principalId) throw new Error('principal isolation mismatch');
    if (runId !== undefined && state.runId !== runId) throw new Error('run isolation mismatch');
    assertText(state.title, 'state.title', SPARC_LIMITS.titleCharacters);
    if (!isSparcPhase(state.phase)) throw new Error('invalid phase');
    if (!['active', 'completed'].includes(state.status)) throw new Error('invalid status');
    if (!Number.isSafeInteger(state.revision) || state.revision < 1) throw new Error('invalid revision');
    assertFiniteDate(state.createdAt, 'createdAt');
    assertFiniteDate(state.updatedAt, 'updatedAt');
    if (state.completedAt !== undefined) assertFiniteDate(state.completedAt, 'completedAt');
    if (!HEX_256.test(state.integrityHash)) throw new Error('invalid integrityHash');
    if (hash(withoutIntegrity(state)) !== state.integrityHash) throw new Error('integrityHash mismatch');

    this.validateDefinitions(state.requirements, state.acceptanceTests);
    if (
      !HEX_256.test(state.requirementsDigest)
      || hash({ requirements: state.requirements, acceptanceTests: state.acceptanceTests }) !== state.requirementsDigest
    ) {
      throw new Error('stable requirements digest mismatch');
    }
    if (!RUN_GENESIS_NONCE.test(state.genesisNonce) || !HEX_256.test(state.genesisDigest)) {
      throw new Error('run genesis identity is missing or invalid');
    }
    if (computeRunGenesisDigest({
      principalId: state.principalId,
      runId: state.runId,
      title: state.title,
      requirements: state.requirements,
      acceptanceTests: state.acceptanceTests,
      genesisNonce: state.genesisNonce,
    }) !== state.genesisDigest) {
      throw new Error('run genesis identity does not match the immutable run definition');
    }
    if (!Array.isArray(state.artifacts) || state.artifacts.length > SPARC_LIMITS.artifacts) {
      throw new Error('invalid artifacts collection');
    }
    const artifactVersions = new Map<string, number>();
    for (const artifact of state.artifacts) {
      assertIdentifier(artifact.artifactId, 'artifact.artifactId');
      if (!isSparcPhase(artifact.phase)) throw new Error('artifact phase invalid');
      if (!Number.isSafeInteger(artifact.version) || artifact.version < 1) throw new Error('artifact version invalid');
      assertJsonValue(artifact.content, 'artifact.content');
      assertFiniteDate(artifact.createdAt, 'artifact.createdAt');
      if (artifact.createdBy !== state.principalId) throw new Error('artifact principal mismatch');
      const { digest, ...body } = artifact;
      if (!HEX_256.test(digest) || artifactDigest(body) !== digest) throw new Error('artifact digest mismatch');
      const key = `${artifact.phase}:${artifact.artifactId}`;
      const expected = (artifactVersions.get(key) ?? 0) + 1;
      if (artifact.version !== expected) throw new Error('artifact version sequence broken');
      artifactVersions.set(key, expected);
    }

    if (!Array.isArray(state.evidence) || state.evidence.length > SPARC_LIMITS.evidence) {
      throw new Error('invalid evidence collection');
    }
    const evidenceVersions = new Map<string, number>();
    const evidenceIdentities = new Map<string, { requirementId: string; testId: string | null }>();
    for (const evidence of state.evidence) {
      assertIdentifier(evidence.evidenceId, 'evidence.evidenceId');
      assertIdentifier(evidence.requirementId, 'evidence.requirementId');
      if (!state.requirements.some((entry) => entry.id === evidence.requirementId && entry.inScope)) {
        throw new Error('evidence requirement invalid');
      }
      if (!isSparcPhase(evidence.phase)) throw new Error('evidence phase invalid');
      if (!['pass', 'fail', 'exception'].includes(evidence.status)) throw new Error('evidence status invalid');
      if (!Number.isSafeInteger(evidence.version) || evidence.version < 1) throw new Error('evidence version invalid');
      assertText(evidence.summary, 'evidence.summary');
      if (evidence.details !== undefined) assertJsonValue(evidence.details, 'evidence.details');
      if (evidence.status === 'exception') {
        if (!evidence.authorization?.approved) throw new Error('exception evidence is unauthorized');
        assertIdentifier(evidence.authorization.authorizedBy, 'evidence.authorization.authorizedBy');
        assertText(evidence.authorization.reason, 'evidence.authorization.reason');
        assertFiniteDate(evidence.authorization.authorizedAt, 'evidence.authorization.authorizedAt');
      } else if (evidence.authorization !== undefined) {
        throw new Error('non-exception evidence has authorization');
      }
      assertFiniteDate(evidence.createdAt, 'evidence.createdAt');
      if (evidence.createdBy !== state.principalId) throw new Error('evidence principal mismatch');
      const identity = evidenceIdentities.get(evidence.evidenceId);
      if (
        identity &&
        (identity.requirementId !== evidence.requirementId || identity.testId !== (evidence.testId ?? null))
      ) {
        throw new Error('evidence alias was rebound across versions');
      }
      evidenceIdentities.set(evidence.evidenceId, {
        requirementId: evidence.requirementId,
        testId: evidence.testId ?? null,
      });
      this.verifyPersistedEvidenceAttestation(state, evidence);
      const { digest, ...body } = evidence;
      if (!HEX_256.test(digest) || evidenceDigest(body) !== digest) throw new Error('evidence digest mismatch');
      const expected = (evidenceVersions.get(evidence.evidenceId) ?? 0) + 1;
      if (evidence.version !== expected) throw new Error('evidence version sequence broken');
      evidenceVersions.set(evidence.evidenceId, expected);
    }

    if (!Array.isArray(state.corrections) || state.corrections.length > SPARC_LIMITS.corrections) {
      throw new Error('invalid corrections collection');
    }
    const corrections = new Set<string>();
    for (const correction of state.corrections) {
      assertIdentifier(correction.correctionId, 'correction.correctionId');
      if (corrections.has(correction.correctionId)) throw new Error('duplicate correctionId');
      corrections.add(correction.correctionId);
      assertText(correction.reason, 'correction.reason');
      if (correction.replacement !== undefined) assertJsonValue(correction.replacement, 'correction.replacement');
      assertFiniteDate(correction.createdAt, 'correction.createdAt');
      if (correction.createdBy !== state.principalId) throw new Error('correction principal mismatch');
      const targetExists = correction.target.kind === 'artifact'
        ? state.artifacts.some(
            (entry) => entry.artifactId === correction.target.id && entry.version === correction.target.version,
          )
        : correction.target.kind === 'evidence' && state.evidence.some(
            (entry) => entry.evidenceId === correction.target.id && entry.version === correction.target.version,
          );
      if (!targetExists) throw new Error('correction target invalid');
      const { digest, ...body } = correction;
      if (!HEX_256.test(digest) || correctionDigest(body) !== digest) throw new Error('correction digest mismatch');
    }

    const log = ReceiptLog.fromJSON(state.receiptLog);
    const receipts = log.entries();
    if (receipts.length !== state.revision) throw new Error('receipt count does not match revision');
    if (!Array.isArray(state.auditEvents) || state.auditEvents.length !== state.revision) {
      throw new Error('audit event count does not match revision');
    }
    state.auditEvents.forEach((event, index) => {
      const receipt = receipts[index]!;
      if (event.revision !== index + 1 || event.operation !== receipt.step) throw new Error('audit sequence mismatch');
      if (!HEX_256.test(event.requestDigest) || receipt.inputHash !== hash(event.requestDigest)) {
        throw new Error('audit input is not receipt-bound');
      }
      assertJsonValue(event.output, 'audit.output');
      if (receipt.outputHash !== hash(event.output) || event.receiptHash !== receipt.thisHash) {
        throw new Error('audit output is not receipt-bound');
      }
      if (receipt.runId !== state.runId || receipt.agent !== state.principalId || receipt.model !== CORE_MODEL) {
        throw new Error('receipt identity mismatch');
      }
    });
    const evidenceEventRevision = new Map<string, number>();
    for (const event of state.auditEvents) {
      const output = isRecord(event.output) ? event.output : undefined;
      const result = output && isRecord(output.result) ? output.result : undefined;
      if (result?.kind !== 'evidence' || typeof result.digest !== 'string') continue;
      if (evidenceEventRevision.has(result.digest)) throw new Error('duplicate evidence audit event');
      evidenceEventRevision.set(result.digest, event.revision);
    }
    for (const evidence of state.evidence) {
      const eventRevision = evidenceEventRevision.get(evidence.digest);
      if (eventRevision === undefined) throw new Error('evidence is not bound to an audit event');
      if (evidence.attestation && evidence.attestation.expectedRevision !== eventRevision - 1) {
        throw new Error('evidence attestation revision is not audit-bound');
      }
    }

    if (!Array.isArray(state.idempotency) || state.idempotency.length !== state.revision) {
      throw new Error('idempotency ledger count does not match revision');
    }
    const idempotencyKeys = new Set<string>();
    state.idempotency.forEach((record, index) => {
      assertIdentifier(record.key, 'idempotency.key');
      if (idempotencyKeys.has(record.key)) throw new Error('duplicate idempotency key');
      idempotencyKeys.add(record.key);
      const event = state.auditEvents[index]!;
      const receipt = receipts[index]!;
      if (record.operation !== event.operation || record.requestDigest !== event.requestDigest) {
        throw new Error('idempotency ledger is not audit-bound');
      }
      if (!record.response?.ok || record.response.revision !== index + 1) throw new Error('idempotency response invalid');
      if (record.response.receipt?.thisHash !== receipt.thisHash) throw new Error('idempotency receipt mismatch');
    });

    if (!Array.isArray(state.phaseHistory) || state.phaseHistory.length < 1) throw new Error('phase history missing');
    const genesisPhase = state.phaseHistory[0]!;
    if (genesisPhase.phase !== 'Specification' || genesisPhase.enteredRevision !== 1) {
      throw new Error('phase history genesis invalid');
    }
    state.phaseHistory.forEach((entry, index) => {
      if (entry.phase !== SPARC_PHASES[index]) throw new Error('phase history contains a skip or reorder');
      if (!Number.isSafeInteger(entry.enteredRevision) || entry.enteredRevision < 1 || entry.enteredRevision > state.revision) {
        throw new Error('phase history revision invalid');
      }
      if (index > 0 && (!HEX_256.test(entry.gateDigest ?? '') || entry.enteredRevision <= state.phaseHistory[index - 1]!.enteredRevision)) {
        throw new Error('phase history gate binding invalid');
      }
    });
    if (state.phaseHistory[state.phaseHistory.length - 1]!.phase !== state.phase) throw new Error('current phase mismatch');
    if (state.status === 'completed') {
      if (state.phase !== 'Completion' || state.completedAt === undefined) throw new Error('completed state invalid');
    } else if (state.completedAt !== undefined) {
      throw new Error('active state has completedAt');
    }
    ensureStateSize(state);
    return state;
  }
}
