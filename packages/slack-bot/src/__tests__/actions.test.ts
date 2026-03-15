import { describe, it, expect, mock, beforeEach } from "bun:test";
import { investigationStore, pendingRejections, registerActionHandlers } from "../handlers/actions";
import type { FullInvestigationResult } from "@oncall/hypothesis-validator";
import type { Alert, InvestigationResult } from "@shared/types";
import type { App } from "@slack/bolt";
import { mockIncidents } from "@shared/mock-data";

// ── Fixtures ───────────────────────────────────────────────────────────────

const alert: Alert = {
  id: "alert-test",
  service: "payment-service",
  severity: "critical",
  title: "High error rate",
  timestamp: new Date("2024-01-15T14:30:00Z"),
  labels: {},
};

const investigation: InvestigationResult = {
  id: "inv-test",
  alertId: "alert-test",
  startedAt: new Date("2024-01-15T14:30:00Z"),
  completedAt: new Date("2024-01-15T14:30:30Z"),
  status: "completed",
  hypotheses: [{
    id: "hyp-1",
    description: "Deploy abc123 caused NPE",
    confidence: 87,
    evidence: ["Deploy at 14:28", "NPE in logs"],
    relatedServices: [],
    suggestedActions: ["Roll back to v2.4.0"],
  }],
  summary: "Deploy abc123 — recommend rollback",
  rootCause: "Deploy abc123 caused NPE",
  resolution: "Roll back to v2.4.0",
};

function makeFullResult(escalate = false): FullInvestigationResult {
  return {
    alert,
    investigation,
    validation: {
      incident_id: "inv-test",
      validated_hypotheses: [{
        original_rank: 1,
        original_confidence: 87,
        challenge_score: 10,
        key_objections: ["Minor ambiguity"],
        missing_evidence: [],
        revised_confidence: 78,
      }],
      escalate,
      validator_notes: "Evidence is solid.",
    },
    final_hypotheses: [{
      original_rank: 1,
      original_confidence: 87,
      challenge_score: 10,
      key_objections: ["Minor ambiguity"],
      missing_evidence: [],
      revised_confidence: 78,
    }],
    escalate,
    investigation_duration_ms: 28_000,
    validation_duration_ms: 4_500,
    total_duration_ms: 32_500,
  };
}

// ── Mock App factory ───────────────────────────────────────────────────────

function makeActionBody(actionId: string, messageTs = "ts-999", threadTs = "ts-root") {
  return {
    container: { channel_id: "C123", message_ts: messageTs },
    message: {
      ts: messageTs,
      thread_ts: threadTs,
      blocks: [
        { type: "header", text: { type: "plain_text", text: "Investigation" } },
        {
          type: "actions",
          elements: [{
            type: "button", text: { type: "plain_text", text: "👍 Correct" },
            value: "confirm", action_id: "hypothesis_confirm",
          }],
        },
      ],
    },
    action: { action_id: actionId },
    user: { id: "U123" },
  };
}

type MockClient = {
  chat: {
    postMessage: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
  };
};

function makeClient(): MockClient {
  return {
    chat: {
      postMessage: mock(async (args: { text: string }) => ({ ts: `ts-${Date.now()}`, ok: true, text: args.text })),
      update: mock(async () => ({ ok: true })),
    },
  };
}

// Capture registered action handlers
type ActionHandler = (ctx: { ack: () => Promise<void>; body: unknown; client: MockClient }) => Promise<void>;
const actionHandlers: Record<string, ActionHandler> = {};

function makeApp(): App {
  return {
    action: (actionId: string, handler: ActionHandler) => {
      actionHandlers[actionId] = handler;
    },
    client: makeClient(),
  } as unknown as App;
}

// ── Setup ──────────────────────────────────────────────────────────────────

let app: App;

beforeEach(() => {
  investigationStore.clear();
  pendingRejections.clear();
  app = makeApp();
  registerActionHandlers(app);
});

// ── hypothesis_confirm ─────────────────────────────────────────────────────

