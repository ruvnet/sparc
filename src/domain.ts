import { canonical, type Receipt } from '@metaharness/harness';

export const SPARC_PHASES = [
  'Specification',
  'Pseudocode',
  'Architecture',
  'Refinement',
  'Completion',
] as const;

export type SparcPhase = (typeof SPARC_PHASES)[number];

export const SPARC_LIMITS = Object.freeze({
  idCharacters: 128,
  titleCharacters: 512,
  textCharacters: 32_768,
  contentBytes: 256 * 1024,
  stateBytes: 8 * 1024 * 1024,
  jsonDepth: 32,
  collectionItems: 2_048,
  requirements: 512,
  acceptanceTests: 2_048,
  artifacts: 1_024,
  evidence: 4_096,
  corrections: 1_024,
  idempotencyRecords: 8_192,
} as const);

/** Bounded pagination limits for run discovery. */
export const SPARC_RUN_LIST_LIMITS = Object.freeze({
  default: 10,
  maximum: 25,
  cursorCharacters: 512,
} as const);

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface AcceptanceTest {
  readonly id: string;
  readonly description: string;
  readonly command?: string;
}

export interface Requirement {
  readonly id: string;
  readonly statement: string;
  readonly inScope: boolean;
  readonly acceptanceTestIds: readonly string[];
  readonly nonGoalReason?: string;
}

