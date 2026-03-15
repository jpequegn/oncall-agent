import { describe, it, expect } from "bun:test";
import { TeamsAdapter } from "../teams-adapter";
import { TestAdapter, ActivityTypes, type Activity } from "botbuilder";

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
});

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

describe("TeamsAdapter — BotAdapter interface", () => {
  it("satisfies BotAdapter at compile time", () => {
    // This is a compile-time check — if TeamsAdapter doesn't implement BotAdapter,
    // TypeScript will error here.
    const bot = new TeamsAdapter();
    const _adapter: import("@oncall/bot-core").BotAdapter = bot;
    expect(_adapter).toBeDefined();
  });

  it("postMessage returns a messageId", async () => {
    const { adapter, bot } = makeTestAdapter();

    bot.onMention(async (text, ctx) => {
      const { messageId } = await bot.postMessage(ctx, { text: "test reply" });
      // TestAdapter generates IDs
      expect(typeof messageId).toBe("string");
    });

    await adapter.send("test").startTest();
  });

  it("onAction registers handlers", () => {
    const bot = new TeamsAdapter();
    let called = false;
    bot.onAction("test_action", async () => { called = true; });
    // Handler is registered — we can't easily invoke it without a full invoke activity,
    // but the registration should not throw
    expect(called).toBe(false);
  });
});
