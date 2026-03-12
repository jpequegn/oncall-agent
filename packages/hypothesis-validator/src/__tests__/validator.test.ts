import { describe, it, expect, mock } from "bun:test";
import type { InvestigationResult } from "@shared/types";
import { validate } from "../validator";
import { scenarioAValidatorResponse, scenarioCValidatorResponse } from "./fixtures";

// ── Mock Anthropic client factory ──────────────────────────────────────────

function makeMockClient(response: unknown) {
  return {
    messages: {
      create: mock(async () => response),
    },
  };
}

// ── Shared investigation results ───────────────────────────────────────────

const scenarioAResult: InvestigationResult = {
  id: "inv-scenario-a",
  alertId: "alert-deploy-regression",
  startedAt: new Date("2024-01-15T14:28:00Z"),
  completedAt: new Date("2024-01-15T14:35:00Z"),
  status: "completed",
  hypotheses: [
    {
      id: "hyp-1",
      description: "Deploy abc123 (v2.4.1) introduced a NullPointerException in PaymentProcessor.java:247 — ProviderFactory.getProvider() returns null when Stripe SCA config is missing",
      confidence: 87,
      evidence: [
        "Deploy abc123 at 14:28 touched PaymentProcessor.java and ProviderFactory.java",
        "Error rate spiked from 0.3% to 7.8% at 14:30, exactly 2 minutes after deploy",
        "Logs show NullPointerException at PaymentProcessor.java:247 starting 14:31:07",
      ],
      relatedServices: ["payment-service"],
      suggestedActions: ["Roll back payment-service to v2.4.0 via kubectl rollout undo"],
    },
    {
      id: "hyp-2",
      description: "Missing Stripe SCA provider configuration in payment-providers.yml introduced alongside deploy abc123",
      confidence: 13,
      evidence: [
        "config/payment-providers.yml was modified in abc123",
        "Log message references missing payment.provider.stripe config key",
      ],
      relatedServices: ["payment-service"],
      suggestedActions: ["Review payment-providers.yml for missing Stripe SCA config entries"],
    },
  ],
  rootCause: "Deploy abc123 (v2.4.1) introduced a NullPointerException in PaymentProcessor.java:247",
  summary: "Deploy abc123 introduced NPE in PaymentProcessor — recommend immediate rollback to v2.4.0",
};

const scenarioCResult: InvestigationResult = {
  id: "inv-scenario-c",
  alertId: "alert-no-clear-cause",
  startedAt: new Date("2024-01-15T22:00:00Z"),
  completedAt: new Date("2024-01-15T22:50:00Z"),
  status: "completed",
  hypotheses: [
    {
      id: "hyp-1",
      description: "Intermittent network instability between fraud-service and fraud-model-svc causing transient connection resets and read timeouts",
      confidence: 35,
      evidence: [
        "Errors appear at irregular intervals with no consistent pattern (7 spikes over 60 minutes)",
        "All failures are transient — retries succeed in 2-3 attempts",
        "No recent deploys (last deploy 4 days ago)",
      ],
      relatedServices: ["fraud-service", "fraud-model-svc"],
      suggestedActions: ["Monitor network metrics between fraud-service and fraud-model-svc pods"],
    },
    {
      id: "hyp-2",
      description: "fraud-model-svc experiencing periodic GC pauses or resource contention causing intermittent slowness",
      confidence: 28,
      evidence: [
        "Errors correlate with brief latency spikes on fraud-service",
        "Pattern consistent with GC stop-the-world pauses (short duration, self-resolving)",
      ],
      relatedServices: ["fraud-model-svc"],
      suggestedActions: ["Check fraud-model-svc heap metrics and GC logs"],
    },
    {
      id: "hyp-3",
      description: "External rate limiting or throttling from an underlying ML infrastructure dependency",
      confidence: 22,
      evidence: [
        "Spikes correlate loosely with traffic patterns but not consistently",
        "Past incident inc-007 involved fraud model issues with external service impact",
      ],
      relatedServices: ["fraud-service"],
      suggestedActions: ["Check ML feature store and model serving infrastructure quota metrics"],
    },
  ],
  summary: "fraud-service showing intermittent errors with no clear root cause — evidence inconclusive, human investigation recommended",
};

// ── Scenario A: Correct hypothesis NOT strongly challenged ─────────────────

