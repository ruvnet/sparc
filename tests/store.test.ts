import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { hash } from '@metaharness/harness';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SparcError,
  SparcStore,
  evidenceAttestationBytes,
  type EvidenceAttestationInput,
  type EvidenceAuthorizationInput,
  type EvidenceStatus,
  type EvidenceReference,
  type EvidenceVersion,
  type JsonValue,
  type MutationContext,
} from '../src/index.js';

const roots: string[] = [];
const verifierKeyId = 'verifier-main';
const verifierIssuedAt = '2026-08-27T00:00:00.000Z';
const verifierPair = generateKeyPairSync('ed25519');
const verifierPublicPem = verifierPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function newRoot(label = 'sparc-store-'): string {
  const root = mkdtempSync(join(tmpdir(), label));
  roots.push(root);
  return root;
}

function newStore(root = newRoot()): SparcStore {
  let tick = 0;
  return new SparcStore({
    stateRoot: root,
    exceptionApprovers: ['approver'],
    evidenceVerifierKeys: { [verifierKeyId]: verifierPublicPem },
    clock: () => new Date(Date.UTC(2026, 7, 27, 0, 0, tick++)),
  });
}

interface EvidenceSubject {
  evidenceId: string;
  requirementId: string;
  testId?: string;
  status: EvidenceStatus;
  summary: string;
  details?: JsonValue;
  authorization?: EvidenceAuthorizationInput;
}

function signEvidence(
  store: SparcStore,
  subject: EvidenceSubject,
  options: {
    principalId?: string;
    runId?: string;
    keyId?: string;
    privateKey?: KeyObject;
    issuedAt?: string;
  } = {},
): EvidenceAttestationInput {
  const principalId = options.principalId ?? 'principal';
  const runId = options.runId ?? 'run';
  const run = store.getRun({ principalId, runId });
  const keyId = options.keyId ?? verifierKeyId;
  const issuedAt = options.issuedAt ?? verifierIssuedAt;
  const payload = {
    principalId,
    runId,
    genesisDigest: run.genesisDigest,
    requirementsDigest: run.requirementsDigest,
    expectedRevision: run.revision,
    phase: run.phase,
    evidenceId: subject.evidenceId,
    requirementId: subject.requirementId,
    ...(subject.testId === undefined ? {} : { testId: subject.testId }),
    status: subject.status,
    summary: subject.summary,
    ...(subject.details === undefined ? {} : { details: subject.details }),
    ...(subject.authorization === undefined ? {} : { authorization: subject.authorization }),
    attestation: { keyId, issuedAt, algorithm: 'Ed25519' as const },
  };
  return {
    ...payload.attestation,
    signature: sign(
      null,
      evidenceAttestationBytes(payload),
      options.privateKey ?? verifierPair.privateKey,
    ).toString('base64url'),
  };
}

function start(store: SparcStore, principalId = 'principal', runId = 'run') {
  return store.createRun({
    principalId,
    runId,
    expectedRevision: 0,
    idempotencyKey: 'create-1',
    title: 'Deterministic SPARC run',
    requirements: [{
      id: 'req1',
      statement: 'State transitions are deterministic',
      inScope: true,
      acceptanceTestIds: ['test1'],
    }],
    acceptanceTests: [{ id: 'test1', description: 'Run the deterministic store suite' }],
  });
}

const requirementCoverage = [{ requirementId: 'req1', acceptanceTestIds: ['test1'] }];

const specification = {
  outcome: 'A deterministic SPARC state machine',
  businessValue: 'Reduce release risk and rework',
  actors: ['maintainer'],
  inputs: ['phase artifacts'],
  outputs: ['verified run'],
  assumptions: ['Node 20'],
  constraints: ['bounded local state'],
  exclusions: ['model execution'],
  securityBoundaries: ['principal and run'],
  measurableSuccessCriteria: ['all acceptance tests pass'],
  requirementCoverage,
} as JsonValue;

