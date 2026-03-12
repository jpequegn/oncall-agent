import type { Hypothesis } from "@shared/types";

export class HypothesisValidator {
  async validate(hypothesis: Hypothesis): Promise<Hypothesis> {
    // Placeholder: real implementation will query metrics, logs, traces
    return {
      ...hypothesis,
      confidence: hypothesis.confidence,
    };
  }

  rankHypotheses(hypotheses: Hypothesis[]): Hypothesis[] {
    return [...hypotheses].sort((a, b) => b.confidence - a.confidence);
  }
}