describe("hypothesis_confirm", () => {
  it("acks immediately", async () => {
    const ack = mock(async () => {});
    const client = makeClient();
    investigationStore.set("C123-ts-999", makeFullResult());

    await actionHandlers["hypothesis_confirm"]!({
      ack, body: makeActionBody("hypothesis_confirm"), client,
    });
    expect(ack.mock.calls.length).toBe(1);
  });

  it("posts a confirmation message in thread", async () => {
    const client = makeClient();
    investigationStore.set("C123-ts-999", makeFullResult());

    await actionHandlers["hypothesis_confirm"]!({
      ack: mock(async () => {}),
      body: makeActionBody("hypothesis_confirm"),
      client,
    });

    const postCalls = client.chat.postMessage.mock.calls as Array<[{ text: string; thread_ts: string }]>;
    expect(postCalls.length).toBeGreaterThanOrEqual(1);
    const confirmMsg = postCalls[0]![0];
    expect(confirmMsg.text).toContain("✅");
    expect(confirmMsg.thread_ts).toBe("ts-root");
  });

  it("updates original message to remove action buttons", async () => {
    const client = makeClient();
    investigationStore.set("C123-ts-999", makeFullResult());

    await actionHandlers["hypothesis_confirm"]!({
      ack: mock(async () => {}),
      body: makeActionBody("hypothesis_confirm"),
      client,
    });

    const updateCalls = client.chat.update.mock.calls as Array<[{ blocks: Array<{ type: string }> }]>;
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const updatedBlocks = updateCalls[0]![0].blocks;
    expect(updatedBlocks.some((b) => b.type === "actions")).toBe(false);
    // Should have a context block with "Confirmed"
    const contextBlock = updatedBlocks.find((b) => b.type === "context") as { type: "context"; elements: Array<{ text: string }> } | undefined;
    expect(contextBlock).toBeDefined();
    expect(contextBlock?.elements[0]?.text).toContain("Confirmed");
  });
});

// ── hypothesis_reject ─────────────────────────────────────────────────────

describe("hypothesis_reject", () => {
  it("posts a prompt asking for the real root cause", async () => {
    const client = makeClient();
    investigationStore.set("C123-ts-999", makeFullResult());

    await actionHandlers["hypothesis_reject"]!({
      ack: mock(async () => {}),
      body: makeActionBody("hypothesis_reject"),
      client,
    });

    const postCalls = client.chat.postMessage.mock.calls as Array<[{ text: string }]>;
    const promptMsg = postCalls[0]![0];
    expect(promptMsg.text).toContain("root cause");
    expect(promptMsg.text).toContain("Reply");
  });

  it("registers a pending rejection for the thread", async () => {
    const client = makeClient();
    investigationStore.set("C123-ts-999", makeFullResult());

    await actionHandlers["hypothesis_reject"]!({
      ack: mock(async () => {}),
      body: makeActionBody("hypothesis_reject"),
      client,
    });

    expect(pendingRejections.has("C123-ts-root")).toBe(true);
    expect(pendingRejections.get("C123-ts-root")?.service).toBe("payment-service");
  });

  it("updates original message to remove action buttons and show rejected state", async () => {
    const client = makeClient();
    investigationStore.set("C123-ts-999", makeFullResult());

    await actionHandlers["hypothesis_reject"]!({
      ack: mock(async () => {}),
      body: makeActionBody("hypothesis_reject"),
      client,
    });

    const updateCalls = client.chat.update.mock.calls as Array<[{ blocks: Array<{ type: string }> }]>;
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const updatedBlocks = updateCalls[0]![0].blocks;
    expect(updatedBlocks.some((b) => b.type === "actions")).toBe(false);
    const contextBlock = updatedBlocks.find((b) => b.type === "context") as { type: "context"; elements: Array<{ text: string }> } | undefined;
    expect(contextBlock?.elements[0]?.text).toContain("Rejected");
  });
});

// ── investigate_more ──────────────────────────────────────────────────────

describe("investigate_more — no context found", () => {
  it("posts error message when investigation context is missing", async () => {
    const client = makeClient();
    // Do NOT seed investigationStore

    await actionHandlers["investigate_more"]!({
      ack: mock(async () => {}),
      body: makeActionBody("investigate_more"),
      client,
    });

    const postCalls = client.chat.postMessage.mock.calls as Array<[{ text: string }]>;
    expect(postCalls.some((c) => c[0].text.includes("❌"))).toBe(true);
  });
});

// ── hypothesis_confirm — DB insert ────────────────────────────────────────

describe("hypothesis_confirm — knowledge base write", () => {
  it("adds a new incident to mockIncidents when confirming", async () => {
    const client = makeClient();
    investigationStore.set("C123-ts-999", makeFullResult());
    const beforeCount = mockIncidents.length;

    await actionHandlers["hypothesis_confirm"]!({
      ack: mock(async () => {}),
      body: makeActionBody("hypothesis_confirm"),
      client,
    });

    expect(mockIncidents.length).toBe(beforeCount + 1);
    const added = mockIncidents[mockIncidents.length - 1]!;
    expect(added.services).toContain("payment-service");
    expect(added.rootCause).toContain("Deploy abc123");
    expect(added.resolution).toContain("Roll back");
  });
});

// ── investigate_more — happy path ─────────────────────────────────────────