const pseudocode = {
  controlFlow: ['validate then compare CAS then persist'],
  stateTransitions: [{
    from: 'current revision',
    event: 'validated mutation',
    to: 'next revision',
    onFailure: 'retain current revision',
  }],
  dataTransformations: ['canonical JSON to SHA-256'],
  failurePaths: [{ condition: 'gate blocked', error: 'structured blockers', stateEffect: 'none' }],
  retries: [{ condition: 'CAS mismatch', maxAttempts: 1, backoff: 'reread first', exhaustion: 'return conflict' }],
  idempotencyRules: [{
    scope: 'principal and run',
    keyBinding: 'canonical request digest',
    replay: 'identical original response',
    mismatch: 'reject without mutation',
  }],
  invariants: ['requirements never change'],
  walkthroughs: {
    success: 'valid request commits one new revision',
    failure: 'stale revision is rejected before persistence',
    invariantChecks: {
      success: ['requirements never change'],
      failure: ['requirements never change'],
    },
  },
  requirementCoverage,
} as JsonValue;

const architecture = {
  components: [{ name: 'store', responsibility: 'state' }],
  interfaces: [{ name: 'MCP', contract: 'bounded inputs, structured outputs, and errors' }],
  ownership: [{ component: 'store', owner: 'core' }],
  dataLifecycle: ['append then atomically persist'],
  trustBoundaries: [{ boundary: 'principal', control: 'authenticated principal isolation' }],
  deploymentModel: ['Node 20 local process'],
  observability: ['hash-chained receipts'],
  migrationPath: ['versioned state schema'],
  rollbackPath: ['restore previous package and state copy'],
  selectedDesign: ['mode-0600 file store with CAS'],
  alternatives: [{
    name: 'mutable shared JSON',
    rejectedBecause: 'cannot preserve isolation or audit history',
    tradeoffs: {
      deliveryCost: 'slightly lower',
      runtimeCost: 'similar',
      latency: 'similar',
      accuracy: 'lower due to races',
      security: 'weaker isolation',
      operationalRisk: 'high',
    },
  }],
  requirementCoverage,
} as JsonValue;

function evidenceReference(evidence: EvidenceVersion): EvidenceReference {
  return {
    evidenceId: evidence.evidenceId,
    version: evidence.version,
    digest: evidence.digest,
  };
}

function refinement(evidenceRefs: EvidenceReference[]): JsonValue {
  return {
    verification: ['vitest passed'],
    preservedBehavior: ['legacy Python surface remains separate'],
    increments: [{
      id: 'inc1',
      description: 'Implement deterministic store',
      requirementIds: ['req1'],
      evidenceRefs,
      preservesBehavior: true,
    }],
    requirementCoverage,
  };
}

function completion(evidenceRefs: EvidenceReference[]): JsonValue {
  return {
    finalDiff: ['reviewed core and tests'],
    documentation: ['public API documented'],
    observability: ['receipt verification available'],
    rollback: ['restore prior package and state snapshot'],
    residualRisks: ['multi-host filesystem semantics'],
    requirementTrace: [{ requirementId: 'req1', evidenceRefs }],
  };
}

function mutation(store: SparcStore, operation: 'artifact' | 'advance', key: string, content?: JsonValue) {
  const run = store.getRun({ principalId: 'principal', runId: 'run' });
  const context: MutationContext = {
    principalId: 'principal',
    runId: 'run',
    expectedRevision: run.revision,
    idempotencyKey: key,
  };
  return operation === 'artifact'
    ? store.putArtifact({ ...context, phase: run.phase, content: content! })
    : store.advancePhase(context);
}

function reachCompletion(store: SparcStore): EvidenceVersion {
  start(store);
  expect(mutation(store, 'artifact', 'spec-artifact', specification).ok).toBe(true);
  expect(mutation(store, 'advance', 'advance-pseudo').ok).toBe(true);
  expect(mutation(store, 'artifact', 'pseudo-artifact', pseudocode).ok).toBe(true);
  expect(mutation(store, 'advance', 'advance-architecture').ok).toBe(true);
  expect(mutation(store, 'artifact', 'architecture-artifact', architecture).ok).toBe(true);
  expect(mutation(store, 'advance', 'advance-refinement').ok).toBe(true);
  const run = store.getRun({ principalId: 'principal', runId: 'run' });
  const evidenceSubject: EvidenceSubject = {
    evidenceId: 'ev1',
    requirementId: 'req1',
    testId: 'test1',
    status: 'pass',
    summary: 'vitest passed',
  };
  const recordedEvidence = store.appendEvidence({
    principalId: 'principal',
    runId: 'run',
    expectedRevision: run.revision,
    idempotencyKey: 'evidence-pass',
    ...evidenceSubject,
    attestation: signEvidence(store, evidenceSubject),
  });
  expect(mutation(
    store,
    'artifact',
    'refinement-artifact',
    refinement([evidenceReference(recordedEvidence.value)]),
  ).ok).toBe(true);
  expect(mutation(store, 'advance', 'advance-completion').ok).toBe(true);
  return recordedEvidence.value;
}

