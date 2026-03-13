import { describe, it, expect, mock, beforeEach } from "bun:test";
import { investigationStore, pendingRejections, registerActionHandlers } from "../handlers/actions";
import type { FullInvestigationResult } from "@oncall/hypothesis-validator";
import type { Alert, InvestigationResult } from "@shared/types";
import type { App } from "@slack/bolt";

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

// ── pendingRejections store ────────────────────────────────────────────────

describe("pendingRejections store", () => {
  it("clears the pending entry after handling (simulated)", () => {
    pendingRejections.set("C123-ts-thread", { service: "payment-service", alertId: "a1" });
    expect(pendingRejections.has("C123-ts-thread")).toBe(true);
    pendingRejections.delete("C123-ts-thread");
    expect(pendingRejections.has("C123-ts-thread")).toBe(false);
  });
});
