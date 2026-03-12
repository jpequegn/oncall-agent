import { describe, it, expect, mock } from "bun:test";
import type { ScenarioName } from "@shared/mock-data";
import { getScenario } from "@shared/mock-data";
import type { Alert } from "@shared/types";
import { runFullInvestigation } from "../pipeline";
import { scenarioAResponses, scenarioBResponses } from "./investigation-fixtures";
import { scenarioAValidatorResponse, scenarioCValidatorResponse } from "./fixtures";
import { scenarioCResponses } from "./investigation-fixtures";

// ── Mock client factories ──────────────────────────────────────────────────

function makeSequentialClient(responses: unknown[]) {
  let callIndex = 0;
  return {
    messages: {
      create: mock(async () => {
        const response = responses[callIndex];
        if (!response) throw new Error(`No fixture for call ${callIndex}`);
        callIndex++;
        return response;
      }),
    },
  };
}

function makeSingleClient(response: unknown) {
  return {
    messages: {
      create: mock(async () => response),
    },
  };
}

// ── Alert builder ──────────────────────────────────────────────────────────

function alertFromScenario(scenario: ScenarioName): Alert {
  const s = getScenario(scenario);
  return {
    id: `test-alert-${scenario}`,
    title: s.triggerAlert.title,
    severity: s.triggerAlert.severity,
    service: s.triggerAlert.service,
    timestamp: new Date(s.triggerAlert.firedAt),
    labels: { env: "production", scenario },
    description: s.description,
  };
}

// ── Scenario A: end-to-end pipeline ───────────────────────────────────────

describe("Pipeline — Scenario A (deploy-regression)", () => {
  it("returns FullInvestigationResult with required fields", async () => {
    const alert = alertFromScenario("deploy-regression");
    const result = await runFullInvestigation(alert, {
      scenario: "deploy-regression",
      investigationClient: makeSequentialClient(scenarioAResponses) as never,
      validationClient: makeSingleClient(scenarioAValidatorResponse) as never,
    });

    expect(result.alert).toBe(alert);
    expect(result.investigation).toBeDefined();
    expect(result.validation).toBeDefined();
    expect(Array.isArray(result.final_hypotheses)).toBe(true);
    expect(typeof result.escalate).toBe("boolean");
    expect(typeof result.investigation_duration_ms).toBe("number");
    expect(typeof result.validation_duration_ms).toBe("number");
    expect(typeof result.total_duration_ms).toBe("number");
  });

  it("total_duration_ms = investigation + validation duration", async () => {
    const alert = alertFromScenario("deploy-regression");
    const result = await runFullInvestigation(alert, {
      scenario: "deploy-regression",
      investigationClient: makeSequentialClient(scenarioAResponses) as never,
      validationClient: makeSingleClient(scenarioAValidatorResponse) as never,
    });
    expect(result.total_duration_ms).toBe(
      result.investigation_duration_ms + result.validation_duration_ms
    );
  });

  it("does NOT escalate for Scenario A", async () => {
    const alert = alertFromScenario("deploy-regression");
    const result = await runFullInvestigation(alert, {
      scenario: "deploy-regression",
      investigationClient: makeSequentialClient(scenarioAResponses) as never,
      validationClient: makeSingleClient(scenarioAValidatorResponse) as never,
    });
    expect(result.escalate).toBe(false);
  });

  it("final_hypotheses sorted by revised_confidence descending", async () => {
    const alert = alertFromScenario("deploy-regression");
    const result = await runFullInvestigation(alert, {
      scenario: "deploy-regression",
      investigationClient: makeSequentialClient(scenarioAResponses) as never,
      validationClient: makeSingleClient(scenarioAValidatorResponse) as never,
    });
    for (let i = 1; i < result.final_hypotheses.length; i++) {
      expect(result.final_hypotheses[i - 1]!.revised_confidence).toBeGreaterThanOrEqual(
        result.final_hypotheses[i]!.revised_confidence
      );
    }
  });

  it("investigation has status=completed", async () => {
    const alert = alertFromScenario("deploy-regression");
    const result = await runFullInvestigation(alert, {
      scenario: "deploy-regression",
      investigationClient: makeSequentialClient(scenarioAResponses) as never,
      validationClient: makeSingleClient(scenarioAValidatorResponse) as never,
    });
    expect(result.investigation.status).toBe("completed");
  });
});

// ── Scenario B: upstream-failure ──────────────────────────────────────────

describe("Pipeline — Scenario B (upstream-failure)", () => {
  it("completes without escalation for high-confidence upstream failure", async () => {
    const alert = alertFromScenario("upstream-failure");
    // Reuse scenarioA validator response (high confidence pass-through) for B
    const result = await runFullInvestigation(alert, {
      scenario: "upstream-failure",
      investigationClient: makeSequentialClient(scenarioBResponses) as never,
      validationClient: makeSingleClient(scenarioAValidatorResponse) as never,
    });
    expect(result.investigation.status).toBe("completed");
    expect(result.final_hypotheses.length).toBeGreaterThan(0);
  });
});

// ── Scenario C: escalation ────────────────────────────────────────────────

describe("Pipeline — Scenario C (no-clear-cause)", () => {
  it("escalates for inconclusive investigation", async () => {
    const alert = alertFromScenario("no-clear-cause");
    const result = await runFullInvestigation(alert, {
      scenario: "no-clear-cause",
      investigationClient: makeSequentialClient(scenarioCResponses) as never,
      validationClient: makeSingleClient(scenarioCValidatorResponse) as never,
    });
    expect(result.escalate).toBe(true);
  });

  it("escalation_reason is present when escalating", async () => {
    const alert = alertFromScenario("no-clear-cause");
    const result = await runFullInvestigation(alert, {
      scenario: "no-clear-cause",
      investigationClient: makeSequentialClient(scenarioCResponses) as never,
      validationClient: makeSingleClient(scenarioCValidatorResponse) as never,
    });
    expect(result.validation.escalation_reason).toBeTruthy();
  });

  it("final_hypotheses still sorted even with low confidence", async () => {
    const alert = alertFromScenario("no-clear-cause");
    const result = await runFullInvestigation(alert, {
      scenario: "no-clear-cause",
      investigationClient: makeSequentialClient(scenarioCResponses) as never,
      validationClient: makeSingleClient(scenarioCValidatorResponse) as never,
    });
    for (let i = 1; i < result.final_hypotheses.length; i++) {
      expect(result.final_hypotheses[i - 1]!.revised_confidence).toBeGreaterThanOrEqual(
        result.final_hypotheses[i]!.revised_confidence
      );
    }
  });
});

// ── Schema validation ──────────────────────────────────────────────────────

describe("FullInvestigationResult schema", () => {
  it("all duration fields are non-negative numbers", async () => {
    const alert = alertFromScenario("deploy-regression");
    const result = await runFullInvestigation(alert, {
      scenario: "deploy-regression",
      investigationClient: makeSequentialClient(scenarioAResponses) as never,
      validationClient: makeSingleClient(scenarioAValidatorResponse) as never,
    });
    expect(result.investigation_duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.validation_duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.total_duration_ms).toBeGreaterThanOrEqual(0);
  });
});
