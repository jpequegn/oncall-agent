import { describe, test, expect } from "bun:test";
import type {
  BotAdapter,
  BotMessage,
  MessageContext,
  ActionContext,
  InvestigationBlocks,
  ActionId,
} from "../index";
import { ACTIONS } from "../index";

// ── Compile-time interface satisfaction tests ────────────────────────────
// These verify that a concrete implementation can satisfy BotAdapter.
// If these fail to compile, the interface has a structural issue.

describe("BotAdapter interface", () => {
  test("a mock adapter satisfies the interface", () => {
    const adapter: BotAdapter = {
      async postMessage(_ctx: MessageContext, _msg: BotMessage) {
        return { messageId: "msg-123" };
      },
      async updateMessage(_ctx: MessageContext, _messageId: string, _msg: BotMessage) {},
      onMention(_handler: (text: string, ctx: MessageContext) => Promise<void>) {},
      onAction(_actionId: string, _handler: (ctx: ActionContext) => Promise<void>) {},
      async start() {},
    };

    expect(adapter).toBeDefined();
  });

  test("MessageContext has required fields", () => {
    const ctx: MessageContext = {
      channelId: "C123",
      threadId: "T456",
      userId: "U789",
      platform: "slack",
    };
    expect(ctx.platform).toBe("slack");

    const teamsCtx: MessageContext = { ...ctx, platform: "teams" };
    expect(teamsCtx.platform).toBe("teams");
  });

  test("ActionContext extends MessageContext", () => {
    const ctx: ActionContext = {
      channelId: "C123",
      threadId: "T456",
      userId: "U789",
      platform: "slack",
      actionId: ACTIONS.CONFIRM,
      value: "confirm",
      messageId: "msg-001",
    };
    // ActionContext is assignable to MessageContext
    const msgCtx: MessageContext = ctx;
    expect(msgCtx.channelId).toBe("C123");
  });

  test("BotMessage with plain text only", () => {
    const msg: BotMessage = { text: "Hello" };
    expect(msg.blocks).toBeUndefined();
  });

  test("BotMessage with investigation blocks", () => {
    const blocks: InvestigationBlocks = {
      type: "investigation_result",
      alert: {
        id: "alert-1",
        title: "High error rate",
        severity: "critical",
        service: "payment-service",
        timestamp: new Date(),
        labels: {},
      },
      hypotheses: [],
      timeline: [{ timestamp: new Date(), label: "Started investigation" }],
      duration_ms: 5000,
      tool_call_count: 3,
      escalate: false,
    };
    const msg: BotMessage = { text: "fallback", blocks };
    expect(msg.blocks?.type).toBe("investigation_result");
  });
});

describe("ACTIONS constants", () => {
  test("action IDs match expected string values", () => {
    expect(ACTIONS.CONFIRM).toBe("hypothesis_confirm");
    expect(ACTIONS.REJECT).toBe("hypothesis_reject");
    expect(ACTIONS.INVESTIGATE_MORE).toBe("investigate_more");
  });

  test("ActionId type accepts valid action IDs", () => {
    const id1: ActionId = "hypothesis_confirm";
    const id2: ActionId = "hypothesis_reject";
    const id3: ActionId = "investigate_more";
    expect([id1, id2, id3]).toHaveLength(3);
  });
});
