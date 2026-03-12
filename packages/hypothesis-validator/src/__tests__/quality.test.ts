/**
 * Issue #15: Validator challenge quality and escalation condition tests.
 *
 * Covers the specific test cases called out in the issue:
 * - Scenario A/B: challenge_score ≤30 for clear root causes
 * - Scenario C: challenge_score ≥50 for all hypotheses
 * - Escalation conditions tested individually and via pipeline
 * - Named recalibrateConfidence cases from the spec
 */
import { describe, it, expect, mock } from "bun:test";
import type { ScenarioName } from "@shared/mock-data";
import { getScenario } from "@shared/mock-data";
import type { Alert, InvestigationResult } from "@shared/types";
import { validate } from "../validator";
import { recalibrateConfidence, shouldEscalate } from "../scoring";
import type { ValidatedHypothesis } from "../types";
import {
  scenarioAValidatorResponse,
  scenarioBValidatorResponse,
  scenarioCValidatorResponse,
} from "./fixtures";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSingleClient(response: unknown) {
  return {
    messages: {
      create: mock(async () => response),
    },
  };
}

function alertFromScenario(scenario: ScenarioName): Alert {
  const s = getScenario(scenario);
  return {
    id: `test-${scenario}`,
    title: s.triggerAlert.title,
    severity: s.triggerAlert.severity,
    service: s.triggerAlert.service,
    timestamp: new Date(s.triggerAlert.firedAt),
    labels: { env: "production" },
    description: s.description,
  };
}

function makeInvestigationResult(
  hypotheses: Array<{ description: string; confidence: number; evidence?: string[] }>
): InvestigationResult {
  return {
    id: "inv-test",
    alertId: "alert-test",
    startedAt: new Date(),
    completedAt: new Date(),
    status: "completed",
    hypotheses: hypotheses.map((h, i) => ({
      id: `hyp-${i + 1}`,
      description: h.description,
      confidence: h.confidence,
      evidence: h.evidence ?? ["supporting evidence"],
      relatedServices: [],
      suggestedActions: ["suggested action"],
    })),
    summary: "test investigation",
  };
}

function makeVH(
  overrides: Partial<ValidatedHypothesis> & Pick<ValidatedHypothesis, "revised_confidence">
): ValidatedHypothesis {
  return {
    original_rank: 1,
    original_confidence: overrides.revised_confidence,
    challenge_score: 0,
    key_objections: [],
    missing_evidence: [],
    ...overrides,
  };
}

// ── recalibrateConfidence — spec-named cases ───────────────────────────────

describe("recalibrateConfidence — spec cases", () => {
  it("recalibrateConfidence(80, 0) → 80 (no challenge = no change)", () => {
    expect(recalibrateConfidence(80, 0)).toBe(80);
  });

  it("recalibrateConfidence(80, 50) → 40 (50% challenge = halved)", () => {
    expect(recalibrateConfidence(80, 50)).toBe(40);
  });

  it("recalibrateConfidence(80, 100) → 0 (fully challenged = zeroed)", () => {
    expect(recalibrateConfidence(80, 100)).toBe(0);
  });
});

// ── shouldEscalate — spec-named cases ─────────────────────────────────────

