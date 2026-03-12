import type { ValidatedHypothesis } from "./types";

// ── Recalibration ──────────────────────────────────────────────────────────

/**
 * Attenuate an investigation agent's confidence score by how strongly the
 * adversarial validator challenged the hypothesis.
 *
 * challenge_score=0   → no change
 * challenge_score=100 → confidence drops to 0
 */
export function recalibrateConfidence(
  originalConfidence: number,
  challengeScore: number
): number {
  const attenuation = 1 - challengeScore / 100;
  return Math.round(originalConfidence * attenuation);
}

// ── Escalation ─────────────────────────────────────────────────────────────

/**
 * Decide whether the investigation should be escalated to a human.
 *
 * Escalates when ANY of the following is true:
 * 1. Top hypothesis revised_confidence < 40  (low overall certainty)
 * 2. Top and second hypothesis are within 15 points  (no clear winner)
 * 3. Top hypothesis has more than 3 key_objections  (heavily challenged)
 */
export function shouldEscalate(hypotheses: ValidatedHypothesis[]): boolean {
  if (hypotheses.length === 0) return true;

  const sorted = [...hypotheses].sort((a, b) => b.revised_confidence - a.revised_confidence);
  const top = sorted[0]!;

  // Condition 1: top hypothesis confidence too low
  if (top.revised_confidence < 40) return true;

  // Condition 2: no clear winner (top and second within 15 points)
  const second = sorted[1];
  if (second !== undefined && top.revised_confidence - second.revised_confidence < 15) return true;

  // Condition 3: top hypothesis heavily objected to
  if (top.key_objections.length > 3) return true;

  return false;
}

// ── Re-ranking ─────────────────────────────────────────────────────────────

/**
 * Sort hypotheses by revised_confidence descending and assign updated ranks.
 */
export function rerankHypotheses(hypotheses: ValidatedHypothesis[]): ValidatedHypothesis[] {
  return [...hypotheses]
    .sort((a, b) => b.revised_confidence - a.revised_confidence)
    .map((h, i) => ({ ...h, original_rank: i + 1 }));
}
