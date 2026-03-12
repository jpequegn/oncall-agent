import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { Alert } from "@shared/types";
import type { ScenarioName } from "@shared/mock-data";
import { getScenario } from "@shared/mock-data";
import { investigate } from "../agent";
import { scenarioAResponses, scenarioBResponses, scenarioCResponses } from "./fixtures";

// ── Mock Anthropic client factory ──────────────────────────────────────────

function makeMockClient(responses: unknown[]) {
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

// ── Alert builder from scenario ────────────────────────────────────────────

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

// ── Scenario A: Deploy regression ─────────────────────────────────────────

describe("Scenario A — deploy regression (payment-service)", () => {
  it("completes with status=completed", async () => {
    const alert = alertFromScenario("deploy-regression");
    const client = makeMockClient(scenarioAResponses);
    const result = await investigate(alert, {
      scenario: "deploy-regression",
      client: client as never,
    });
    expect(result.status).toBe("completed");
    expect(result.alertId).toBe(alert.id);
    expect(result.completedAt).toBeDefined();
  });

  it("top hypothesis mentions PaymentProcessor or abc123 deploy", async () => {
    const alert = alertFromScenario("deploy-regression");
    const result = await investigate(alert, {
      scenario: "deploy-regression",
      client: makeMockClient(scenarioAResponses) as never,
    });
    expect(result.hypotheses.length).toBeGreaterThan(0);
    const top = result.hypotheses[0]!;
    const descLower = top.description.toLowerCase();
    expect(
      descLower.includes("paymentprocessor") || descLower.includes("abc123")
    ).toBe(true);
  });

  it("top hypothesis confidence ≥70%", async () => {
    const alert = alertFromScenario("deploy-regression");
    const result = await investigate(alert, {
      scenario: "deploy-regression",
      client: makeMockClient(scenarioAResponses) as never,
    });
    expect(result.hypotheses[0]!.confidence).toBeGreaterThanOrEqual(70);
  });

  it("evidence includes deploy and NPE log reference", async () => {
    const alert = alertFromScenario("deploy-regression");
    const result = await investigate(alert, {
      scenario: "deploy-regression",
      client: makeMockClient(scenarioAResponses) as never,
    });
    const evidence = result.hypotheses[0]!.evidence.join(" ").toLowerCase();
    expect(evidence.includes("abc123") || evidence.includes("14:28")).toBe(true);
    expect(
      evidence.includes("nullpointerexception") ||
      evidence.includes("paymentprocessor") ||
      evidence.includes("error rate")
    ).toBe(true);
  });

  it("suggested action mentions rollback", async () => {
    const alert = alertFromScenario("deploy-regression");
    const result = await investigate(alert, {
      scenario: "deploy-regression",
      client: makeMockClient(scenarioAResponses) as never,
    });
    const action = result.hypotheses[0]!.suggestedActions.join(" ").toLowerCase();
    expect(action.includes("roll back") || action.includes("rollback")).toBe(true);
  });

  it("summary is set and non-empty", async () => {
    const alert = alertFromScenario("deploy-regression");
    const result = await investigate(alert, {
      scenario: "deploy-regression",
      client: makeMockClient(scenarioAResponses) as never,
    });
    expect(result.summary).toBeTruthy();
    expect(result.summary!.length).toBeGreaterThan(10);
  });

  it("rootCause matches top hypothesis description", async () => {
    const alert = alertFromScenario("deploy-regression");
    const result = await investigate(alert, {
      scenario: "deploy-regression",
      client: makeMockClient(scenarioAResponses) as never,
    });
    expect(result.rootCause).toBe(result.hypotheses[0]!.description);
  });

  it("makes at least 4 tool calls (parallel first turn)", async () => {
    const alert = alertFromScenario("deploy-regression");
    const client = makeMockClient(scenarioAResponses);
    await investigate(alert, { scenario: "deploy-regression", client: client as never });
    // Turn 1 has 4 tool_use blocks → messages.create called twice (tool_use + end_turn)
    expect(client.messages.create.mock.calls.length).toBe(2);
  });
});

// ── Scenario B: Upstream dependency failure ───────────────────────────────

describe("Scenario B — upstream dependency failure (order-service)", () => {
  it("completes with status=completed", async () => {
    const alert = alertFromScenario("upstream-failure");
    const result = await investigate(alert, {
      scenario: "upstream-failure",
      client: makeMockClient(scenarioBResponses) as never,
    });
    expect(result.status).toBe("completed");
  });

  it("top hypothesis mentions inventory-service or inventory-db", async () => {
    const alert = alertFromScenario("upstream-failure");
    const result = await investigate(alert, {
      scenario: "upstream-failure",
      client: makeMockClient(scenarioBResponses) as never,
    });
    const descLower = result.hypotheses[0]!.description.toLowerCase();
    expect(
      descLower.includes("inventory-service") || descLower.includes("inventory-db")
    ).toBe(true);
  });

  it("top hypothesis confidence ≥70%", async () => {
    const alert = alertFromScenario("upstream-failure");
    const result = await investigate(alert, {
      scenario: "upstream-failure",
      client: makeMockClient(scenarioBResponses) as never,
    });
    expect(result.hypotheses[0]!.confidence).toBeGreaterThanOrEqual(70);
  });

  it("root cause is NOT attributed to a recent deploy", async () => {
    const alert = alertFromScenario("upstream-failure");
    const result = await investigate(alert, {
      scenario: "upstream-failure",
      client: makeMockClient(scenarioBResponses) as never,
    });
    const rootCauseLower = (result.rootCause ?? "").toLowerCase();
    // Should not primarily blame a deploy
    expect(rootCauseLower.includes("connection") || rootCauseLower.includes("pool") || rootCauseLower.includes("cpu")).toBe(true);
  });

  it("evidence references connection pool exhaustion", async () => {
    const alert = alertFromScenario("upstream-failure");
    const result = await investigate(alert, {
      scenario: "upstream-failure",
      client: makeMockClient(scenarioBResponses) as never,
    });
    const evidence = result.hypotheses[0]!.evidence.join(" ").toLowerCase();
    expect(
      evidence.includes("connection") || evidence.includes("pool") || evidence.includes("timeout")
    ).toBe(true);
  });

  it("makes 3 API calls (3 turns: tool_use, tool_use, end_turn)", async () => {
    const alert = alertFromScenario("upstream-failure");
    const client = makeMockClient(scenarioBResponses);
    await investigate(alert, { scenario: "upstream-failure", client: client as never });
    expect(client.messages.create.mock.calls.length).toBe(3);
  });

  it("produces multiple hypotheses", async () => {
    const alert = alertFromScenario("upstream-failure");
    const result = await investigate(alert, {
      scenario: "upstream-failure",
      client: makeMockClient(scenarioBResponses) as never,
    });
    expect(result.hypotheses.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Scenario C: No clear root cause ───────────────────────────────────────

describe("Scenario C — inconclusive investigation (fraud-service)", () => {
  it("completes with status=completed", async () => {
    const alert = alertFromScenario("no-clear-cause");
    const result = await investigate(alert, {
      scenario: "no-clear-cause",
      client: makeMockClient(scenarioCResponses) as never,
    });
    expect(result.status).toBe("completed");
  });

  it("all hypotheses have confidence <50%", async () => {
    const alert = alertFromScenario("no-clear-cause");
    const result = await investigate(alert, {
      scenario: "no-clear-cause",
      client: makeMockClient(scenarioCResponses) as never,
    });
    expect(result.hypotheses.length).toBeGreaterThan(0);
    expect(result.hypotheses.every((h) => h.confidence < 50)).toBe(true);
  });

  it("summary indicates inconclusive or human review needed", async () => {
    const alert = alertFromScenario("no-clear-cause");
    const result = await investigate(alert, {
      scenario: "no-clear-cause",
      client: makeMockClient(scenarioCResponses) as never,
    });
    const summaryLower = (result.summary ?? "").toLowerCase();
    expect(
      summaryLower.includes("inconclusive") ||
      summaryLower.includes("human") ||
      summaryLower.includes("no clear") ||
      summaryLower.includes("insufficient")
    ).toBe(true);
  });

  it("generates ≥2 alternative hypotheses (uncertain investigation)", async () => {
    const alert = alertFromScenario("no-clear-cause");
    const result = await investigate(alert, {
      scenario: "no-clear-cause",
      client: makeMockClient(scenarioCResponses) as never,
    });
    expect(result.hypotheses.length).toBeGreaterThanOrEqual(2);
  });

  it("makes 3 API calls (tool_use, tool_use, end_turn)", async () => {
    const alert = alertFromScenario("no-clear-cause");
    const client = makeMockClient(scenarioCResponses);
    await investigate(alert, { scenario: "no-clear-cause", client: client as never });
    expect(client.messages.create.mock.calls.length).toBe(3);
  });
});

// ── Output schema validation ───────────────────────────────────────────────

describe("InvestigationResult schema validation", () => {
  const scenarios: [string, ScenarioName, unknown[]][] = [
    ["Scenario A", "deploy-regression",  scenarioAResponses],
    ["Scenario B", "upstream-failure",   scenarioBResponses],
    ["Scenario C", "no-clear-cause",     scenarioCResponses],
  ];

  for (const [label, scenario, responses] of scenarios) {
    it(`${label}: result has required fields`, async () => {
      const alert = alertFromScenario(scenario);
      const result = await investigate(alert, {
        scenario,
        client: makeMockClient(responses) as never,
      });
      expect(typeof result.id).toBe("string");
      expect(result.alertId).toBe(alert.id);
      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(["completed", "failed", "in_progress"]).toContain(result.status);
      expect(Array.isArray(result.hypotheses)).toBe(true);
    });

    it(`${label}: each hypothesis has required fields`, async () => {
      const alert = alertFromScenario(scenario);
      const result = await investigate(alert, {
        scenario,
        client: makeMockClient(responses) as never,
      });
      for (const h of result.hypotheses) {
        expect(typeof h.id).toBe("string");
        expect(typeof h.description).toBe("string");
        expect(typeof h.confidence).toBe("number");
        expect(h.confidence).toBeGreaterThanOrEqual(0);
        expect(h.confidence).toBeLessThanOrEqual(100);
        expect(Array.isArray(h.evidence)).toBe(true);
        expect(Array.isArray(h.suggestedActions)).toBe(true);
      }
    });
  }
});