export interface ArtifactVersion {
  readonly artifactId: string;
  readonly version: number;
  readonly phase: SparcPhase;
  readonly content: JsonValue;
  readonly digest: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export type EvidenceStatus = 'pass' | 'fail' | 'exception';

export const EVIDENCE_ATTESTATION_SCHEMA = 'ruvnet.sparc.evidence-attestation/v1' as const;
export const SPARC_RUN_GENESIS_SCHEMA = 'ruvnet.sparc.run-genesis/v1' as const;

export interface EvidenceAttestationInput {
  readonly keyId: string;
  readonly issuedAt: string;
  readonly algorithm: 'Ed25519';
  /** Unpadded RFC 4648 base64url encoding of the 64-byte Ed25519 signature. */
  readonly signature: string;
}

export interface EvidenceAttestationMetadata {
  readonly keyId: string;
  readonly issuedAt: string;
  readonly algorithm: 'Ed25519';
}

export interface EvidenceAttestation extends EvidenceAttestationInput {
  /** Revision the verifier authorized before this append. */
  readonly expectedRevision: number;
  /** Immutable identity of the exact run instance and its complete definition. */
  readonly genesisDigest: string;
  /** Digest of the immutable requirements and acceptance-test definitions. */
  readonly requirementsDigest: string;
  readonly payloadDigest: string;
  readonly verified: true;
}

export interface EvidenceAuthorization {
  readonly authorizedBy: string;
  readonly reason: string;
  readonly reference?: string;
  readonly authorizedAt: string;
  readonly approved: true;
}

export interface EvidenceVersion {
  readonly evidenceId: string;
  readonly version: number;
  readonly phase: SparcPhase;
  readonly requirementId: string;
  readonly testId?: string;
  readonly status: EvidenceStatus;
  readonly summary: string;
  readonly details?: JsonValue;
  readonly authorization?: EvidenceAuthorization;
  readonly attestation?: EvidenceAttestation;
  readonly digest: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

/** Immutable evidence citation used by Refinement and Completion artifacts. */
export interface EvidenceReference {
  readonly [key: string]: JsonValue;
  readonly evidenceId: string;
  readonly version: number;
  readonly digest: string;
}

export interface CorrectionTarget {
  readonly kind: 'artifact' | 'evidence';
  readonly id: string;
  readonly version: number;
}

export interface CorrectionRecord {
  readonly correctionId: string;
  readonly target: CorrectionTarget;
  readonly reason: string;
  readonly replacement?: JsonValue;
  readonly digest: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface PhaseHistoryEntry {
  readonly phase: SparcPhase;
  readonly enteredRevision: number;
  readonly gateDigest?: string;
}

export type RunStatus = 'active' | 'completed';

/** Public, immutable snapshot. Internal idempotency and persistence data are excluded. */
export interface SparcRun {
  readonly schemaVersion: 1;
  readonly principalId: string;
  readonly runId: string;
  readonly title: string;
  readonly phase: SparcPhase;
  readonly status: RunStatus;
  readonly revision: number;
  readonly requirements: readonly Requirement[];
  readonly acceptanceTests: readonly AcceptanceTest[];
  /** Unique identity for this run instance, including its complete immutable definition. */
  readonly genesisDigest: string;
  readonly requirementsDigest: string;
  readonly artifacts: readonly ArtifactVersion[];
  readonly evidence: readonly EvidenceVersion[];
  readonly corrections: readonly CorrectionRecord[];
  readonly phaseHistory: readonly PhaseHistoryEntry[];
  readonly receipts: readonly Receipt[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  /** Digest of the complete persisted state, including the receipt chain. */
  readonly digest: string;
}

export interface GateBlocker {
  readonly code: string;
  readonly phase: SparcPhase;
  readonly path: string;
  readonly message: string;
  readonly requirementId?: string;
  readonly evidenceId?: string;
}

export interface GateResult {
  readonly ok: boolean;
  readonly phase: SparcPhase;
  readonly blockers: readonly GateBlocker[];
  readonly digest: string;
}

export interface MutationContext {
  readonly principalId: string;
  readonly runId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
}

export interface CreateRunInput extends MutationContext {
  readonly title: string;
  readonly requirements: readonly Requirement[];
  readonly acceptanceTests: readonly AcceptanceTest[];
}

export interface PutArtifactInput extends MutationContext {
  /** Required assertion, bound inside the CAS/idempotency transaction. */
  readonly phase: SparcPhase;
  /** Defaults to the lowercase asserted phase name. */
  readonly artifactId?: string;
  readonly content: JsonValue;
}

export interface EvidenceAuthorizationInput {
  readonly authorizedBy: string;
  readonly reason: string;
  readonly reference?: string;
}

export interface EvidenceAttestationPayloadInput {
  readonly principalId: string;
  readonly runId: string;
  readonly genesisDigest: string;
  readonly requirementsDigest: string;
  readonly expectedRevision: number;
  readonly phase: SparcPhase;
  readonly evidenceId: string;
  readonly requirementId: string;
  readonly testId?: string;
  readonly status: EvidenceStatus;
  readonly summary: string;
  readonly details?: JsonValue;
  readonly authorization?: EvidenceAuthorizationInput;
  readonly attestation: EvidenceAttestationMetadata;
}

export interface AppendEvidenceInput extends MutationContext {
  readonly evidenceId: string;
  readonly requirementId: string;
  readonly testId?: string;
  readonly status: EvidenceStatus;
  readonly summary: string;
  readonly details?: JsonValue;
  readonly authorization?: EvidenceAuthorizationInput;
  /** Required for pass and exception. Optional, but verified when present, for fail. */
  readonly attestation?: EvidenceAttestationInput;
}

export interface AppendCorrectionInput extends MutationContext {
  readonly correctionId: string;
  readonly target: CorrectionTarget;
  readonly reason: string;
  readonly replacement?: JsonValue;
}

export interface AdvancePhaseInput extends MutationContext {
  /** Optional assertion. A value other than the immediate next phase is rejected. */
  readonly targetPhase?: SparcPhase;
}

export interface RunLocator {
  readonly principalId: string;
  readonly runId: string;
}

export interface ListRunsInput {
  readonly principalId: string;
  /** Opaque continuation token returned by a prior listRuns call for this principal. */
  readonly cursor?: string;
  /** Number of summaries to return. Defaults to 10 and cannot exceed 25. */
  readonly limit?: number;
}

/** Bounded run metadata; artifact, evidence, correction, and receipt bodies are excluded. */
export interface RunSummary {
  readonly principalId: string;
  readonly runId: string;
  readonly title: string;
  readonly phase: SparcPhase;
  readonly status: RunStatus;
  readonly revision: number;
  readonly genesisDigest: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly digest: string;
}

export interface ListRunsResult {
  readonly runs: readonly RunSummary[];
  /** Present only when another page is available. Bound to the input principal. */
  readonly nextCursor?: string;
}

export interface EvaluateGateInput extends RunLocator {
  readonly phase?: SparcPhase;
}

export interface MutationSuccess<T> {
  readonly ok: true;
  readonly runId: string;
  readonly revision: number;
  readonly phase: SparcPhase;
  readonly status: RunStatus;
  readonly value: T;
  readonly receipt: Receipt;
}

export interface BlockedMutationResult {
  readonly ok: false;
  readonly code: 'GATE_BLOCKED' | 'INVALID_TRANSITION';
  readonly runId: string;
  readonly revision: number;
  readonly phase: SparcPhase;
  readonly blockers: readonly GateBlocker[];
  readonly gate: GateResult;
}

export type AdvancePhaseResult = MutationSuccess<{ readonly from: SparcPhase; readonly to: SparcPhase }> | BlockedMutationResult;
export type CompleteRunResult = MutationSuccess<{ readonly completed: true }> | BlockedMutationResult;

export type SparcErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'RUN_EXISTS'
  | 'CAS_MISMATCH'
  | 'IDEMPOTENCY_MISMATCH'
  | 'ISOLATION_VIOLATION'
  | 'STATE_LIMIT'
  | 'STORE_BUSY'
  | 'TAMPERED_STATE'
  | 'PERSISTENCE_FAILURE';

export class SparcError extends Error {
  readonly code: SparcErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  readonly blockers: readonly GateBlocker[];

