import { describe, it, expect, mock } from "bun:test";
import { parseAlert } from "../alert-parser";

// ── Mock LLM client ────────────────────────────────────────────────────────

function makeLLMClient(extracted: {
  service?: string;
  severity?: string;
  description?: string;
  started_at?: string | null;
}) {
  return {
    messages: {
      create: mock(async () => ({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-haiku-4-5-20251001",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 40 },
        content: [{ type: "text", text: JSON.stringify(extracted) }],
      })),
    },
  };
}

// ── Example inputs from the issue spec ────────────────────────────────────

describe("Issue spec example inputs", () => {
  it("parses: '@Autoheal payment-service is throwing 500s since the 14:30 deploy'", async () => {
    const result = await parseAlert(
      "@Autoheal payment-service is throwing 500s since the 14:30 deploy",
      {
        client: makeLLMClient({
          service: "payment-service",
          severity: "high",
          description: "payment-service throwing 500s since the 14:30 deploy",
          started_at: "2024-01-15T14:30:00.000Z",
        }) as never,
      }
    );
    expect(result.service).toBe("payment-service");
    expect(result.severity).toBe("high");
    expect(result.description).toContain("500s");
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("parses: '@Autoheal P1: order-service latency spiked 10 minutes ago'", async () => {
    const result = await parseAlert(
      "@Autoheal P1: order-service latency spiked 10 minutes ago",
      {
        client: makeLLMClient({
          service: "order-service",
          severity: "P1",
          description: "order-service latency spiked 10 minutes ago",
          started_at: null,
        }) as never,
      }
    );
    expect(result.service).toBe("order-service");
    expect(result.severity).toBe("critical");
  });

  it("parses: '@Autoheal investigate fraud-service — high error rate'", async () => {
    const result = await parseAlert(
      "@Autoheal investigate fraud-service — high error rate",
      {
        client: makeLLMClient({
          service: "fraud-service",
          severity: "high",
          description: "fraud-service high error rate",
        }) as never,
      }
    );
    expect(result.service).toBe("fraud-service");
    expect(result.severity).toBe("high");
  });

  it("parses: '/investigate service=payment-service severity=P1'", async () => {
    const result = await parseAlert(
      "/investigate service=payment-service severity=P1",
      {
        client: makeLLMClient({
          service: "payment-service",
          severity: "P1",
          description: "investigate payment-service",
        }) as never,
      }
    );
    expect(result.service).toBe("payment-service");
    expect(result.severity).toBe("critical");
  });
});

// ── Default values ─────────────────────────────────────────────────────────

describe("Default values for missing fields", () => {
  it("defaults severity to 'high' (P2) when not specified", async () => {
    const result = await parseAlert("payment-service is broken", {
      client: makeLLMClient({
        service: "payment-service",
        description: "payment-service is broken",
      }) as never,
    });
    expect(result.severity).toBe("high");
  });

  it("defaults started_at to now when not specified", async () => {
    const before = Date.now();
    const result = await parseAlert("payment-service is down", {
      client: makeLLMClient({
        service: "payment-service",
        description: "payment-service is down",
      }) as never,
    });
    const after = Date.now();
    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before - 100);
    expect(result.timestamp.getTime()).toBeLessThanOrEqual(after + 100);
  });

  it("defaults service to 'unknown-service' for garbled input", async () => {
    const result = await parseAlert("something is very wrong everywhere!!", {
      client: makeLLMClient({ description: "something is very wrong" }) as never,
    });
    expect(result.service).toBe("unknown-service");
  });

  it("always sets source=slack label", async () => {
    const result = await parseAlert("payment-service down", {
      client: makeLLMClient({ service: "payment-service" }) as never,
    });
    expect(result.labels.source).toBe("slack");
  });
});

// ── Severity normalization ─────────────────────────────────────────────────

describe("Severity normalization", () => {
  const cases: [string, string][] = [
    ["P1", "critical"],
    ["p1", "critical"],
    ["critical", "critical"],
    ["P2", "high"],
    ["high", "high"],
    ["P3", "medium"],
    ["medium", "medium"],
    ["P4", "low"],
    ["low", "low"],
  ];

  for (const [input, expected] of cases) {
    it(`maps severity "${input}" → "${expected}"`, async () => {
      const result = await parseAlert("some-service is down", {
        client: makeLLMClient({ service: "some-service", severity: input }) as never,
      });
      expect(result.severity).toBe(expected as never);
    });
  }
});

// ── Regex fallback (no LLM client) ────────────────────────────────────────

describe("Regex fallback (no LLM client provided)", () => {
  it("extracts service name via regex", async () => {
    // No client → regex path; no ANTHROPIC_API_KEY in test env
    const result = await parseAlert("payment-service is throwing errors", {});
    expect(result.service).toBe("payment-service");
  });

  it("extracts P1 severity via regex", async () => {
    const result = await parseAlert("P1 fraud-service outage", {});
    expect(result.severity).toBe("critical");
  });

  it("extracts slash command KV format via regex", async () => {
    const result = await parseAlert("/investigate service=order-service severity=p2", {});
    expect(result.service).toBe("order-service");
    expect(result.severity).toBe("high");
  });

  it("gracefully returns partial alert for garbled input", async () => {
    const result = await parseAlert("!@#$% broken stuff everywhere", {});
    expect(result.id).toMatch(/^slack-/);
    expect(result.labels.source).toBe("slack");
    expect(result.rawText).toBe("!@#$% broken stuff everywhere");
  });
});

// ── Schema validation ──────────────────────────────────────────────────────

describe("ParsedAlert schema", () => {
  it("always has required Alert fields", async () => {
    const result = await parseAlert("payment-service down P1", {
      client: makeLLMClient({
        service: "payment-service",
        severity: "P1",
        description: "payment-service down",
      }) as never,
    });
    expect(typeof result.id).toBe("string");
    expect(typeof result.title).toBe("string");
    expect(["critical", "high", "medium", "low"]).toContain(result.severity);
    expect(typeof result.service).toBe("string");
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(typeof result.labels).toBe("object");
    expect(typeof result.rawText).toBe("string");
  });

  it("title is truncated to 200 chars max", async () => {
    const longDesc = "a".repeat(300);
    const result = await parseAlert("payment-service " + longDesc, {
      client: makeLLMClient({
        service: "payment-service",
        description: longDesc,
      }) as never,
    });
    expect(result.title.length).toBeLessThanOrEqual(200);
  });

  it("rawText preserves original input including @mention", async () => {
    const input = "@Autoheal payment-service is down";
    const result = await parseAlert(input, {
      client: makeLLMClient({ service: "payment-service" }) as never,
    });
    expect(result.rawText).toBe(input);
  });
});