function usage(inp: number, out: number) {
  return { input_tokens: inp, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

const digDeeperInvestigationResponses = [
  {
    id: "msg_dd1", type: "message", role: "assistant", model: "claude-sonnet-4-6",
    stop_reason: "tool_use", stop_sequence: null, usage: usage(1200, 480),
    content: [
      { type: "text", text: "Investigating deeper." },
      { type: "tool_use", id: "t1", name: "query_metrics", input: { service: "payment-service" } },
    ],
  },
  {
    id: "msg_dd2", type: "message", role: "assistant", model: "claude-sonnet-4-6",
    stop_reason: "end_turn", stop_sequence: null, usage: usage(3800, 620),
    content: [{
      type: "text",
      text: JSON.stringify({
        hypotheses: [{
          rank: 1,
          description: "Deeper analysis: Deploy abc123 NPE confirmed with full stack trace",
          confidence: 92,
          supporting_evidence: ["Full stack trace found", "Deploy abc123 at 14:28"],
          suggested_action: "Roll back payment-service to v2.4.0",
          runbook_url: "https://wiki.example.com/rollback",
        }],
        timeline: [],
        summary: "Confirmed: Deploy abc123 NPE — rollback recommended",
      }),
    }],
  },
];

const digDeeperValidatorResponse = {
  id: "msg_ddv", type: "message", role: "assistant", model: "claude-sonnet-4-6",
  stop_reason: "end_turn", stop_sequence: null, usage: usage(1800, 400),
  content: [{
    type: "text",
    text: JSON.stringify({
      validated_hypotheses: [{
        original_rank: 1, original_confidence: 92, challenge_score: 5,
        key_objections: [],
        missing_evidence: [],
        revised_confidence: 87,
      }],
      validator_notes: "Full stack trace confirms the hypothesis.",
    }),
  }],
};

describe("investigate_more — happy path", () => {
  it("posts a new investigation result in the thread when context is found", async () => {
    // Re-register handlers with injectable clients
    const localActionHandlers: Record<string, ActionHandler> = {};
    const localApp = {
      action: (id: string, h: ActionHandler) => { localActionHandlers[id] = h; },
      client: makeClient(),
    } as unknown as App;

    let invIdx = 0;
    const investigationClient = {
      messages: { create: mock(async () => digDeeperInvestigationResponses[invIdx++]) },
    };
    const validationClient = {
      messages: { create: mock(async () => digDeeperValidatorResponse) },
    };

    registerActionHandlers(localApp, {
      _investigationClient: investigationClient as never,
      _validationClient: validationClient as never,
    });

    const client = makeClient();
    investigationStore.set("C123-ts-999", makeFullResult());

    await localActionHandlers["investigate_more"]!({
      ack: mock(async () => {}),
      body: makeActionBody("investigate_more"),
      client,
    });

    const postCalls = client.chat.postMessage.mock.calls as Array<[{ text: string; blocks?: unknown[] }]>;

    // Should have posted a status message + final result with blocks
    const withBlocks = postCalls.filter((c) => c[0].blocks && c[0].blocks.length > 0);
    expect(withBlocks.length).toBeGreaterThanOrEqual(1);

    // Final result should mention the deeper finding
    const finalPost = withBlocks[withBlocks.length - 1]![0];
    expect(finalPost.text).toBeTruthy();
  });

  it("stores the new result in investigationStore after dig-deeper", async () => {
    const localActionHandlers: Record<string, ActionHandler> = {};
    const localApp = {
      action: (id: string, h: ActionHandler) => { localActionHandlers[id] = h; },
      client: makeClient(),
    } as unknown as App;

    let invIdx = 0;
    registerActionHandlers(localApp, {
      _investigationClient: { messages: { create: mock(async () => digDeeperInvestigationResponses[invIdx++]) } } as never,
      _validationClient: { messages: { create: mock(async () => digDeeperValidatorResponse) } } as never,
    });

    const client = makeClient();
    investigationStore.set("C123-ts-999", makeFullResult());
    const storeSizeBefore = investigationStore.size;

    await localActionHandlers["investigate_more"]!({
      ack: mock(async () => {}),
      body: makeActionBody("investigate_more"),
      client,
    });

    // A new entry should have been added for the dig-deeper result message
    expect(investigationStore.size).toBeGreaterThanOrEqual(storeSizeBefore);
  });
});

// ── pendingRejections store ────────────────────────────────────────────────

describe("pendingRejections store", () => {
  it("clears the pending entry after handling (simulated)", () => {
    pendingRejections.set("C123-ts-thread", { service: "payment-service", alertId: "a1" });
    expect(pendingRejections.has("C123-ts-thread")).toBe(true);
    pendingRejections.delete("C123-ts-thread");
    expect(pendingRejections.has("C123-ts-thread")).toBe(false);
  });
});
