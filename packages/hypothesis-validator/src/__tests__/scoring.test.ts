import { describe, it, expect } from "bun:test";
import { recalibrateConfidence, shouldEscalate, rerankHypotheses } from "../scoring";
import type { ValidatedHypothesis } from "../types";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeHypothesis(
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

// ── recalibrateConfidence ──────────────────────────────────────────────────

describe("recalibrateConfidence", () => {
  it("challenge_score=0 leaves confidence unchanged", () => {
    expect(recalibrateConfidence(87, 0)).toBe(87);
  });

  it("challenge_score=100 reduces confidence to 0", () => {
    expect(recalibrateConfidence(87, 100)).toBe(0);
  });

  it("challenge_score=50 halves confidence", () => {
    expect(recalibrateConfidence(80, 50)).toBe(40);
  });

  it("rounds to nearest integer", () => {
    // 87 * (1 - 10/100) = 87 * 0.9 = 78.3 → rounds to 78
    expect(recalibrateConfidence(87, 10)).toBe(78);
  });

  it("challenge_score=25 attenuates by 25%", () => {
    expect(recalibrateConfidence(100, 25)).toBe(75);
  });

  it("handles confidence=0 regardless of challenge", () => {
    expect(recalibrateConfidence(0, 60)).toBe(0);
  });
});

// ── shouldEscalate ─────────────────────────────────────────────────────────

describe("shouldEscalate — condition 1: revised_confidence < 40", () => {
  it("escalates when top hypothesis revised_confidence = 39", () => {
    const hypotheses = [
      makeHypothesis({ original_rank: 1, revised_confidence: 39 }),
      makeHypothesis({ original_rank: 2, revised_confidence: 20 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(true);
  });

  it("does NOT escalate when top revised_confidence = 40", () => {
    const hypotheses = [
      makeHypothesis({ original_rank: 1, revised_confidence: 40 }),
      makeHypothesis({ original_rank: 2, revised_confidence: 10 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(false);
  });

  it("escalates when all hypotheses are low confidence", () => {
    const hypotheses = [
      makeHypothesis({ revised_confidence: 14 }),
      makeHypothesis({ revised_confidence: 13 }),
      makeHypothesis({ revised_confidence: 11 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(true);
  });
});

describe("shouldEscalate — condition 2: no clear winner (top and second within 15)", () => {
  it("escalates when top=55 and second=45 (gap=10)", () => {
    const hypotheses = [
      makeHypothesis({ revised_confidence: 55 }),
      makeHypothesis({ revised_confidence: 45 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(true);
  });

  it("escalates when top=55 and second=41 (gap=14)", () => {
    const hypotheses = [
      makeHypothesis({ revised_confidence: 55 }),
      makeHypothesis({ revised_confidence: 41 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(true);
  });

  it("does NOT escalate when gap=15 (boundary)", () => {
    const hypotheses = [
      makeHypothesis({ revised_confidence: 70 }),
      makeHypothesis({ revised_confidence: 55 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(false);
  });

  it("does NOT escalate when gap=20", () => {
    const hypotheses = [
      makeHypothesis({ revised_confidence: 78 }),
      makeHypothesis({ revised_confidence: 10 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(false);
  });

  it("does NOT trigger condition 2 for single hypothesis", () => {
    // Single hypothesis, revised_confidence=50 → no condition triggers
    const hypotheses = [makeHypothesis({ revised_confidence: 50 })];
    expect(shouldEscalate(hypotheses)).toBe(false);
  });
});

describe("shouldEscalate — condition 3: top hypothesis > 3 key_objections", () => {
  it("escalates when top has 4 key_objections", () => {
    const hypotheses = [
      makeHypothesis({
        revised_confidence: 65,
        key_objections: ["obj1", "obj2", "obj3", "obj4"],
      }),
      makeHypothesis({ revised_confidence: 10 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(true);
  });

  it("does NOT escalate when top has exactly 3 key_objections", () => {
    const hypotheses = [
      makeHypothesis({
        revised_confidence: 65,
        key_objections: ["obj1", "obj2", "obj3"],
      }),
      makeHypothesis({ revised_confidence: 10 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(false);
  });

  it("evaluates key_objections on highest revised_confidence hypothesis, not original_rank", () => {
    // h2 has higher revised_confidence than h1; h2 has ≤3 objections → no escalate
    const hypotheses = [
      makeHypothesis({
        original_rank: 1,
        revised_confidence: 30,
        key_objections: ["obj1", "obj2", "obj3", "obj4"], // > 3 but not top
      }),
      makeHypothesis({
        original_rank: 2,
        revised_confidence: 75,
        key_objections: ["one"],
      }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(false);
  });
});

describe("shouldEscalate — empty array", () => {
  it("escalates when hypotheses array is empty", () => {
    expect(shouldEscalate([])).toBe(true);
  });
});

// ── Scenario-level acceptance criteria ────────────────────────────────────

describe("Scenario A acceptance: should NOT escalate", () => {
  it("Scenario A top hypothesis revised_confidence ≥60%", () => {
    const hypotheses = [
      makeHypothesis({ revised_confidence: 78, key_objections: ["minor ambiguity"] }),
      makeHypothesis({ revised_confidence: 10 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(false);
    expect(hypotheses[0]!.revised_confidence).toBeGreaterThanOrEqual(60);
  });
});

describe("Scenario C acceptance: should escalate", () => {
  it("Scenario C escalates via condition 1 (revised_confidence < 40)", () => {
    const hypotheses = [
      makeHypothesis({ revised_confidence: 14, key_objections: ["obj1", "obj2", "obj3"] }),
      makeHypothesis({ revised_confidence: 13 }),
      makeHypothesis({ revised_confidence: 11 }),
    ];
    expect(shouldEscalate(hypotheses)).toBe(true);
  });
});

// ── rerankHypotheses ───────────────────────────────────────────────────────

describe("rerankHypotheses", () => {
  it("sorts by revised_confidence descending", () => {
    const hypotheses = [
      makeHypothesis({ original_rank: 1, revised_confidence: 20 }),
      makeHypothesis({ original_rank: 2, revised_confidence: 78 }),
      makeHypothesis({ original_rank: 3, revised_confidence: 40 }),
    ];
    const reranked = rerankHypotheses(hypotheses);
    expect(reranked[0]!.revised_confidence).toBe(78);
    expect(reranked[1]!.revised_confidence).toBe(40);
    expect(reranked[2]!.revised_confidence).toBe(20);
  });

  it("updates original_rank to reflect new order", () => {
    const hypotheses = [
      makeHypothesis({ original_rank: 1, revised_confidence: 10 }),
      makeHypothesis({ original_rank: 2, revised_confidence: 75 }),
    ];
    const reranked = rerankHypotheses(hypotheses);
    expect(reranked[0]!.original_rank).toBe(1);
    expect(reranked[1]!.original_rank).toBe(2);
  });

  it("does not mutate the original array", () => {
    const hypotheses = [
      makeHypothesis({ original_rank: 1, revised_confidence: 10 }),
      makeHypothesis({ original_rank: 2, revised_confidence: 75 }),
    ];
    rerankHypotheses(hypotheses);
    expect(hypotheses[0]!.revised_confidence).toBe(10);
  });
});
