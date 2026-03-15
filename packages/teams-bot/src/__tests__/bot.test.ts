import { describe, it, expect } from "bun:test";
import { OnCallBot } from "../bot";
import { TestAdapter, ActivityTypes, type Activity } from "botbuilder";

const bot = new OnCallBot();

function makeTestAdapter(): TestAdapter {
  const adapter = new TestAdapter(async (context) => {
    await bot.run(context);
  });
  adapter.onTurnError = async (_context, error) => {
    throw error;
  };
  return adapter;
}

describe("OnCallBot", () => {
  it("echoes received messages with investigation stub", async () => {
    const adapter = makeTestAdapter();

    await adapter
      .send("payment-service is throwing 500s")
      .assertReply((activity) => {
        expect(activity.type).toBe(ActivityTypes.Message);
        const text = activity.text ?? "";
        expect(text).toContain("payment-service is throwing 500s");
        expect(text).toContain("Received");
      })
      .startTest();
  });

  it("responds with usage hint for empty messages", async () => {
    const adapter = makeTestAdapter();

    await adapter
      .send("")
      .assertReply((activity) => {
        expect(activity.text).toContain("provide an alert");
      })
      .startTest();
  });

  it("greets new members", async () => {
    const adapter = makeTestAdapter();

    const conversationUpdate: Partial<Activity> = {
      type: ActivityTypes.ConversationUpdate,
      membersAdded: [
        { id: "user-1", name: "Alice" },
      ],
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
