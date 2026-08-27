import { describe, expect, it } from 'vitest';
import {
  SPARC_PHASES,
  evaluatePhaseGate,
  type ArtifactVersion,
  type EvidenceVersion,
  type EvidenceReference,
  type JsonValue,
  type SparcPhase,
  type SparcRun,
} from '../src/index.js';

const timestamp = '2026-08-27T00:00:00.000Z';
const verifiedAttestation = {
  keyId: 'verifier-main',
  issuedAt: timestamp,
  algorithm: 'Ed25519' as const,
  signature: 'A'.repeat(86),
  expectedRevision: 0,
  genesisDigest: 'e'.repeat(64),
  requirementsDigest: 'b'.repeat(64),
  payloadDigest: '9'.repeat(64),
  verified: true as const,
};

function evidenceReference(evidence: EvidenceVersion): EvidenceReference {
  return { evidenceId: evidence.evidenceId, version: evidence.version, digest: evidence.digest };
}

function phaseRun(
  phase: SparcPhase,
  content: JsonValue,
  evidence: readonly EvidenceVersion[] = [],
): SparcRun {
  const artifact: ArtifactVersion = {
    artifactId: phase.toLowerCase(),
    version: 1,
    phase,
    content,
    digest: 'a'.repeat(64),
    createdAt: timestamp,
    createdBy: 'principal',
  };
  return {
    schemaVersion: 1,
    principalId: 'principal',
    runId: 'run',
    title: 'Gate test',
    phase,
    status: 'active',
    revision: 1,
    requirements: [
      {
        id: 'req1',
        statement: 'The result is deterministic',
        inScope: true,
        acceptanceTestIds: ['test1'],
      },
    ],
    acceptanceTests: [{ id: 'test1', description: 'Run deterministic test' }],
    genesisDigest: 'e'.repeat(64),
    requirementsDigest: 'b'.repeat(64),
    artifacts: [artifact],
    evidence,
    corrections: [],
    phaseHistory: SPARC_PHASES.slice(0, SPARC_PHASES.indexOf(phase) + 1).map((entry, index) => ({
      phase: entry,
      enteredRevision: index + 1,
      ...(index === 0 ? {} : { gateDigest: 'c'.repeat(64) }),
    })),
    receipts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    digest: 'd'.repeat(64),
  };
}

const coverage = [{ requirementId: 'req1', acceptanceTestIds: ['test1'] }];