  constructor(
    code: SparcErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    blockers: readonly GateBlocker[] = [],
  ) {
    super(message);
    this.name = 'SparcError';
    this.code = code;
    this.details = details;
    this.blockers = blockers;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      blockers: this.blockers,
    };
  }
}

export const SPARC_IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:@-]{0,127})$/;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function isSparcPhase(value: unknown): value is SparcPhase {
  return typeof value === 'string' && (SPARC_PHASES as readonly string[]).includes(value);
}

export function phaseArtifactId(phase: SparcPhase): string {
  return phase.toLowerCase();
}

export function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !SPARC_IDENTIFIER_PATTERN.test(value)) {
    throw new SparcError('VALIDATION', `${field} must be a bounded portable identifier`, {
      field,
      maximumCharacters: SPARC_LIMITS.idCharacters,
    });
  }
}

export function assertText(
  value: unknown,
  field: string,
  maximumCharacters: number = SPARC_LIMITS.textCharacters,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maximumCharacters ||
    value.includes('\0')
  ) {
    throw new SparcError('VALIDATION', `${field} must be non-empty bounded text`, {
      field,
      maximumCharacters,
    });
  }
}

/** Rejects non-JSON values, cycles, prototype-bearing objects, excessive depth and oversized collections. */
export function assertJsonValue(value: unknown, field = 'content'): asserts value is JsonValue {
  const active = new WeakSet<object>();

  const visit = (current: unknown, path: string, depth: number): void => {
    if (depth > SPARC_LIMITS.jsonDepth) {
      throw new SparcError('VALIDATION', `${field} exceeds the JSON depth limit`, { field, path });
    }
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new SparcError('VALIDATION', `${field} contains a non-finite number`, { field, path });
      }
      return;
    }
    if (typeof current !== 'object') {
      throw new SparcError('VALIDATION', `${field} contains a non-JSON value`, { field, path });
    }
    if (active.has(current)) {
      throw new SparcError('VALIDATION', `${field} contains a cycle`, { field, path });
    }
    active.add(current);
    if (Array.isArray(current)) {
      if (current.length > SPARC_LIMITS.collectionItems) {
        throw new SparcError('VALIDATION', `${field} contains an oversized array`, { field, path });
      }
      current.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
    } else {
      if (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
        throw new SparcError('VALIDATION', `${field} must contain plain objects only`, { field, path });
      }
      const entries = Object.entries(current as Record<string, unknown>);
      if (entries.length > SPARC_LIMITS.collectionItems) {
        throw new SparcError('VALIDATION', `${field} contains an oversized object`, { field, path });
      }
      for (const [key, child] of entries) {
        if (key.length === 0 || key.length > SPARC_LIMITS.idCharacters || FORBIDDEN_OBJECT_KEYS.has(key)) {
          throw new SparcError('VALIDATION', `${field} contains an unsafe object key`, { field, path, key });
        }
        visit(child, `${path}.${key}`, depth + 1);
      }
    }
    active.delete(current);
  };

  visit(value, '$', 0);
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes > SPARC_LIMITS.contentBytes) {
    throw new SparcError('STATE_LIMIT', `${field} exceeds the content byte limit`, {
      field,
      bytes,
      maximumBytes: SPARC_LIMITS.contentBytes,
    });
  }
}

export function assertMutationContext(input: MutationContext): void {
  assertIdentifier(input.principalId, 'principalId');
  assertIdentifier(input.runId, 'runId');
  assertIdentifier(input.idempotencyKey, 'idempotencyKey');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new SparcError('VALIDATION', 'expectedRevision must be a non-negative safe integer', {
      expectedRevision: input.expectedRevision,
    });
  }
}

export function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

/** Canonical verifier subject. Nulls make optional-field binding cross-runtime stable. */
export function evidenceAttestationPayload(input: EvidenceAttestationPayloadInput): JsonValue {
  return {
    schema: EVIDENCE_ATTESTATION_SCHEMA,
    principalId: input.principalId,
    runId: input.runId,
    genesisDigest: input.genesisDigest,
    requirementsDigest: input.requirementsDigest,
    expectedRevision: input.expectedRevision,
    phase: input.phase,
    evidenceId: input.evidenceId,
    requirementId: input.requirementId,
    testId: input.testId ?? null,
    status: input.status,
    summary: input.summary,
    details: input.details === undefined ? null : cloneJson(input.details),
    authorization: input.authorization === undefined
      ? null
      : {
          authorizedBy: input.authorization.authorizedBy,
          reason: input.authorization.reason,
          reference: input.authorization.reference ?? null,
        },
    attestation: {
      keyId: input.attestation.keyId,
      issuedAt: input.attestation.issuedAt,
      algorithm: input.attestation.algorithm,
    },
  };
}

/** Exact UTF-8 bytes an Ed25519 verifier signs and the store verifies. */
export function evidenceAttestationBytes(input: EvidenceAttestationPayloadInput): Buffer {
  return Buffer.from(canonical(evidenceAttestationPayload(input)), 'utf8');
}
