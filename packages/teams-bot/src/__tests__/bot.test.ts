import { describe, it, expect } from "bun:test";
import { TeamsAdapter } from "../teams-adapter";
import { TestAdapter, ActivityTypes, type Activity } from "botbuilder";
import type { InvestigationBlocks, MessageContext } from "@oncall/bot-core";
import { ACTIONS } from "@oncall/bot-core";

function makeTestAdapter(): { adapter: TestAdapter; bot: TeamsAdapter } {
  const bot = new TeamsAdapter();
  const adapter = new TestAdapter(async (context) => {
    await bot.run(context);
  });
  adapter.onTurnError = async (_context, error) => {
    throw error;
  };
  return { adapter, bot };
}

// ── Message handling ───────────────────────────────────────────────────

describe("TeamsAdapter — message handling", () => {
  it("echoes received messages when no mention handler registered", async () => {
    const { adapter } = makeTestAdapter();

    await adapter
      .send("payment-service is throwing 500s")
      .assertReply((activity) => {
        expect(activity.type).toBe(ActivityTypes.Message);
        expect(activity.text).toContain("payment-service is throwing 500s");
      })
      .startTest();
  });

  it("routes messages to mention handler when registered", async () => {
    const { adapter, bot } = makeTestAdapter();
    let receivedText = "";

    bot.onMention(async (text, ctx) => {
      receivedText = text;
      await bot.postMessage(ctx, { text: `Investigating: ${text}` });
    });

    await adapter
      .send("payment-service is down")
      .assertReply((activity) => {
        expect(activity.text).toContain("Investigating: payment-service is down");
      })
      .startTest();

    expect(receivedText).toBe("payment-service is down");
  });

  it("strips Teams mention markup from messages", async () => {
    const { adapter, bot } = makeTestAdapter();
    let receivedText = "";

    bot.onMention(async (text, ctx) => {
      receivedText = text;
      await bot.postMessage(ctx, { text: `Got: ${text}` });
    });

    await adapter
      .send("<at>OnCallBot</at> payment-service is down")
      .assertReply((activity) => {
        expect(activity.text).toContain("Got: payment-service is down");
      })
      .startTest();

    expect(receivedText).toBe("payment-service is down");
  });

  it("strips multiple nested mention tags", async () => {
    const { adapter, bot } = makeTestAdapter();
    let receivedText = "";

    bot.onMention(async (text, ctx) => {
      receivedText = text;
      await bot.postMessage(ctx, { text: "ok" });
    });

    await adapter
      .send("<at>OnCallBot</at> check <at>payment-service</at> now")
      .assertReply(() => {})
      .startTest();

    expect(receivedText).toBe("check  now");
  });

  it("responds with usage hint for empty messages", async () => {
    const { adapter, bot } = makeTestAdapter();
    bot.onMention(async () => {});

    await adapter
      .send("")
      .assertReply((activity) => {
        expect(activity.text).toContain("provide an alert");
      })
      .startTest();
  });

  it("responds with usage hint when only mention tags (empty after strip)", async () => {
    const { adapter, bot } = makeTestAdapter();
    bot.onMention(async () => {});

    await adapter
      .send("<at>OnCallBot</at>")
      .assertReply((activity) => {
        expect(activity.text).toContain("provide an alert");
      })
      .startTest();
  });
});

// ── Member greeting ────────────────────────────────────────────────────

describe("TeamsAdapter — member greeting", () => {
  it("greets new members", async () => {
    const { adapter } = makeTestAdapter();

    const conversationUpdate: Partial<Activity> = {
      type: ActivityTypes.ConversationUpdate,
      membersAdded: [{ id: "user-1", name: "Alice" }],
      recipient: { id: "bot-id", name: "OnCallBot" },
    };

    await adapter
      .send(conversationUpdate)
      .assertReply((activity) => {
        expect(activity.text).toContain("OnCall Agent");
      })
      .startTest();
  });
});

// ── postMessage ────────────────────────────────────────────────────────