describe("shouldEscalate — spec cases", () => {
  it("shouldEscalate([{revised_confidence: 35}]) → true", () => {
    expect(shouldEscalate([makeVH({ revised_confidence: 35 })])).toBe(true);
  });

  it("shouldEscalate([{revised_confidence: 75, ...}]) → false (single hypothesis, high confidence)", () => {
    expect(shouldEscalate([makeVH({ revised_confidence: 75 })])).toBe(false);
  });

  it("manually crafted all-equal-confidence hypotheses → escalate: true (condition 2)", () => {
    // Two hypotheses with same confidence → gap=0 < 15 → escalate
    const hypotheses = [
      makeVH({ revised_confidence: 50 }),
      makeVH({ revised_confidence: 50 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(true);
  });

  it("manually crafted <40% top confidence → escalate: true (condition 1)", () => {
    const hypotheses = [
      makeVH({ revised_confidence: 35 }),
      makeVH({ revised_confidence: 20 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(true);
  });
});

// ── Validator quality: Scenario A (clear root cause) ─────────────────────

describe("Validator quality — Scenario A (deploy regression)", () => {
  it("challenge_score for top hypothesis ≤30", async () => {
    const inv = makeInvestigationResult([
      {
        description: "Deploy abc123 introduced NPE in PaymentProcessor.java:247",
        confidence: 87,
        evidence: ["Deploy at 14:28", "Error rate spike at 14:30", "NPE logs at 14:31"],
      },
      {
        description: "Missing Stripe SCA config",
        confidence: 13,
        evidence: ["Config modified in abc123"],
      },
    ]);
    const result = await validate(inv, {
      client: makeSingleClient(scenarioAValidatorResponse) as never,
    });
    const topChallenge = result.validated_hypotheses[0]!.challenge_score;
    expect(topChallenge).toBeLessThanOrEqual(30);
  });

  it("escalate: false for Scenario A", async () => {
    const inv = makeInvestigationResult([
      { description: "Deploy regression hypothesis", confidence: 87 },
    ]);
    const result = await validate(inv, {
      client: makeSingleClient(scenarioAValidatorResponse) as never,
    });
    expect(result.escalate).toBe(false);
  });
});

// ── Validator quality: Scenario B (upstream failure) ─────────────────────

describe("Validator quality — Scenario B (upstream dependency failure)", () => {
  it("challenge_score for top hypothesis ≤30", async () => {
    const inv = makeInvestigationResult([
      {
        description: "inventory-db connection pool exhausted causing cascading latency",
        confidence: 91,
        evidence: ["CPU spike", "Pool exhaustion logs", "Cascading latency"],
      },
      {
        description: "inventory-db hardware/network issue",
        confidence: 9,
        evidence: ["No code changes"],
      },
    ]);
    const result = await validate(inv, {
      client: makeSingleClient(scenarioBValidatorResponse) as never,
    });
    const topChallenge = result.validated_hypotheses[0]!.challenge_score;
    expect(topChallenge).toBeLessThanOrEqual(30);
  });

  it("escalate: false for Scenario B (high confidence, gap >15)", async () => {
    const inv = makeInvestigationResult([
      { description: "connection pool exhaustion", confidence: 91 },
      { description: "hardware issue", confidence: 9 },
    ]);
    const result = await validate(inv, {
      client: makeSingleClient(scenarioBValidatorResponse) as never,
    });
    expect(result.escalate).toBe(false);
  });

  it("top revised_confidence ≥60%", async () => {
    const inv = makeInvestigationResult([
      { description: "connection pool exhaustion", confidence: 91 },
    ]);
    const result = await validate(inv, {
      client: makeSingleClient(scenarioBValidatorResponse) as never,
    });
    expect(result.validated_hypotheses[0]!.revised_confidence).toBeGreaterThanOrEqual(60);
  });
});

// ── Validator quality: Scenario C (inconclusive) ─────────────────────────

describe("Validator quality — Scenario C (no clear cause)", () => {
  it("challenge_score ≥50 for ALL hypotheses", async () => {
    const inv = makeInvestigationResult([
      { description: "Network instability hypothesis", confidence: 35 },
      { description: "GC pause hypothesis", confidence: 28 },
      { description: "Rate limiting hypothesis", confidence: 22 },
    ]);
    const result = await validate(inv, {
      client: makeSingleClient(scenarioCValidatorResponse) as never,
    });
    for (const vh of result.validated_hypotheses) {
      expect(vh.challenge_score).toBeGreaterThanOrEqual(50);
    }
  });

  it("escalate: true for Scenario C", async () => {
    const inv = makeInvestigationResult([
      { description: "Network instability", confidence: 35 },
      { description: "GC pauses", confidence: 28 },
      { description: "Rate limiting", confidence: 22 },
    ]);
    const result = await validate(inv, {
      client: makeSingleClient(scenarioCValidatorResponse) as never,
    });
    expect(result.escalate).toBe(true);
  });

  it("all revised_confidence values follow the formula for Scenario C", async () => {
    const inv = makeInvestigationResult([
      { description: "Network instability", confidence: 35 },
      { description: "GC pauses", confidence: 28 },
      { description: "Rate limiting", confidence: 22 },
    ]);
    const result = await validate(inv, {
      client: makeSingleClient(scenarioCValidatorResponse) as never,
    });
    for (const vh of result.validated_hypotheses) {
      const expected = Math.round(vh.original_confidence * (1 - vh.challenge_score / 100));
      expect(vh.revised_confidence).toBe(expected);
    }
  });
});

// ── shouldEscalate — all 3 conditions with clear root cause vs ambiguous ──

describe("shouldEscalate — condition coverage", () => {
  it("condition 1 + 2 both trigger for Scenario C-like low confidence", () => {
    // Condition 1: top < 40; Condition 2: gap = 1 < 15
    const hypotheses = [
      makeVH({ revised_confidence: 14, key_objections: ["o1", "o2"] }),
      makeVH({ revised_confidence: 13, key_objections: ["o1"] }),
      makeVH({ revised_confidence: 11, key_objections: [] }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(true);
  });

  it("clear winner with high confidence does NOT escalate", () => {
    // Scenario A-like: top=78, second=10, gap=68 ≥15, no excess objections
    const hypotheses = [
      makeVH({ revised_confidence: 78, key_objections: ["minor objection"] }),
      makeVH({ revised_confidence: 10, key_objections: [] }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(false);
  });
});
