import { describe, expect, it } from 'vitest';
import {
  ReceiptLog,
  SPARC_TOOL_NAMES,
  appendTransitionReceipt,
  compileSparcPlan,
  createContinuityCheckpoint,
  createSparcPolicy,
  evaluateHarnessPromotion,
  sparcHarness,
  validateSparcHarness,
  verifyContinuityCheckpoint,
  type PromotionEvidence,
} from '../src/metaharness.js';

describe('MetaHarness composition', () => {
  it('compiles the five phases in dependency order', () => {
    expect(compileSparcPlan()).toEqual([
      { id: 'sparc:specification', kind: 'specification', deps: [] },
      { id: 'sparc:pseudocode', kind: 'pseudocode', deps: ['sparc:specification'] },
      { id: 'sparc:architecture', kind: 'architecture', deps: ['sparc:pseudocode'] },
      { id: 'sparc:refinement', kind: 'refinement', deps: ['sparc:architecture'] },
      { id: 'sparc:completion', kind: 'completion', deps: ['sparc:refinement'] },
    ]);
    expect(sparcHarness.tools.map((tool) => tool.name)).toEqual(SPARC_TOOL_NAMES);
    for (const tool of sparcHarness.tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect((tool.inputSchema as { properties?: object }).properties).toBeTruthy();
    }
    expect(sparcHarness.tools.find((tool) => tool.name === 'sparc_phase_submit')?.inputSchema)
      .toMatchObject({ required: expect.arrayContaining(['runId', 'phase', 'content', 'expectedRevision']) });
  });

  it('validates the pinned MCP definition through the MetaHarness kernel', async () => {
    await expect(validateSparcHarness()).resolves.toMatchObject({ planSteps: 5, tools: 8 });
  });

  it('denies unknown and dangerous tools by default', () => {
    const policy = createSparcPolicy();
    expect(policy.evaluate({ tool: 'sparc_run_get' }).allow).toBe(true);
    expect(policy.evaluate({ tool: 'shell' }).allow).toBe(false);
    expect(policy.evaluate({ tool: 'unknown' }).allow).toBe(false);
  });

  it('detects receipt tampering', () => {
    const log = new ReceiptLog();
    appendTransitionReceipt(log, { revision: 0 }, { revision: 1 }, {
      runId: 'run-1',
      phase: 'specification',
      principalId: 'alice',
      verdict: 'pass',
    });
    expect(log.verify()).toEqual({ ok: true });
    const exported = log.toJSON();
    exported.receipts[0]!.step = 'completion';
    expect(() => ReceiptLog.fromJSON(exported)).toThrow(/chain broken/);
  });

  it('detects continuity checkpoint tampering', () => {
    const checkpoint = createContinuityCheckpoint({ workspaceCommit: 'abc123', actionCount: 2 });
    expect(verifyContinuityCheckpoint(checkpoint)).toBe(true);
    checkpoint.actionCount = 3;
    expect(verifyContinuityCheckpoint(checkpoint)).toBe(false);
  });

  it('rejects ambiguous or malformed continuity values before hashing', () => {
    expect(() => createContinuityCheckpoint({ actionCount: -1 })).toThrow(/non-negative/);
    expect(() => createContinuityCheckpoint({ budget: { tokens: Number.NaN } })).toThrow(/finite/);
    expect(() => createContinuityCheckpoint({
      evaluationHistory: Array.from({ length: 1_000 }, () => ({ values: Array(10).fill(0) })),
    })).toThrow(/node limit/);
    expect(() => createContinuityCheckpoint({
      halt: {
        iteration: 1,
        lastProgress: null,
        staleCount: 2,
        lastFailure: null,
        failureRepeat: 0,
        pending: null,
      },
    })).toThrow(/cannot exceed/);
    const checkpoint = createContinuityCheckpoint();
    (checkpoint as unknown as { actionCount: number }).actionCount = Number.NaN;
    expect(verifyContinuityCheckpoint(checkpoint)).toBe(false);
  });

  it('requires every promotion clause and rejects malformed scores', () => {
    const decision = evaluateHarnessPromotion({
      baseline: { primary: 0.8, noopRate: 0.2, costPerWin: 2, regressed: false },
      candidate: { primary: 0.82, noopRate: 0.1, costPerWin: 1.9, regressed: false },
      anchor: { baseline: 0.7, candidate: 0.71 },
    });
    expect(decision.promote).toBe(true);
    expect(decision.gateFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(() => evaluateHarnessPromotion({
      baseline: { primary: Number.NaN, noopRate: 0.2, costPerWin: 2, regressed: false },
      candidate: { primary: 1, noopRate: 0.1, costPerWin: 1, regressed: false },
    })).toThrow(/finite/);
    expect(() => evaluateHarnessPromotion({
      baseline: { primary: 1, noopRate: 0.2, regressed: false },
      candidate: { primary: 1, noopRate: 0.1, costPerWin: 1, regressed: false },
    } as PromotionEvidence)).toThrow(/exactly/);
    expect(() => evaluateHarnessPromotion({
      baseline: { primary: 1, noopRate: 0.2, costPerWin: 1, regressed: null },
      candidate: { primary: 1, noopRate: 0.1, costPerWin: 1, regressed: false },
    } as unknown as PromotionEvidence)).toThrow(/boolean/);
    expect(() => evaluateHarnessPromotion({
      baseline: { primary: 1, noopRate: 1.1, costPerWin: 1, regressed: false },
      candidate: { primary: 1, noopRate: 0.1, costPerWin: 1, regressed: false },
    })).toThrow(/at most 1/);
  });
});