describe("TeamsAdapter — postMessage", () => {
  it("postMessage without blocks sends plain text activity", async () => {
    const { adapter, bot } = makeTestAdapter();

    bot.onMention(async (_text, ctx) => {
      await bot.postMessage(ctx, { text: "plain text reply" });
    });

    await adapter
      .send("test")
      .assertReply((activity) => {
        expect(activity.text).toBe("plain text reply");
        expect(activity.attachments ?? []).toHaveLength(0);
      })
      .startTest();
  });

  it("postMessage with blocks sends activity with Adaptive Card attachment", async () => {
    const { adapter, bot } = makeTestAdapter();

    const blocks: InvestigationBlocks = {
      type: "investigation_result",
      alert: {
        id: "a1", title: "Test", severity: "high", service: "test-service",
        timestamp: new Date(), labels: {},
      },
      hypotheses: [{
        original_rank: 1, original_confidence: 90, challenge_score: 10,
        key_objections: [], missing_evidence: [], revised_confidence: 85,
      }],
      originalHypotheses: [{
        id: "h1", description: "Test hypothesis", confidence: 90,
        evidence: ["evidence"], relatedServices: [], suggestedActions: ["Fix it"],
      }],
      investigation: {
        id: "inv1", alertId: "a1", startedAt: new Date(), status: "completed",
        hypotheses: [{
          id: "h1", description: "Test hypothesis", confidence: 90,
          evidence: ["evidence"], relatedServices: [], suggestedActions: ["Fix it"],
        }],
        summary: "Test summary",
      },
      validation: {
        incident_id: "inv1", validated_hypotheses: [{
          original_rank: 1, original_confidence: 90, challenge_score: 10,
          key_objections: [], missing_evidence: [], revised_confidence: 85,
        }],
        escalate: false, validator_notes: "Looks good",
      },
      timeline: [],
      duration_ms: 3000,
      tool_call_count: 2,
      escalate: false,
    };

    bot.onMention(async (_text, ctx) => {
      await bot.postMessage(ctx, { text: "fallback", blocks });
    });

    await adapter
      .send("test")
      .assertReply((activity) => {
        expect(activity.attachments).toBeDefined();
        expect(activity.attachments!.length).toBe(1);
        const attachment = activity.attachments![0]!;
        expect(attachment.contentType).toBe("application/vnd.microsoft.card.adaptive");
        const card = attachment.content as { type: string; version: string };
        expect(card.type).toBe("AdaptiveCard");
        expect(card.version).toBe("1.5");
      })
      .startTest();
  });

  it("postMessage returns a messageId", async () => {
    const { adapter, bot } = makeTestAdapter();

    bot.onMention(async (_text, ctx) => {
      const { messageId } = await bot.postMessage(ctx, { text: "test reply" });
      expect(typeof messageId).toBe("string");
    });

    await adapter.send("test").startTest();
  });

  it("postMessage throws when called outside a turn", async () => {
    const bot = new TeamsAdapter();
    const ctx: MessageContext = {
      channelId: "C1", threadId: "T1", userId: "U1", platform: "teams",
    };

    let error: Error | undefined;
    try {
      await bot.postMessage(ctx, { text: "test" });
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain("outside of a turn context");
  });
});

// ── onAction / invoke ──────────────────────────────────────────────────

describe("TeamsAdapter — action handlers", () => {
  it("onAction registers handlers without throwing", () => {
    const bot = new TeamsAdapter();
    bot.onAction(ACTIONS.CONFIRM, async () => {});
    bot.onAction(ACTIONS.REJECT, async () => {});
    bot.onAction(ACTIONS.INVESTIGATE_MORE, async () => {});
    // No assertion needed — just verifying no throw
  });

  it("invoke activity with known actionId calls correct handler", async () => {
    const { adapter, bot } = makeTestAdapter();
    let calledActionId = "";

    bot.onAction(ACTIONS.CONFIRM, async (ctx) => {
      calledActionId = ctx.actionId;
    });

    const invokeActivity: Partial<Activity> = {
      type: ActivityTypes.Invoke,
      name: "adaptiveCard/action",
      value: { actionId: ACTIONS.CONFIRM, value: "confirm" },
    };

    await adapter.send(invokeActivity).startTest();
    expect(calledActionId).toBe(ACTIONS.CONFIRM);
  });

  it("invoke activity with unknown actionId does not crash", async () => {
    const { adapter, bot } = makeTestAdapter();
    let confirmCalled = false;

    bot.onAction(ACTIONS.CONFIRM, async () => {
      confirmCalled = true;
    });

    const invokeActivity: Partial<Activity> = {
      type: ActivityTypes.Invoke,
      name: "adaptiveCard/action",
      value: { actionId: "unknown_action", value: "test" },
    };

    // Should not throw — unknown actionId is silently ignored
    await adapter.send(invokeActivity).startTest();
    expect(confirmCalled).toBe(false);
  });

  it("invoke handler receives correct ActionContext fields", async () => {
    const { adapter, bot } = makeTestAdapter();
    let receivedCtx: { actionId: string; platform: string; value: string } | undefined;

    bot.onAction(ACTIONS.REJECT, async (ctx) => {
      receivedCtx = { actionId: ctx.actionId, platform: ctx.platform, value: ctx.value };
    });

    const invokeActivity: Partial<Activity> = {
      type: ActivityTypes.Invoke,
      name: "adaptiveCard/action",
      value: { actionId: ACTIONS.REJECT, value: "reject" },
    };

    await adapter.send(invokeActivity).startTest();
    expect(receivedCtx).toBeDefined();
    expect(receivedCtx!.actionId).toBe(ACTIONS.REJECT);
    expect(receivedCtx!.platform).toBe("teams");
    expect(receivedCtx!.value).toBe("reject");
  });
});

// ── BotAdapter interface ───────────────────────────────────────────────

describe("TeamsAdapter — BotAdapter compile-time check", () => {
  it("satisfies BotAdapter at compile time", () => {
    const bot = new TeamsAdapter();
    const _adapter: import("@oncall/bot-core").BotAdapter = bot;
    expect(_adapter).toBeDefined();
  });
});