describe('deterministic SPARC phase gates', () => {
  it('exposes only the canonical five phases', () => {
    expect(SPARC_PHASES).toEqual([
      'Specification',
      'Pseudocode',
      'Architecture',
      'Refinement',
      'Completion',
    ]);
  });

  it('accepts a complete Specification and rejects an unmapped requirement', () => {
    const content = {
      outcome: 'A deterministic release',
      businessValue: 'Lower rework',
      actors: ['maintainer'],
      inputs: ['request'],
      outputs: ['release'],
      assumptions: ['Node 20'],
      constraints: ['bounded state'],
      exclusions: ['model execution'],
      securityBoundaries: ['principal boundary'],
      measurableSuccessCriteria: ['all acceptance tests pass'],
      requirementCoverage: coverage,
    } as JsonValue;
    expect(evaluatePhaseGate(phaseRun('Specification', content))).toMatchObject({ ok: true, blockers: [] });

    const invalid = structuredClone(content) as Record<string, JsonValue>;
    invalid.requirementCoverage = [{ requirementId: 'unknown', acceptanceTestIds: ['test1'] }];
    const gate = evaluatePhaseGate(phaseRun('Specification', invalid));
    expect(gate.ok).toBe(false);
    expect(gate.blockers.map((entry) => entry.code)).toContain('UNCOVERED_REQUIREMENT');
  });

  it('requires both success and failure walkthroughs in Pseudocode', () => {
    const gate = evaluatePhaseGate(phaseRun('Pseudocode', {
      controlFlow: ['receive then validate'],
      stateTransitions: [{
        from: 'revision n',
        event: 'valid request',
        to: 'revision n plus one',
        onFailure: 'remain at revision n',
      }],
      dataTransformations: ['canonical JSON to digest'],
      failurePaths: [{ condition: 'stale CAS', error: 'CAS_MISMATCH', stateEffect: 'none' }],
      retries: [{ condition: 'CAS mismatch', maxAttempts: 1, backoff: 'reread', exhaustion: 'stop' }],
      idempotencyRules: [{
        scope: 'run',
        keyBinding: 'request digest',
        replay: 'same response',
        mismatch: 'reject',
      }],
      invariants: ['one phase at a time'],
      walkthroughs: {
        success: 'valid mutation commits',
        invariantChecks: {
          success: ['one phase at a time'],
          failure: ['one phase at a time'],
        },
      },
      requirementCoverage: coverage,
    }));
    expect(gate.ok).toBe(false);
    expect(gate.blockers.map((entry) => entry.code)).toContain('MISSING_FAILURE_WALKTHROUGH');
  });

  it('requires six-dimensional alternative analysis in Architecture', () => {
    const gate = evaluatePhaseGate(phaseRun('Architecture', {
      components: [{ name: 'store', responsibility: 'durable state' }],
      interfaces: [{ name: 'MCP', contract: 'bounded tool calls' }],
      ownership: [{ component: 'store', owner: 'core' }],
      dataLifecycle: ['append and retain'],
      trustBoundaries: [{ boundary: 'principal', control: 'authorization' }],
      deploymentModel: ['local Node process'],
      observability: ['receipt log'],
      migrationPath: ['schema version'],
      rollbackPath: ['restore prior package'],
      selectedDesign: ['file-backed CAS store'],
      alternatives: [{
        name: 'mutable JSON',
        rejectedBecause: 'not auditable',
        tradeoffs: { deliveryCost: 'low' },
      }],
      requirementCoverage: coverage,
    }));
    expect(gate.ok).toBe(false);
    expect(gate.blockers.map((entry) => entry.path)).toContain('artifact.alternatives[0].tradeoffs.security');
  });

  it('rejects non-passing Refinement evidence', () => {
    const failed: EvidenceVersion = {
      evidenceId: 'ev1',
      version: 1,
      phase: 'Refinement',
      requirementId: 'req1',
      testId: 'test1',
      status: 'fail',
      summary: 'test failed',
      digest: 'e'.repeat(64),
      createdAt: timestamp,
      createdBy: 'principal',
    };
    const gate = evaluatePhaseGate(phaseRun('Refinement', {
      verification: ['vitest'],
      preservedBehavior: ['public API'],
      increments: [{
        id: 'inc1',
        description: 'implement store',
        requirementIds: ['req1'],
        evidenceRefs: [evidenceReference(failed)],
        preservesBehavior: true,
      }],
      requirementCoverage: coverage,
    }, [failed]));
    expect(gate.ok).toBe(false);
    expect(gate.blockers.map((entry) => entry.code)).toContain('NON_PASSING_INCREMENT_EVIDENCE');
  });

  it('rejects cross-requirement Refinement evidence and incomplete acceptance coverage', () => {
    const content = {
      verification: ['vitest'],
      preservedBehavior: ['public API'],
      increments: [{
        id: 'inc1',
        description: 'implement req1',
        requirementIds: ['req1'],
        evidenceRefs: [{ evidenceId: 'ev-cross', version: 1, digest: '7'.repeat(64) }],
        preservesBehavior: true,
      }],
      requirementCoverage: [{ requirementId: 'req1' }, { requirementId: 'req2' }],
    } as JsonValue;
    const crossEvidence: EvidenceVersion = {
      evidenceId: 'ev-cross',
      version: 1,
      phase: 'Refinement',
      requirementId: 'req2',
      testId: 'test2',
      status: 'pass',
      summary: 'req2 passed',
      attestation: verifiedAttestation,
      digest: '7'.repeat(64),
      createdAt: timestamp,
      createdBy: 'principal',
    };
    const base = phaseRun('Refinement', content, [crossEvidence]);
    const crossRun: SparcRun = {
      ...base,
      requirements: [
        { id: 'req1', statement: 'first', inScope: true, acceptanceTestIds: ['test1'] },
        { id: 'req2', statement: 'second', inScope: true, acceptanceTestIds: ['test2'] },
      ],
      acceptanceTests: [
        { id: 'test1', description: 'first test' },
        { id: 'test2', description: 'second test' },
      ],
    };
    const crossGate = evaluatePhaseGate(crossRun);
    expect(crossGate.ok).toBe(false);
    expect(crossGate.blockers.map((entry) => entry.code)).toContain('CROSS_REQUIREMENT_INCREMENT_EVIDENCE');

    const firstOnly: EvidenceVersion = {
      ...crossEvidence,
      evidenceId: 'ev-first',
      requirementId: 'req1',
      testId: 'test1',
      digest: '8'.repeat(64),
    };
    const missingTestRun: SparcRun = {
      ...phaseRun('Refinement', {
        ...content as Record<string, JsonValue>,
        increments: [{
          id: 'inc1',
          description: 'implement req1',
          requirementIds: ['req1'],
          evidenceRefs: [evidenceReference(firstOnly)],
          preservesBehavior: true,
        }],
        requirementCoverage: [{ requirementId: 'req1' }],
      }, [firstOnly]),
      requirements: [{
        id: 'req1',
        statement: 'two checks',
        inScope: true,
        acceptanceTestIds: ['test1', 'test2'],
      }],
      acceptanceTests: [
        { id: 'test1', description: 'first test' },
        { id: 'test2', description: 'second test' },
      ],
    };
    const missingTestGate = evaluatePhaseGate(missingTestRun);
    expect(missingTestGate.ok).toBe(false);
    expect(missingTestGate.blockers.map((entry) => entry.message)).toContain(
      'requirement req1 lacks verifier-attested passing evidence for acceptance test test2',
    );
  });

  it('allows Completion only with passing evidence or an explicitly approved exception', () => {
    const exception: EvidenceVersion = {
      evidenceId: 'ev-exception',
      version: 1,
      phase: 'Completion',
      requirementId: 'req1',
      testId: 'test1',
      status: 'exception',
      summary: 'approved external dependency exception',
      authorization: {
        authorizedBy: 'approver',
        reason: 'vendor test unavailable',
        authorizedAt: timestamp,
        approved: true,
      },
      attestation: verifiedAttestation,
      digest: 'f'.repeat(64),
      createdAt: timestamp,
      createdBy: 'principal',
    };
    const exceptionRef = evidenceReference(exception);
    const content = {
      finalDiff: ['reviewed'],
      documentation: ['updated'],
      observability: ['receipt verification'],
      rollback: ['restore previous version'],
      residualRisks: ['vendor dependency'],
      requirementTrace: [{ requirementId: 'req1', evidenceRefs: [exceptionRef] }],
    } as JsonValue;
    expect(evaluatePhaseGate(phaseRun('Completion', content, [exception])).ok).toBe(true);

    const digestMismatch = {
      ...(content as Record<string, JsonValue>),
      requirementTrace: [{
        requirementId: 'req1',
        evidenceRefs: [{ ...exceptionRef, digest: '0'.repeat(64) }],
      }],
    } as JsonValue;
    const mismatchGate = evaluatePhaseGate(phaseRun('Completion', digestMismatch, [exception]));
    expect(mismatchGate.ok).toBe(false);
    expect(mismatchGate.blockers.map((entry) => entry.code)).toContain('UNKNOWN_COMPLETION_EVIDENCE');

    const unauthorized = { ...exception, authorization: undefined } as unknown as EvidenceVersion;
    const gate = evaluatePhaseGate(phaseRun('Completion', content, [unauthorized]));
    expect(gate.ok).toBe(false);
    expect(gate.blockers.map((entry) => entry.code)).toContain('NON_PASSING_COMPLETION_EVIDENCE');
  });

  it('requires usable evidence for every acceptance test and rejects unscoped evidence', () => {
    const passing: EvidenceVersion = {
      evidenceId: 'ev-test1',
      version: 1,
      phase: 'Completion',
      requirementId: 'req1',
      testId: 'test1',
      status: 'pass',
      summary: 'first test passed',
      attestation: verifiedAttestation,
      digest: '1'.repeat(64),
      createdAt: timestamp,
      createdBy: 'principal',
    };
    const base = phaseRun('Completion', {
      finalDiff: ['reviewed'],
      documentation: ['updated'],
      observability: ['receipts'],
      rollback: ['restore'],
      residualRisks: ['none'],
      requirementTrace: [{ requirementId: 'req1', evidenceRefs: [evidenceReference(passing)] }],
    }, [passing]);
    const twoTests: SparcRun = {
      ...base,
      requirements: [{
        id: 'req1',
        statement: 'The result is deterministic and isolated',
        inScope: true,
        acceptanceTestIds: ['test1', 'test2'],
      }],
      acceptanceTests: [
        { id: 'test1', description: 'determinism' },
        { id: 'test2', description: 'isolation' },
      ],
    };
    const missingSecond = evaluatePhaseGate(twoTests);
    expect(missingSecond.ok).toBe(false);
    expect(missingSecond.blockers.map((entry) => entry.message)).toContain(
      'requirement req1 lacks usable evidence for acceptance test test2',
    );

    const unscoped: EvidenceVersion = { ...passing, testId: undefined } as unknown as EvidenceVersion;
    const noTest = evaluatePhaseGate({ ...base, evidence: [unscoped] });
    expect(noTest.ok).toBe(false);
    expect(noTest.blockers.map((entry) => entry.code)).toContain('EVIDENCE_TEST_MISSING');
  });
});
