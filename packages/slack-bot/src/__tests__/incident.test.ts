import { describe, it, expect, mock } from "bun:test";
import { handleIncident, formatToolName } from "../handlers/incident";
import type { App } from "@slack/bolt";

// ── Fixture responses ──────────────────────────────────────────────────────

function usage(inp: number, out: number) {
  return { input_tokens: inp, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

type LooseMessage = {
  id: string; type: string; role: string; model: string;
  stop_reason: string; stop_sequence: null;
  usage: ReturnType<typeof usage>;
  content: unknown[];
};

const investigationResponses: LooseMessage[] = [
  {
    id: "msg_i1", type: "message", role: "assistant", model: "claude-sonnet-4-6",
    stop_reason: "tool_use", stop_sequence: null, usage: usage(1200, 480),
    content: [
      { type: "text", text: "Investigating payment-service." },
      { type: "tool_use", id: "t1", name: "query_metrics",      input: { service: "payment-service" } },
      { type: "tool_use", id: "t2", name: "get_recent_deploys", input: { service: "payment-service", hours: 4 } },
      { type: "tool_use", id: "t3", name: "search_logs",        input: { service: "payment-service", level: "ERROR" } },
      { type: "tool_use", id: "t4", name: "get_service_deps",   input: { service: "payment-service" } },
    ],
  },
  {
    id: "msg_i2", type: "message", role: "assistant", model: "claude-sonnet-4-6",
    stop_reason: "end_turn", stop_sequence: null, usage: usage(3800, 620),
    content: [{
      type: "text",
      text: JSON.stringify({
        hypotheses: [{
          rank: 1,
          description: "Deploy abc123 introduced NPE in PaymentProcessor.java:247",
          confidence: 87,
          supporting_evidence: ["Deploy abc123 at 14:28", "Error rate spike at 14:30"],
          suggested_action: "Roll back payment-service to v2.4.0",
          runbook_url: "https://wiki.example.com/rollback",
        }],
        timeline: [],
        summary: "Deploy abc123 introduced NPE — recommend rollback",
      }),
    }],
  },
];

const validatorResponse: LooseMessage = {
  id: "msg_v1", type: "message", role: "assistant", model: "claude-sonnet-4-6",
  stop_reason: "end_turn", stop_sequence: null, usage: usage(1800, 400),
  content: [{
    type: "text",
    text: JSON.stringify({
      validated_hypotheses: [{
        original_rank: 1, original_confidence: 87, challenge_score: 10,
        key_objections: ["Minor config ambiguity"],
        missing_evidence: ["Full stack trace"],
        revised_confidence: 78,
      }],
      validator_notes: "Evidence chain is solid. Deploy timing is clear.",
    }),
  }],
};

const escalationValidatorResponse: LooseMessage = {
  id: "msg_v2", type: "message", role: "assistant", model: "claude-sonnet-4-6",
  stop_reason: "end_turn", stop_sequence: null, usage: usage(1800, 400),
  content: [{
    type: "text",
    text: JSON.stringify({
      validated_hypotheses: [{
        original_rank: 1, original_confidence: 87, challenge_score: 80,
        key_objections: ["o1", "o2", "o3", "o4"],
        missing_evidence: ["many things"],
        revised_confidence: 17,
      }],
      escalation_reason: "All hypotheses heavily challenged, confidence too low",
      validator_notes: "Unable to confirm root cause. Human review required.",
    }),
  }],
};

// ── Client factories ───────────────────────────────────────────────────────

function makeInvestigationClient(responses: LooseMessage[]) {
  let i = 0;
  return { messages: { create: mock(async () => responses[i++]) } };
}

function makeValidatorClient(response: LooseMessage) {
  return { messages: { create: mock(async () => response) } };
}

// ── Mock App factory ───────────────────────────────────────────────────────

function makeApp() {
  const postMessages: string[] = [];
  const updateMessages: string[] = [];

  const app = {
    client: {
      chat: {
        postMessage: mock(async (args: { text: string }) => {
          postMessages.push(args.text);
          return { ts: `ts-${Date.now()}`, ok: true };
        }),
        update: mock(async (args: { text: string }) => {
          updateMessages.push(args.text);
          return { ok: true };
        }),
      },
    },
  };

  return {
    app: app as unknown as App,
    postMessages,
    updateMessages,
  };
}

// ── formatToolName ─────────────────────────────────────────────────────────

describe("formatToolName", () => {
  it("returns human-readable label for known tools", () => {
    expect(formatToolName("query_metrics")).toBe("Queried service metrics");
    expect(formatToolName("search_logs")).toBe("Searched error logs");
    expect(formatToolName("get_recent_deploys")).toBe("Checked recent deploys");
    expect(formatToolName("get_service_deps")).toBe("Mapped service dependencies");
    expect(formatToolName("get_past_incidents")).toBe("Reviewed past incidents");
    expect(formatToolName("search_runbooks")).toBe("Searched runbooks");
  });

  it("falls back to underscore-replaced name for unknown tools", () => {
    expect(formatToolName("some_unknown_tool")).toBe("some unknown tool");
  });
});

// ── handleIncident — success path ─────────────────────────────────────────

describe("handleIncident — success path (Scenario A)", () => {
  async function runSuccess() {
    const { app, postMessages, updateMessages } = makeApp();
    await handleIncident({
      text: "payment-service is throwing 500s since the 14:30 deploy",
      channelId: "C123",
      threadTs: "1234567890.000100",
      app,
      serviceGraphUrl: "http://localhost:3001",
      _investigationClient: makeInvestigationClient(investigationResponses) as never,
      _validationClient: makeValidatorClient(validatorResponse) as never,
    });
    return { postMessages, updateMessages };
  }

  it("posts at least 2 messages (status + final result)", async () => {
    const { postMessages } = await runSuccess();
    expect(postMessages.length).toBeGreaterThanOrEqual(2);
  });

  it("status message updates contain ✓ tool completion markers", async () => {
    const { updateMessages } = await runSuccess();
    const withCheck = updateMessages.filter((m) => m.includes("✓"));
    expect(withCheck.length).toBeGreaterThanOrEqual(1);
  });

  it("status message updates 4+ times (once per tool call batch)", async () => {
    // Turn 1 has 4 tool calls → onToolCall fires → ≥1 update per turn + status updates
    const { updateMessages } = await runSuccess();
    expect(updateMessages.length).toBeGreaterThanOrEqual(4);
  });

  it("final result message references root cause content", async () => {
    const { postMessages } = await runSuccess();
    const finalMsg = postMessages[postMessages.length - 1]!.toLowerCase();
    expect(
      finalMsg.includes("root cause") ||
      finalMsg.includes("rollback") ||
      finalMsg.includes("npe") ||
      finalMsg.includes("abc123") ||
      finalMsg.includes("paymentprocessor") ||
      finalMsg.includes("confidence") ||
      finalMsg.includes("investigation")
    ).toBe(true);
  });

  it("no ❌ error messages in success path", async () => {
    const { postMessages, updateMessages } = await runSuccess();
    const allMessages = [...postMessages, ...updateMessages];
    expect(allMessages.filter((m) => m.includes("❌")).length).toBe(0);
  });
});

// ── handleIncident — escalation path ──────────────────────────────────────

describe("handleIncident — escalation path", () => {
  it("posts 🚨 escalation banner when validator escalates", async () => {
    const { app, postMessages, updateMessages } = makeApp();
    await handleIncident({
      text: "payment-service errors",
      channelId: "C123",
      threadTs: "ts123",
      app,
      _investigationClient: makeInvestigationClient(investigationResponses) as never,
      _validationClient: makeValidatorClient(escalationValidatorResponse) as never,
    });
    const allMessages = [...postMessages, ...updateMessages];
    expect(allMessages.some((m) => m.includes("🚨") || m.toLowerCase().includes("escalat"))).toBe(true);
  });

  it("escalation message includes hypotheses for human review", async () => {
    const { app, postMessages } = makeApp();
    await handleIncident({
      text: "payment-service errors",
      channelId: "C123",
      threadTs: "ts123",
      app,
      _investigationClient: makeInvestigationClient(investigationResponses) as never,
      _validationClient: makeValidatorClient(escalationValidatorResponse) as never,
    });
    const finalMsg = postMessages[postMessages.length - 1] ?? "";
    expect(
      finalMsg.toLowerCase().includes("human") ||
      finalMsg.toLowerCase().includes("review") ||
      finalMsg.toLowerCase().includes("hypothesis") ||
      finalMsg.toLowerCase().includes("hypothes")
    ).toBe(true);
  });
});

// ── handleIncident — error path ────────────────────────────────────────────

describe("handleIncident — error path", () => {
  it("posts ❌ error message if investigation client throws", async () => {
    const { app, postMessages, updateMessages } = makeApp();
    const badClient = {
      messages: { create: mock(async () => { throw new Error("API unavailable"); }) },
    };
    await handleIncident({
      text: "payment-service down",
      channelId: "C123",
      threadTs: "ts123",
      app,
      _investigationClient: badClient as never,
    });
    const allMessages = [...postMessages, ...updateMessages];
    expect(allMessages.some((m) => m.includes("❌"))).toBe(true);
  });
});