function stateFile(root: string): string {
  const runsDirectory = join(root, 'runs');
  const principalDirectory = join(runsDirectory, readdirSync(runsDirectory)[0]!);
  const file = readdirSync(principalDirectory).find((entry) => entry.endsWith('.json'));
  if (!file) throw new Error('state file not found');
  return join(principalDirectory, file);
}

describe('SparcStore', () => {
  it('completes the golden five-phase flow with a verified receipt per revision', () => {
    const root = newRoot();
    const store = newStore(root);
    const evidence = reachCompletion(store);
    expect(mutation(
      store,
      'artifact',
      'completion-artifact',
      completion([evidenceReference(evidence)]),
    ).ok).toBe(true);
    const before = store.getRun({ principalId: 'principal', runId: 'run' });
    const result = store.completeRun({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: before.revision,
      idempotencyKey: 'complete-run',
    });
    expect(result).toMatchObject({ ok: true, phase: 'Completion', status: 'completed' });
    const final = store.getRun({ principalId: 'principal', runId: 'run' });
    expect(final.phaseHistory.map((entry) => entry.phase)).toEqual([
      'Specification',
      'Pseudocode',
      'Architecture',
      'Refinement',
      'Completion',
    ]);
    expect(final.receipts).toHaveLength(final.revision);
    expect(store.verify({ principalId: 'principal', runId: 'run' })).toMatchObject({
      ok: true,
      revision: final.revision,
      receiptCount: final.revision,
    });
    expect(() => store.appendCorrection({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: final.revision,
      idempotencyKey: 'post-completion-correction',
      correctionId: 'late-correction',
      target: { kind: 'artifact', id: 'completion', version: 1 },
      reason: 'completed state must be frozen',
    })).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    expect(store.getRun({ principalId: 'principal', runId: 'run' }).revision).toBe(final.revision);
    expect(lstatSync(stateFile(root)).mode & 0o777).toBe(0o600);
  });

  it('rejects phase skips without changing state', () => {
    const store = newStore();
    start(store);
    mutation(store, 'artifact', 'spec-artifact', specification);
    const before = store.getRun({ principalId: 'principal', runId: 'run' });
    const result = store.advancePhase({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: before.revision,
      idempotencyKey: 'skip-phase',
      targetPhase: 'Architecture',
    });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
    if (result.ok) throw new Error('phase skip unexpectedly succeeded');
    expect(result.blockers.map((entry) => entry.code)).toContain('PHASE_SKIP');
    expect(store.getRun({ principalId: 'principal', runId: 'run' }).revision).toBe(before.revision);
  });

  it('rejects stale compare-and-set revisions', () => {
    const store = newStore();
    start(store);
    expect(() => store.putArtifact({
      principalId: 'principal',
      runId: 'run',
      phase: 'Specification',
      expectedRevision: 0,
      idempotencyKey: 'stale-write',
      content: specification,
    })).toThrowError(expect.objectContaining({ code: 'CAS_MISMATCH' }));
  });

  it('returns an identical replay and rejects changed-payload key reuse', () => {
    const store = newStore();
    const created = start(store);
    expect(start(store)).toEqual(created);
    const artifact = store.putArtifact({
      principalId: 'principal',
      runId: 'run',
      phase: 'Specification',
      expectedRevision: 1,
      idempotencyKey: 'artifact-key',
      content: specification,
    });
    store.appendCorrection({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: 2,
      idempotencyKey: 'correction-key',
      correctionId: 'correction1',
      target: { kind: 'artifact', id: 'specification', version: 1 },
      reason: 'clarify without overwriting the immutable version',
      replacement: { note: 'clarified' },
    });
    expect(store.putArtifact({
      principalId: 'principal',
      runId: 'run',
      phase: 'Specification',
      expectedRevision: 1,
      idempotencyKey: 'artifact-key',
      content: specification,
    })).toEqual(artifact);
    expect(() => store.putArtifact({
      principalId: 'principal',
      runId: 'run',
      phase: 'Specification',
      expectedRevision: 1,
      idempotencyKey: 'artifact-key',
      content: { changed: true },
    })).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_MISMATCH' }));
    expect(store.getRun({ principalId: 'principal', runId: 'run' }).artifacts).toHaveLength(1);
  });

  it('binds artifact idempotency to the asserted phase inside the transaction', () => {
    const store = newStore();
    start(store);
    store.putArtifact({
      principalId: 'principal',
      runId: 'run',
      phase: 'Specification',
      expectedRevision: 1,
      idempotencyKey: 'phase-bound-key',
      content: specification,
    });
    const advanced = store.advancePhase({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: 2,
      idempotencyKey: 'advance-after-phase-bound-write',
    });
    expect(advanced).toMatchObject({ ok: true, phase: 'Pseudocode' });
    expect(() => store.putArtifact({
      principalId: 'principal',
      runId: 'run',
      phase: 'Pseudocode',
      expectedRevision: 1,
      idempotencyKey: 'phase-bound-key',
      content: specification,
    })).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_MISMATCH' }));
    expect(store.getRun({ principalId: 'principal', runId: 'run' }).artifacts).toHaveLength(1);
  });

  it('requires valid configured Ed25519 attestation for usable evidence and preserves replay', () => {
    const store = newStore();
    start(store);
    const subject: EvidenceSubject = {
      evidenceId: 'ev-attested',
      requirementId: 'req1',
      testId: 'test1',
      status: 'pass',
      summary: 'deterministic test passed',
    };
    const base = {
      principalId: 'principal',
      runId: 'run',
      expectedRevision: 1,
      idempotencyKey: 'attested-pass',
      ...subject,
    };
    expect(() => store.appendEvidence(base))
      .toThrowError(expect.objectContaining({ code: 'VALIDATION' }));

    const attacker = generateKeyPairSync('ed25519');
    const forged = signEvidence(store, subject, { privateKey: attacker.privateKey });
    expect(() => store.appendEvidence({ ...base, attestation: forged }))
      .toThrowError(expect.objectContaining({ code: 'VALIDATION' }));

    const attestation = signEvidence(store, subject);
    const unknownKey = signEvidence(store, subject, { keyId: 'unknown-verifier' });
    expect(() => store.appendEvidence({ ...base, attestation: unknownKey }))
      .toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => store.appendEvidence({
      ...base,
      attestation: { ...attestation, issuedAt: '2026-08-27T00:00:00Z' },
    })).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => store.appendEvidence({
      ...base,
      attestation: { ...attestation, signature: 'not-base64url!' },
    })).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));

    const recorded = store.appendEvidence({ ...base, attestation });
    expect(recorded.value.attestation).toMatchObject({
      keyId: verifierKeyId,
      algorithm: 'Ed25519',
      expectedRevision: 1,
      verified: true,
    });
    expect(store.appendEvidence({ ...base, attestation })).toEqual(recorded);
    expect(store.getRun({ principalId: 'principal', runId: 'run' }).evidence).toHaveLength(1);

    const failed = store.appendEvidence({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: 2,
      idempotencyKey: 'untrusted-failure',
      evidenceId: 'ev-fail',
      requirementId: 'req1',
      testId: 'test1',
      status: 'fail',
      summary: 'a failure may be recorded without trust elevation',
    });
    expect(failed.value.attestation).toBeUndefined();
  });

  it('rejects verifier evidence transplanted onto identical or changed run recreations', () => {
    const root = newRoot();
    const createTarget = (
      activeStore: SparcStore,
      statement = 'The original security property is enforced',
      description = 'Run the original verifier procedure',
      command = 'npm test -- original-security-property',
    ) => activeStore.createRun({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: 0,
      idempotencyKey: 'create-transplant-target',
      title: 'Definition-bound evidence',
      requirements: [{
        id: 'req1',
        statement,
        inScope: true,
        acceptanceTestIds: ['test1'],
      }],
      acceptanceTests: [{ id: 'test1', description, command }],
    });

    const original = newStore(root);
    createTarget(original);
    const subject: EvidenceSubject = {
      evidenceId: 'definition-bound-evidence',
      requirementId: 'req1',
      testId: 'test1',
      status: 'pass',
      summary: 'the original definition passed',
    };
    const attestation = signEvidence(original, subject);
    const originalRun = original.getRun({ principalId: 'principal', runId: 'run' });
    const originalGenesis = originalRun.genesisDigest;
    const originalRequirements = originalRun.requirementsDigest;
    expect(original.appendEvidence({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: 1,
      idempotencyKey: 'record-original-definition',
      ...subject,
      attestation,
    })).toMatchObject({ ok: true, revision: 2 });

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { mode: 0o700 });
    const identicalRecreation = newStore(root);
    createTarget(identicalRecreation);
    expect(identicalRecreation.getRun({ principalId: 'principal', runId: 'run' }).genesisDigest)
      .not.toBe(originalGenesis);
    expect(() => identicalRecreation.appendEvidence({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: 1,
      idempotencyKey: 'transplant-original-evidence',
      ...subject,
      attestation,
    })).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    expect(identicalRecreation.getRun({ principalId: 'principal', runId: 'run' }).evidence).toHaveLength(0);

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { mode: 0o700 });
    const changedRecreation = newStore(root);
    createTarget(
      changedRecreation,
      'A different and unverified security property is enforced',
      'Run a different verifier procedure',
      'npm test -- different-security-property',
    );
    const changedRun = changedRecreation.getRun({ principalId: 'principal', runId: 'run' });
    expect(changedRun.requirementsDigest).not.toBe(originalRequirements);
    expect(() => changedRecreation.appendEvidence({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: 1,
      idempotencyKey: 'transplant-onto-changed-definition',
      ...subject,
      attestation,
    })).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    expect(changedRun.evidence).toHaveLength(0);
  });

  it('rejects evidence alias rebinding across versions', () => {
    const store = newStore();
    store.createRun({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: 0,
      idempotencyKey: 'create-alias-run',
      title: 'Evidence alias binding',
      requirements: [
        { id: 'req1', statement: 'first', inScope: true, acceptanceTestIds: ['test1'] },
        { id: 'req2', statement: 'second', inScope: true, acceptanceTestIds: ['test2'] },
      ],
      acceptanceTests: [
        { id: 'test1', description: 'first test' },
        { id: 'test2', description: 'second test' },
      ],
    });
    const first: EvidenceSubject = {
      evidenceId: 'stable-evidence-id',
      requirementId: 'req1',
      testId: 'test1',
      status: 'pass',
      summary: 'first requirement passed',
    };
    store.appendEvidence({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: 1,
      idempotencyKey: 'first-alias-version',
      ...first,
      attestation: signEvidence(store, first),
    });
    const rebound: EvidenceSubject = {
      evidenceId: 'stable-evidence-id',
      requirementId: 'req2',
      testId: 'test2',
      status: 'pass',
      summary: 'attempted alias rebound',
    };
    expect(() => store.appendEvidence({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: 2,
      idempotencyKey: 'rebound-alias-version',
      ...rebound,
      attestation: signEvidence(store, rebound),
    })).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    expect(store.getRun({ principalId: 'principal', runId: 'run' }).evidence).toHaveLength(1);
  });

  it('keeps every read operation byte-for-byte nonmutating', () => {
    const root = newRoot();
    const store = newStore(root);
    start(store);
    mutation(store, 'artifact', 'spec-artifact', specification);
    const file = stateFile(root);
    const before = readFileSync(file);
    const digest = store.getRun({ principalId: 'principal', runId: 'run' }).digest;
    store.listRuns({ principalId: 'principal' });
    store.evaluateGate({ principalId: 'principal', runId: 'run' });
    store.verify({ principalId: 'principal', runId: 'run' });
    const after = readFileSync(file);
    expect(after.equals(before)).toBe(true);
    expect(store.getRun({ principalId: 'principal', runId: 'run' }).digest).toBe(digest);
  });

  it('lists only bounded run summaries through principal-bound opaque cursors', () => {
    const store = newStore();
    const expectedRunIds: string[] = [];
    for (let index = 0; index < 13; index += 1) {
      const runId = `run-${index.toString().padStart(2, '0')}`;
      expectedRunIds.push(runId);
      start(store, 'principal', runId);
    }

    const first = store.listRuns({ principalId: 'principal' });
    expect(first.runs).toHaveLength(10);
    expect(first.nextCursor).toEqual(expect.any(String));
    if (first.nextCursor === undefined) throw new Error('expected a continuation cursor');
    const cursor = first.nextCursor;
    expect(Object.keys(first.runs[0]!).sort()).toEqual([
      'createdAt',
      'digest',
      'genesisDigest',
      'phase',
      'principalId',
      'revision',
      'runId',
      'status',
      'title',
      'updatedAt',
    ]);
    expect(first.runs[0]).not.toHaveProperty('artifacts');
    expect(first.runs[0]).not.toHaveProperty('evidence');
    expect(first.runs[0]).not.toHaveProperty('receipts');

    const second = store.listRuns({ principalId: 'principal', cursor });
    expect(second.runs).toHaveLength(3);
    expect(second.nextCursor).toBeUndefined();
    const returnedRunIds = [...first.runs, ...second.runs].map((run) => run.runId);
    expect(new Set(returnedRunIds)).toEqual(new Set(expectedRunIds));
    expect(returnedRunIds).toHaveLength(expectedRunIds.length);

    expect(() => store.listRuns({
      principalId: 'different-principal',
      cursor,
    })).toThrowError(expect.objectContaining({ code: 'ISOLATION_VIOLATION' }));
  });

  it('rejects unbounded or malformed run-list pagination requests', () => {
    const store = newStore();
    start(store);
    expect(() => store.listRuns({ principalId: 'principal', limit: 26 }))
      .toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => store.listRuns({ principalId: 'principal', limit: 0 }))
      .toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => store.listRuns({ principalId: 'principal', limit: 1.5 }))
      .toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => store.listRuns({ principalId: 'principal', cursor: 'not+a+cursor' }))
      .toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
  });

  it('allows exactly one competing writer to win a stale revision race', async () => {
    const root = newRoot();
    const firstStore = newStore(root);
    const secondStore = newStore(root);
    start(firstStore);
    const write = (store: SparcStore, key: string) => Promise.resolve().then(() => store.putArtifact({
      principalId: 'principal',
      runId: 'run',
      phase: 'Specification',
      expectedRevision: 1,
      idempotencyKey: key,
      content: specification,
    }));
    const outcomes = await Promise.allSettled([write(firstStore, 'race-a'), write(secondStore, 'race-b')]);
    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'CAS_MISMATCH' });
    expect(firstStore.getRun({ principalId: 'principal', runId: 'run' }).revision).toBe(2);
  });

  it('never steals an expired live lock and safely reclaims it after the owner is killed', async () => {
    const root = newRoot();
    const store = newStore(root);
    start(store);
    const lockFile = `${stateFile(root)}.lock`;
    const childScript = String.raw`
      const fs = require('node:fs');
      const lockFile = process.argv[1];
      const acquiredAtMs = Date.now() - 2000;
      const lease = {
        schema: 1,
        pid: process.pid,
        acquiredAtMs,
        expiresAtMs: acquiredAtMs + 1000,
        ownerToken: 'AAAAAAAAAAAAAAAAAAAAAA'
      };
      const fd = fs.openSync(lockFile, 'wx', 0o600);
      fs.fchmodSync(fd, 0o600);
      fs.writeFileSync(fd, JSON.stringify(lease));
      fs.fsyncSync(fd);
      process.stdout.write('ready\n');
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['--input-type=commonjs', '-e', childScript, lockFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('lock owner did not become ready')), 5_000);
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.stdout.once('data', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      expect(() => store.putArtifact({
        principalId: 'principal',
        runId: 'run',
        phase: 'Specification',
        expectedRevision: 1,
        idempotencyKey: 'live-lock-write',
        content: specification,
      })).toThrowError(expect.objectContaining({ code: 'STORE_BUSY' }));
      child.kill('SIGKILL');
      await once(child, 'exit');
      expect(store.putArtifact({
        principalId: 'principal',
        runId: 'run',
        phase: 'Specification',
        expectedRevision: 1,
        idempotencyKey: 'reclaimed-lock-write',
        content: specification,
      })).toMatchObject({ ok: true, revision: 2 });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await once(child, 'exit');
      }
    }
  });

  it('rejects persisted artifact and receipt tampering', () => {
    const root = newRoot();
    const store = newStore(root);
    start(store);
    mutation(store, 'artifact', 'spec-artifact', specification);
    const file = stateFile(root);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      artifacts: Array<{ content: Record<string, unknown> }>;
    };
    parsed.artifacts[0]!.content.outcome = 'tampered';
    writeFileSync(file, JSON.stringify(parsed), { mode: 0o600 });
    chmodSync(file, 0o600);
    expect(() => store.getRun({ principalId: 'principal', runId: 'run' }))
      .toThrowError(expect.objectContaining({ code: 'TAMPERED_STATE' }));
  });

  it('fails closed on pre-genesis v1 state even when its legacy integrity hash is self-consistent', () => {
    const root = newRoot();
    const store = newStore(root);
    start(store);
    const file = stateFile(root);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    delete parsed.genesisNonce;
    delete parsed.genesisDigest;
    const { integrityHash: _legacyHash, ...legacyBody } = parsed;
    parsed.integrityHash = hash(legacyBody);
    writeFileSync(file, JSON.stringify(parsed), { mode: 0o600 });
    chmodSync(file, 0o600);
    expect(() => store.getRun({ principalId: 'principal', runId: 'run' }))
      .toThrowError(expect.objectContaining({ code: 'TAMPERED_STATE' }));
  });

  it('blocks Completion when the final trace omits required evidence', () => {
    const store = newStore();
    reachCompletion(store);
    mutation(store, 'artifact', 'completion-artifact', completion([]));
    const before = store.getRun({ principalId: 'principal', runId: 'run' });
    const result = store.completeRun({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: before.revision,
      idempotencyKey: 'complete-without-evidence',
    });
    expect(result).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    if (result.ok) throw new Error('Completion unexpectedly succeeded');
    expect(result.blockers.map((entry) => entry.code)).toContain('MISSING_COMPLETION_EVIDENCE');
    expect(store.getRun({ principalId: 'principal', runId: 'run' })).toMatchObject({
      revision: before.revision,
      status: 'active',
    });
  });

  it('isolates identical run IDs by principal and rejects symlink state roots', () => {
    const root = newRoot();
    const store = newStore(root);
    start(store, 'principal-a', 'shared-run');
    start(store, 'principal-b', 'shared-run');
    expect(store.getRun({ principalId: 'principal-a', runId: 'shared-run' }).principalId).toBe('principal-a');
    expect(store.getRun({ principalId: 'principal-b', runId: 'shared-run' }).principalId).toBe('principal-b');
    expect(() => store.getRun({ principalId: 'principal-c', runId: 'shared-run' }))
      .toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));

    const target = newRoot('sparc-target-');
    const link = join(tmpdir(), `sparc-link-${process.pid}-${Date.now()}`);
    roots.push(link);
    symlinkSync(target, link, 'dir');
    expect(() => new SparcStore({ stateRoot: link }))
      .toThrowError(expect.objectContaining({ code: 'ISOLATION_VIOLATION' }));
  });

  it('enforces bounded portable identifiers and explicit configured exceptions', () => {
    const store = newStore();
    start(store);
    expect(() => store.getRun({ principalId: '../escape', runId: 'run' }))
      .toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => store.appendEvidence({
      principalId: 'principal',
      runId: 'run',
      expectedRevision: 1,
      idempotencyKey: 'impersonated-exception',
      evidenceId: 'ev-exception',
      requirementId: 'req1',
      status: 'exception',
      summary: 'not approved',
      authorization: { authorizedBy: 'approver', reason: 'caller impersonated a configured approver' },
    })).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
  });
});
