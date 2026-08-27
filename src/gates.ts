import { canonical, hash } from '@metaharness/harness';
import {
  type ArtifactVersion,
  type EvidenceVersion,
  type EvidenceReference,
  type GateBlocker,
  type GateResult,
  type JsonValue,
  type Requirement,
  type SparcPhase,
  type SparcRun,
  phaseArtifactId,
} from './domain.js';

type JsonObject = { [key: string]: JsonValue };

function objectValue(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function textValue(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function textArray(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return strings.length === value.length ? strings : undefined;
}

function textOrTextArray(value: JsonValue | undefined): boolean {
  return textValue(value) !== undefined || textArray(value) !== undefined;
}

function recordArray(value: JsonValue | undefined): JsonObject[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const records = value.map(objectValue);
  return records.every((item): item is JsonObject => item !== undefined) ? records : undefined;
}

function add(
  blockers: GateBlocker[],
  phase: SparcPhase,
  code: string,
  path: string,
  message: string,
  extra: Pick<GateBlocker, 'requirementId' | 'evidenceId'> = {},
): void {
  blockers.push({ code, phase, path, message, ...extra });
}

function requireText(
  content: JsonObject,
  field: string,
  phase: SparcPhase,
  blockers: GateBlocker[],
): void {
  if (!textValue(content[field])) {
    add(blockers, phase, 'MISSING_TEXT', `artifact.${field}`, `${field} must be explicit non-empty text`);
  }
}

function requireTextCollection(
  content: JsonObject,
  field: string,
  phase: SparcPhase,
  blockers: GateBlocker[],
): void {
  if (!textOrTextArray(content[field])) {
    add(
      blockers,
      phase,
      'MISSING_COLLECTION',
      `artifact.${field}`,
      `${field} must contain at least one explicit item`,
    );
  }
}

function latestPhaseArtifact(run: SparcRun, phase: SparcPhase): ArtifactVersion | undefined {
  const expectedId = phaseArtifactId(phase);
  return run.artifacts
    .filter((artifact) => artifact.phase === phase && artifact.artifactId === expectedId)
    .sort((a, b) => b.version - a.version)[0];
}

function parseEvidenceReferences(
  value: JsonValue | undefined,
  phase: SparcPhase,
  path: string,
  blockers: GateBlocker[],
): EvidenceReference[] | undefined {
  const records = recordArray(value);
  if (!records) return undefined;
  const references: EvidenceReference[] = [];
  const seen = new Set<string>();
  records.forEach((record, index) => {
    const evidenceId = textValue(record.evidenceId);
    const version = record.version;
    const digest = textValue(record.digest);
    if (
      !evidenceId ||
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !digest ||
      !/^[a-f0-9]{64}$/.test(digest)
    ) {
      add(
        blockers,
        phase,
        'INVALID_EVIDENCE_REFERENCE',
        `${path}[${index}]`,
        'evidence references require evidenceId, positive version, and SHA-256 digest',
      );
      return;
    }
    const identity = `${evidenceId}:${version}:${digest}`;
    if (seen.has(identity)) {
      add(
        blockers,
        phase,
        'DUPLICATE_EVIDENCE_REFERENCE',
        `${path}[${index}]`,
        `evidence reference ${evidenceId} version ${version} is repeated`,
        { evidenceId },
      );
      return;
    }
    seen.add(identity);
    references.push({ evidenceId, version, digest });
  });
  return references;
}

function resolveEvidenceReference(run: SparcRun, reference: EvidenceReference): EvidenceVersion | undefined {
  return run.evidence.find(
    (evidence) =>
      evidence.evidenceId === reference.evidenceId &&
      evidence.version === reference.version &&
      evidence.digest === reference.digest,
  );
}

function requirementCoverage(
  content: JsonObject,
  run: SparcRun,
  phase: SparcPhase,
  blockers: GateBlocker[],
  specification = false,
): void {
  const coverage = recordArray(content.requirementCoverage);
  if (!coverage) {
    add(
      blockers,
      phase,
      'MISSING_REQUIREMENT_COVERAGE',
      'artifact.requirementCoverage',
      'requirementCoverage must be a non-empty list',
    );
    return;
  }

  const byRequirement = new Map<string, JsonObject>();
  for (let index = 0; index < coverage.length; index += 1) {
    const entry = coverage[index]!;
    const requirementId = textValue(entry.requirementId);
    if (!requirementId) {
      add(
        blockers,
        phase,
        'INVALID_REQUIREMENT_REFERENCE',
        `artifact.requirementCoverage[${index}].requirementId`,
        'coverage entries require a requirementId',
      );
      continue;
    }
    if (byRequirement.has(requirementId)) {
      add(
        blockers,
        phase,
        'DUPLICATE_REQUIREMENT_COVERAGE',
        `artifact.requirementCoverage[${index}].requirementId`,
        `requirement ${requirementId} is covered more than once`,
        { requirementId },
      );
      continue;
    }
    byRequirement.set(requirementId, entry);
  }

  for (const requirementId of byRequirement.keys()) {
    if (!run.requirements.some((requirement) => requirement.id === requirementId)) {
      add(
        blockers,
        phase,
        'UNKNOWN_REQUIREMENT',
        'artifact.requirementCoverage',
        `coverage references unknown requirement ${requirementId}`,
        { requirementId },
      );
    }
  }

  for (const requirement of run.requirements) {
    const entry = byRequirement.get(requirement.id);
    if (!entry) {
      add(
        blockers,
        phase,
        'UNCOVERED_REQUIREMENT',
        'artifact.requirementCoverage',
        `requirement ${requirement.id} has no phase coverage`,
        { requirementId: requirement.id },
      );
      continue;
    }
    if (!specification) continue;
    if (requirement.inScope) {
      const ids = textArray(entry.acceptanceTestIds);
      if (!ids) {
        add(
          blockers,
          phase,
          'MISSING_ACCEPTANCE_MAPPING',
          `artifact.requirementCoverage.${requirement.id}.acceptanceTestIds`,
          `in-scope requirement ${requirement.id} must map to acceptance tests`,
          { requirementId: requirement.id },
        );
        continue;
      }
      const actual = new Set(ids);
      for (const testId of requirement.acceptanceTestIds) {
        if (!actual.has(testId)) {
          add(
            blockers,
            phase,
            'INCOMPLETE_ACCEPTANCE_MAPPING',
            `artifact.requirementCoverage.${requirement.id}.acceptanceTestIds`,
            `acceptance test ${testId} is not mapped`,
            { requirementId: requirement.id },
          );
        }
      }
      for (const testId of actual) {
        if (!requirement.acceptanceTestIds.includes(testId)) {
          add(
            blockers,
            phase,
            'UNKNOWN_ACCEPTANCE_TEST',
            `artifact.requirementCoverage.${requirement.id}.acceptanceTestIds`,
            `acceptance test ${testId} is not registered for ${requirement.id}`,
            { requirementId: requirement.id },
          );
        }
      }
    } else if (!textValue(entry.nonGoalReason)) {
      add(
        blockers,
        phase,
        'MISSING_NON_GOAL',
        `artifact.requirementCoverage.${requirement.id}.nonGoalReason`,
        `out-of-scope requirement ${requirement.id} needs an explicit non-goal reason`,
        { requirementId: requirement.id },
      );
    }
  }
}

function specificationGate(content: JsonObject, run: SparcRun, blockers: GateBlocker[]): void {
  const phase = 'Specification';
  requireText(content, 'outcome', phase, blockers);
  requireText(content, 'businessValue', phase, blockers);
  for (const field of [
    'actors',
    'inputs',
    'outputs',
    'assumptions',
    'constraints',
    'exclusions',
    'securityBoundaries',
    'measurableSuccessCriteria',
  ]) {
    requireTextCollection(content, field, phase, blockers);
  }
  requirementCoverage(content, run, phase, blockers, true);
}

function pseudocodeGate(content: JsonObject, run: SparcRun, blockers: GateBlocker[]): void {
  const phase = 'Pseudocode';
  for (const field of [
    'controlFlow',
    'dataTransformations',
    'invariants',
  ]) {
    requireTextCollection(content, field, phase, blockers);
  }
  const structuredFields: Array<[string, readonly string[]]> = [
    ['stateTransitions', ['from', 'event', 'to', 'onFailure']],
    ['failurePaths', ['condition', 'error', 'stateEffect']],
    ['idempotencyRules', ['scope', 'keyBinding', 'replay', 'mismatch']],
  ];
  for (const [field, requiredFields] of structuredFields) {
    const records = recordArray(content[field]);
    if (!records) {
      add(
        blockers,
        phase,
        'MISSING_STRUCTURED_PSEUDOCODE',
        `artifact.${field}`,
        `${field} must be a non-empty list of deterministic records`,
      );
      continue;
    }
    records.forEach((record, index) => {
      for (const requiredField of requiredFields) {
        if (!textValue(record[requiredField])) {
          add(
            blockers,
            phase,
            'INCOMPLETE_PSEUDOCODE_RECORD',
            `artifact.${field}[${index}].${requiredField}`,
            `${field} records require ${requiredField}`,
          );
        }
      }
    });
  }
  const retries = recordArray(content.retries);
  if (!retries) {
    add(
      blockers,
      phase,
      'MISSING_BOUNDED_RETRY',
      'artifact.retries',
      'retries must be a non-empty list of bounded retry decisions',
    );
  } else {
    retries.forEach((retry, index) => {
      const maxAttempts = retry.maxAttempts;
      if (
        !textValue(retry.condition) ||
        typeof maxAttempts !== 'number' ||
        !Number.isSafeInteger(maxAttempts) ||
        maxAttempts < 0 ||
        maxAttempts > 100 ||
        !textValue(retry.backoff) ||
        !textValue(retry.exhaustion)
      ) {
        add(
          blockers,
          phase,
          'INVALID_RETRY_BOUND',
          `artifact.retries[${index}]`,
          'retry records require condition, maxAttempts 0..100, backoff, and exhaustion',
        );
      }
    });
  }
  const walkthroughs = objectValue(content.walkthroughs);
  if (!walkthroughs || !textOrTextArray(walkthroughs.success)) {
    add(
      blockers,
      phase,
      'MISSING_SUCCESS_WALKTHROUGH',
      'artifact.walkthroughs.success',
      'a complete success walkthrough is required',
    );
  }
  if (!walkthroughs || !textOrTextArray(walkthroughs.failure)) {
    add(
      blockers,
      phase,
      'MISSING_FAILURE_WALKTHROUGH',
      'artifact.walkthroughs.failure',
      'a complete failure walkthrough is required',
    );
  }
  const invariants = textArray(content.invariants) ?? [];
  const invariantChecks = walkthroughs ? objectValue(walkthroughs.invariantChecks) : undefined;
  for (const outcome of ['success', 'failure'] as const) {
    const checks = invariantChecks ? textArray(invariantChecks[outcome]) : undefined;
    if (!checks) {
      add(
        blockers,
        phase,
        'MISSING_INVARIANT_WALKTHROUGH',
        `artifact.walkthroughs.invariantChecks.${outcome}`,
        `${outcome} walkthrough must cite preserved invariants`,
      );
      continue;
    }
    for (const invariant of checks) {
      if (!invariants.includes(invariant)) {
        add(
          blockers,
          phase,
          'UNKNOWN_WALKTHROUGH_INVARIANT',
          `artifact.walkthroughs.invariantChecks.${outcome}`,
          `walkthrough cites undeclared invariant: ${invariant}`,
        );
      }
    }
  }
  requirementCoverage(content, run, phase, blockers);
}

function architectureGate(content: JsonObject, run: SparcRun, blockers: GateBlocker[]): void {
  const phase = 'Architecture';
  const architectureSchemas: Array<[string, readonly string[]]> = [
    ['components', ['name', 'responsibility']],
    ['interfaces', ['name', 'contract']],
    ['ownership', ['component', 'owner']],
    ['trustBoundaries', ['boundary', 'control']],
  ];
  const architectureRecords = new Map<string, JsonObject[]>();
  for (const [field, requiredFields] of architectureSchemas) {
    const entries = recordArray(content[field]);
    if (!entries) {
      add(
        blockers,
        phase,
        'MISSING_ARCHITECTURE_RECORDS',
        `artifact.${field}`,
        `${field} must be a non-empty list of explicit records`,
      );
      continue;
    }
    architectureRecords.set(field, entries);
    entries.forEach((entry, index) => {
      for (const requiredField of requiredFields) {
        if (!textValue(entry[requiredField])) {
          add(
            blockers,
            phase,
            'INCOMPLETE_ARCHITECTURE_RECORD',
            `artifact.${field}[${index}].${requiredField}`,
            `${field} records require ${requiredField}`,
          );
        }
      }
    });
  }
  const componentNames = new Set(
    (architectureRecords.get('components') ?? [])
      .map((component) => textValue(component.name))
      .filter((name): name is string => name !== undefined),
  );
  const ownedComponents = new Set<string>();
  for (const [index, ownership] of (architectureRecords.get('ownership') ?? []).entries()) {
    const component = textValue(ownership.component);
    if (!component) continue;
    if (!componentNames.has(component)) {
      add(
        blockers,
        phase,
        'UNKNOWN_OWNED_COMPONENT',
        `artifact.ownership[${index}].component`,
        `ownership references unknown component ${component}`,
      );
    }
    if (ownedComponents.has(component)) {
      add(
        blockers,
        phase,
        'DUPLICATE_COMPONENT_OWNER',
        `artifact.ownership[${index}].component`,
        `component ${component} has multiple ownership records`,
      );
    }
    ownedComponents.add(component);
  }
  for (const component of componentNames) {
    if (!ownedComponents.has(component)) {
      add(
        blockers,
        phase,
        'UNOWNED_COMPONENT',
        'artifact.ownership',
        `component ${component} has no explicit owner`,
      );
    }
  }
  for (const field of [
    'dataLifecycle',
    'deploymentModel',
    'observability',
    'migrationPath',
    'rollbackPath',
    'selectedDesign',
  ]) {
    requireTextCollection(content, field, phase, blockers);
  }

  const alternatives = recordArray(content.alternatives);
  if (!alternatives) {
    add(
      blockers,
      phase,
      'MISSING_ALTERNATIVES',
      'artifact.alternatives',
      'at least one viable rejected alternative and its tradeoffs are required',
    );
  } else {
    const dimensions = [
      'deliveryCost',
      'runtimeCost',
      'latency',
      'accuracy',
      'security',
      'operationalRisk',
    ];
    alternatives.forEach((alternative, index) => {
      if (!textValue(alternative.name) || !textValue(alternative.rejectedBecause)) {
        add(
          blockers,
          phase,
          'INCOMPLETE_ALTERNATIVE',
          `artifact.alternatives[${index}]`,
          'each alternative needs a name and rejection rationale',
        );
      }
      const tradeoffs = objectValue(alternative.tradeoffs);
      for (const dimension of dimensions) {
        if (!tradeoffs || !textValue(tradeoffs[dimension])) {
          add(
            blockers,
            phase,
            'MISSING_TRADEOFF',
            `artifact.alternatives[${index}].tradeoffs.${dimension}`,
            `alternative comparison must address ${dimension}`,
          );
        }
      }
    });
  }
  requirementCoverage(content, run, phase, blockers);
}

function refinementGate(content: JsonObject, run: SparcRun, blockers: GateBlocker[]): void {
  const phase = 'Refinement';
  requireTextCollection(content, 'verification', phase, blockers);
  requireTextCollection(content, 'preservedBehavior', phase, blockers);
  requirementCoverage(content, run, phase, blockers);

  const increments = recordArray(content.increments);
  if (!increments) {
    add(
      blockers,
      phase,
      'MISSING_INCREMENTS',
      'artifact.increments',
      'refinement requires at least one bounded, testable increment',
    );
    return;
  }

  const coveredRequirements = new Set<string>();
  const coveredTests = new Map<string, Set<string>>();
  increments.forEach((increment, index) => {
    if (!textValue(increment.id) || !textValue(increment.description)) {
      add(
        blockers,
        phase,
        'INCOMPLETE_INCREMENT',
        `artifact.increments[${index}]`,
        'each increment needs an id and description',
      );
    }
    const requirementIds = textArray(increment.requirementIds);
    const incrementRequirements = new Set<string>();
    if (!requirementIds) {
      add(
        blockers,
        phase,
        'MISSING_INCREMENT_REQUIREMENTS',
        `artifact.increments[${index}].requirementIds`,
        'each increment must identify the requirements it implements',
      );
    } else {
      requirementIds.forEach((id) => {
        const requirement = run.requirements.find((candidate) => candidate.id === id && candidate.inScope);
        if (!requirement) {
          add(
            blockers,
            phase,
            'INVALID_INCREMENT_REQUIREMENT',
            `artifact.increments[${index}].requirementIds`,
            `increment references unknown or out-of-scope requirement ${id}`,
            { requirementId: id },
          );
          return;
        }
        incrementRequirements.add(id);
        coveredRequirements.add(id);
      });
    }
    const evidenceRefs = parseEvidenceReferences(
      increment.evidenceRefs,
      phase,
      `artifact.increments[${index}].evidenceRefs`,
      blockers,
    );
    if (!evidenceRefs || evidenceRefs.length === 0) {
      add(
        blockers,
        phase,
        'MISSING_INCREMENT_EVIDENCE',
        `artifact.increments[${index}].evidenceRefs`,
        'each increment must cite immutable passing evidence references',
      );
    } else {
      for (const evidenceRef of evidenceRefs) {
        const evidenceId = evidenceRef.evidenceId;
        const evidence = resolveEvidenceReference(run, evidenceRef);
        if (!evidence || evidence.status !== 'pass') {
          add(
            blockers,
            phase,
            'NON_PASSING_INCREMENT_EVIDENCE',
            `artifact.increments[${index}].evidenceRefs`,
            `evidence ${evidenceId} version ${evidenceRef.version} is missing, digest-mismatched, or not passing`,
            { evidenceId },
          );
          continue;
        }
        if (evidence.phase !== 'Refinement') {
          add(
            blockers,
            phase,
            'WRONG_PHASE_REFINEMENT_EVIDENCE',
            `artifact.increments[${index}].evidenceRefs`,
            `evidence ${evidenceId} was not produced during Refinement`,
            { evidenceId },
          );
          continue;
        }
        if (evidence.attestation?.verified !== true) {
          add(
            blockers,
            phase,
            'UNATTESTED_INCREMENT_EVIDENCE',
            `artifact.increments[${index}].evidenceRefs`,
            `evidence ${evidenceId} is not verifier-attested`,
            { evidenceId },
          );
          continue;
        }
        if (!incrementRequirements.has(evidence.requirementId)) {
          add(
            blockers,
            phase,
            'CROSS_REQUIREMENT_INCREMENT_EVIDENCE',
            `artifact.increments[${index}].evidenceRefs`,
            `evidence ${evidenceId} belongs to ${evidence.requirementId}, which this increment does not implement`,
            { requirementId: evidence.requirementId, evidenceId },
          );
          continue;
        }
        if (!evidence.testId) {
          add(
            blockers,
            phase,
            'EVIDENCE_TEST_MISSING',
            `artifact.increments[${index}].evidenceRefs`,
            `evidence ${evidenceId} does not identify an acceptance test`,
            { requirementId: evidence.requirementId, evidenceId },
          );
          continue;
        }
        const requirement = run.requirements.find((candidate) => candidate.id === evidence.requirementId)!;
        if (!requirement.acceptanceTestIds.includes(evidence.testId)) {
          add(
            blockers,
            phase,
            'EVIDENCE_TEST_MISMATCH',
            `artifact.increments[${index}].evidenceRefs`,
            `evidence ${evidenceId} references an unregistered acceptance test`,
            { requirementId: evidence.requirementId, evidenceId },
          );
          continue;
        }
        const tests = coveredTests.get(evidence.requirementId) ?? new Set<string>();
        tests.add(evidence.testId);
        coveredTests.set(evidence.requirementId, tests);
      }
    }
    if (typeof increment.preservesBehavior !== 'boolean') {
      add(
        blockers,
        phase,
        'MISSING_BEHAVIOR_DECISION',
        `artifact.increments[${index}].preservesBehavior`,
        'each increment must explicitly state whether existing behavior is preserved',
      );
    } else if (increment.preservesBehavior === false && !textValue(increment.migrationApproval)) {
      add(
        blockers,
        phase,
        'MISSING_MIGRATION_APPROVAL',
        `artifact.increments[${index}].migrationApproval`,
        'behavior-changing increments require an approved migration reference',
      );
    }
  });

  for (const requirement of run.requirements.filter((candidate) => candidate.inScope)) {
    if (!coveredRequirements.has(requirement.id)) {
      add(
        blockers,
        phase,
        'UNIMPLEMENTED_REQUIREMENT',
        'artifact.increments',
        `no increment implements requirement ${requirement.id}`,
        { requirementId: requirement.id },
      );
    }
    const tests = coveredTests.get(requirement.id) ?? new Set<string>();
    for (const testId of requirement.acceptanceTestIds) {
      if (!tests.has(testId)) {
        add(
          blockers,
          phase,
          'MISSING_REFINEMENT_ACCEPTANCE_EVIDENCE',
          'artifact.increments',
          `requirement ${requirement.id} lacks verifier-attested passing evidence for acceptance test ${testId}`,
          { requirementId: requirement.id },
        );
      }
    }
  }
}

function usableCompletionEvidence(evidence: EvidenceVersion): boolean {
  if (evidence.attestation?.verified !== true) return false;
  return evidence.status === 'pass' || (evidence.status === 'exception' && evidence.authorization?.approved === true);
}

function completionGate(content: JsonObject, run: SparcRun, blockers: GateBlocker[]): void {
  const phase = 'Completion';
  for (const field of ['finalDiff', 'documentation', 'observability', 'rollback']) {
    requireTextCollection(content, field, phase, blockers);
  }
  requireTextCollection(content, 'residualRisks', phase, blockers);

  const trace = recordArray(content.requirementTrace);
  if (!trace) {
    add(
      blockers,
      phase,
      'MISSING_REQUIREMENT_TRACE',
      'artifact.requirementTrace',
      'completion requires a requirement-to-evidence trace',
    );
    return;
  }
  const byRequirement = new Map<string, JsonObject>();
  trace.forEach((entry, index) => {
    const requirementId = textValue(entry.requirementId);
    if (!requirementId) {
      add(
        blockers,
        phase,
        'INVALID_TRACE_REQUIREMENT',
        `artifact.requirementTrace[${index}].requirementId`,
        'trace entries require a requirementId',
      );
    } else if (byRequirement.has(requirementId)) {
      add(
        blockers,
        phase,
        'DUPLICATE_REQUIREMENT_TRACE',
        `artifact.requirementTrace[${index}].requirementId`,
        `requirement ${requirementId} appears more than once`,
        { requirementId },
      );
    } else {
      byRequirement.set(requirementId, entry);
    }
  });

  for (const requirement of run.requirements.filter((candidate) => candidate.inScope)) {
    const entry = byRequirement.get(requirement.id);
    if (!entry) {
      add(
        blockers,
        phase,
        'UNTRACED_REQUIREMENT',
        'artifact.requirementTrace',
        `in-scope requirement ${requirement.id} is absent from the final trace`,
        { requirementId: requirement.id },
      );
      continue;
    }
    const evidenceRefs = parseEvidenceReferences(
      entry.evidenceRefs,
      phase,
      `artifact.requirementTrace.${requirement.id}.evidenceRefs`,
      blockers,
    );
    if (!evidenceRefs || evidenceRefs.length === 0) {
      add(
        blockers,
        phase,
        'MISSING_COMPLETION_EVIDENCE',
        `artifact.requirementTrace.${requirement.id}.evidenceRefs`,
        `in-scope requirement ${requirement.id} has no evidence`,
        { requirementId: requirement.id },
      );
      continue;
    }
    const satisfiedTests = new Set<string>();
    for (const evidenceRef of evidenceRefs) {
      const evidenceId = evidenceRef.evidenceId;
      const evidence = resolveEvidenceReference(run, evidenceRef);
      if (!evidence) {
        add(
          blockers,
          phase,
          'UNKNOWN_COMPLETION_EVIDENCE',
          `artifact.requirementTrace.${requirement.id}.evidenceRefs`,
          `evidence ${evidenceId} version ${evidenceRef.version} is missing or digest-mismatched`,
          { requirementId: requirement.id, evidenceId },
        );
        continue;
      }
      if (evidence.requirementId !== requirement.id) {
        add(
          blockers,
          phase,
          'EVIDENCE_REQUIREMENT_MISMATCH',
          `artifact.requirementTrace.${requirement.id}.evidenceRefs`,
          `evidence ${evidenceId} belongs to ${evidence.requirementId}`,
          { requirementId: requirement.id, evidenceId },
        );
        continue;
      }
      if (!usableCompletionEvidence(evidence)) {
        add(
          blockers,
          phase,
          'NON_PASSING_COMPLETION_EVIDENCE',
          `artifact.requirementTrace.${requirement.id}.evidenceRefs`,
          `evidence ${evidenceId} is neither passing nor an authorized exception`,
          { requirementId: requirement.id, evidenceId },
        );
        continue;
      }
      if (evidence.phase !== 'Refinement' && evidence.phase !== 'Completion') {
        add(
          blockers,
          phase,
          'WRONG_PHASE_COMPLETION_EVIDENCE',
          `artifact.requirementTrace.${requirement.id}.evidenceRefs`,
          `evidence ${evidenceId} must be produced during Refinement or Completion`,
          { requirementId: requirement.id, evidenceId },
        );
        continue;
      }
      if (!evidence.testId) {
        add(
          blockers,
          phase,
          'EVIDENCE_TEST_MISSING',
          `artifact.requirementTrace.${requirement.id}.evidenceRefs`,
          `evidence ${evidenceId} does not identify the acceptance test it proves`,
          { requirementId: requirement.id, evidenceId },
        );
        continue;
      }
      if (!requirement.acceptanceTestIds.includes(evidence.testId)) {
        add(
          blockers,
          phase,
          'EVIDENCE_TEST_MISMATCH',
          `artifact.requirementTrace.${requirement.id}.evidenceRefs`,
          `evidence ${evidenceId} references test ${evidence.testId}, which is not registered for ${requirement.id}`,
          { requirementId: requirement.id, evidenceId },
        );
        continue;
      }
      satisfiedTests.add(evidence.testId);
    }
    for (const testId of requirement.acceptanceTestIds) {
      if (!satisfiedTests.has(testId)) {
        add(
          blockers,
          phase,
          'MISSING_ACCEPTANCE_EVIDENCE',
          `artifact.requirementTrace.${requirement.id}.evidenceRefs`,
          `requirement ${requirement.id} lacks usable evidence for acceptance test ${testId}`,
          { requirementId: requirement.id },
        );
      }
    }
  }

  for (const requirementId of byRequirement.keys()) {
    const requirement: Requirement | undefined = run.requirements.find((candidate) => candidate.id === requirementId);
    if (!requirement) {
      add(
        blockers,
        phase,
        'UNKNOWN_TRACE_REQUIREMENT',
        'artifact.requirementTrace',
        `trace references unknown requirement ${requirementId}`,
        { requirementId },
      );
    }
  }
}

/** Deterministic, side-effect-free evaluation of a phase artifact and its evidence. */
export function evaluatePhaseGate(run: SparcRun, phase: SparcPhase = run.phase): GateResult {
  const blockers: GateBlocker[] = [];
  const artifact = latestPhaseArtifact(run, phase);
  if (!artifact) {
    add(
      blockers,
      phase,
      'MISSING_PHASE_ARTIFACT',
      `artifacts.${phaseArtifactId(phase)}`,
      `the canonical ${phase} artifact is missing`,
    );
  } else {
    const content = objectValue(artifact.content);
    if (!content) {
      add(
        blockers,
        phase,
        'INVALID_PHASE_ARTIFACT',
        `artifacts.${phaseArtifactId(phase)}.content`,
        'the canonical phase artifact must contain an object',
      );
    } else if (phase === 'Specification') {
      specificationGate(content, run, blockers);
    } else if (phase === 'Pseudocode') {
      pseudocodeGate(content, run, blockers);
    } else if (phase === 'Architecture') {
      architectureGate(content, run, blockers);
    } else if (phase === 'Refinement') {
      refinementGate(content, run, blockers);
    } else {
      completionGate(content, run, blockers);
    }
  }

  blockers.sort((left, right) => {
    const path = left.path.localeCompare(right.path);
    return path || left.code.localeCompare(right.code) || left.message.localeCompare(right.message);
  });
  const digest = hash({
    phase,
    revision: run.revision,
    genesisDigest: run.genesisDigest,
    requirementsDigest: run.requirementsDigest,
    artifacts: run.artifacts.filter((entry) => entry.phase === phase).map((entry) => entry.digest),
    evidence: run.evidence.map((entry) => entry.digest),
    blockers: JSON.parse(canonical(blockers)) as JsonValue,
  });
  return { ok: blockers.length === 0, phase, blockers, digest };
}