describe("Scenario A — deploy regression validation", () => {
  it("returns a ValidationResult with correct incident_id", async () => {
    const result = await validate(scenarioAResult, {
      client: makeMockClient(scenarioAValidatorResponse) as never,
    });
    expect(result.incident_id).toBe("inv-scenario-a");
  });

  it("does NOT strongly challenge the correct deploy hypothesis", async () => {
    const result = await validate(scenarioAResult, {
      client: makeMockClient(scenarioAValidatorResponse) as never,
    });
    const top = result.validated_hypotheses[0]!;
    // The correct hypothesis should have challenge_score < 40 (not strongly challenged)
    expect(top.challenge_score).toBeLessThan(40);
  });

  it("top hypothesis revised_confidence ≥40% (no escalation)", async () => {
    const result = await validate(scenarioAResult, {
      client: makeMockClient(scenarioAValidatorResponse) as never,
    });
    const topRevised = result.validated_hypotheses[0]!.revised_confidence;
    expect(topRevised).toBeGreaterThanOrEqual(40);
  });

  it("does NOT escalate for Scenario A", async () => {
    const result = await validate(scenarioAResult, {
      client: makeMockClient(scenarioAValidatorResponse) as never,
    });
    expect(result.escalate).toBe(false);
  });

  it("revised_confidence = original * (1 - challenge_score/100)", async () => {
    const result = await validate(scenarioAResult, {
      client: makeMockClient(scenarioAValidatorResponse) as never,
    });
    for (const vh of result.validated_hypotheses) {
      const expected = Math.round(vh.original_confidence * (1 - vh.challenge_score / 100));
      expect(vh.revised_confidence).toBe(expected);
    }
  });

  it("has key_objections array on each hypothesis", async () => {
    const result = await validate(scenarioAResult, {
      client: makeMockClient(scenarioAValidatorResponse) as never,
    });
    for (const vh of result.validated_hypotheses) {
      expect(Array.isArray(vh.key_objections)).toBe(true);
    }
  });

  it("has missing_evidence array on each hypothesis", async () => {
    const result = await validate(scenarioAResult, {
      client: makeMockClient(scenarioAValidatorResponse) as never,
    });
    for (const vh of result.validated_hypotheses) {
      expect(Array.isArray(vh.missing_evidence)).toBe(true);
    }
  });

  it("validator_notes is non-empty string", async () => {
    const result = await validate(scenarioAResult, {
      client: makeMockClient(scenarioAValidatorResponse) as never,
    });
    expect(typeof result.validator_notes).toBe("string");
    expect(result.validator_notes.length).toBeGreaterThan(10);
  });
});

// ── Scenario C: Inconclusive — validator escalates ────────────────────────

describe("Scenario C — inconclusive investigation validation", () => {
  it("sets escalate=true for low-confidence investigation", async () => {
    const result = await validate(scenarioCResult, {
      client: makeMockClient(scenarioCValidatorResponse) as never,
    });
    expect(result.escalate).toBe(true);
  });

  it("top hypothesis revised_confidence <40%", async () => {
    const result = await validate(scenarioCResult, {
      client: makeMockClient(scenarioCValidatorResponse) as never,
    });
    const topRevised = result.validated_hypotheses[0]!.revised_confidence;
    expect(topRevised).toBeLessThan(40);
  });

  it("escalation_reason is present and non-empty", async () => {
    const result = await validate(scenarioCResult, {
      client: makeMockClient(scenarioCValidatorResponse) as never,
    });
    expect(result.escalation_reason).toBeTruthy();
    expect((result.escalation_reason ?? "").length).toBeGreaterThan(10);
  });

  it("all revised_confidence values follow the formula", async () => {
    const result = await validate(scenarioCResult, {
      client: makeMockClient(scenarioCValidatorResponse) as never,
    });
    for (const vh of result.validated_hypotheses) {
      const expected = Math.round(vh.original_confidence * (1 - vh.challenge_score / 100));
      expect(vh.revised_confidence).toBe(expected);
    }
  });

  it("produces 3 validated hypotheses for Scenario C", async () => {
    const result = await validate(scenarioCResult, {
      client: makeMockClient(scenarioCValidatorResponse) as never,
    });
    expect(result.validated_hypotheses.length).toBe(3);
  });

  it("makes exactly 1 API call (single-turn validator)", async () => {
    const client = makeMockClient(scenarioCValidatorResponse);
    await validate(scenarioCResult, { client: client as never });
    expect(client.messages.create.mock.calls.length).toBe(1);
  });
});

// ── Schema validation ──────────────────────────────────────────────────────

describe("ValidationResult schema validation", () => {
  const cases: [string, InvestigationResult, unknown][] = [
    ["Scenario A", scenarioAResult, scenarioAValidatorResponse],
    ["Scenario C", scenarioCResult, scenarioCValidatorResponse],
  ];

  for (const [label, invResult, response] of cases) {
    it(`${label}: result has required top-level fields`, async () => {
      const result = await validate(invResult, {
        client: makeMockClient(response) as never,
      });
      expect(typeof result.incident_id).toBe("string");
      expect(Array.isArray(result.validated_hypotheses)).toBe(true);
      expect(typeof result.escalate).toBe("boolean");
      expect(typeof result.validator_notes).toBe("string");
    });

    it(`${label}: each validated_hypothesis has required fields`, async () => {
      const result = await validate(invResult, {
        client: makeMockClient(response) as never,
      });
      for (const vh of result.validated_hypotheses) {
        expect(typeof vh.original_rank).toBe("number");
        expect(typeof vh.original_confidence).toBe("number");
        expect(typeof vh.challenge_score).toBe("number");
        expect(vh.challenge_score).toBeGreaterThanOrEqual(0);
        expect(vh.challenge_score).toBeLessThanOrEqual(100);
        expect(Array.isArray(vh.key_objections)).toBe(true);
        expect(Array.isArray(vh.missing_evidence)).toBe(true);
        expect(typeof vh.revised_confidence).toBe("number");
        expect(vh.revised_confidence).toBeGreaterThanOrEqual(0);
        expect(vh.revised_confidence).toBeLessThanOrEqual(100);
      }
    });
  }
});
