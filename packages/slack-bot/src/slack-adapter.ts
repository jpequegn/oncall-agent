import type { App } from "@slack/bolt";
import type { BotAdapter, MessageContext, ActionContext, BotMessage } from "@oncall/bot-core";

/**
 * Create a BotAdapter backed by a Slack Bolt App instance.
 * The adapter uses Bolt's `client.chat.*` methods for messaging
 * and delegates onMention/onAction registration to Bolt's event API.
 */
export function makeSlackAdapter(app: App, _defaultChannel?: string): BotAdapter {
  return {
    async postMessage(ctx: MessageContext, message: BotMessage) {
      const result = await app.client.chat.postMessage({
        channel: ctx.channelId,
        thread_ts: ctx.threadId,
        text: message.text,
      });
      return { messageId: result.ts! };
    },

    async updateMessage(ctx: MessageContext, messageId: string, message: BotMessage) {
      await app.client.chat.update({
        channel: ctx.channelId,
        ts: messageId,
        text: message.text,
      });
    },

    onMention(handler) {
      app.event("app_mention", async ({ event }) => {
        const alertText = event.text.replace(/<@[^>]+>/g, "").trim();
        const threadTs = ("thread_ts" in event ? event.thread_ts as string : undefined) ?? event.ts;
        const ctx: MessageContext = {
          channelId: event.channel,
          threadId: threadTs,
          userId: event.user ?? "unknown",
          platform: "slack",
        };
        await handler(alertText || event.text, ctx);
      });
    },

    onAction(actionId, handler) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app.action(actionId, async ({ ack, body }: any) => {
        await ack();
        const channel: string = body.container?.channel_id ?? body.channel?.id ?? "";
        const messageTs: string = body.container?.message_ts ?? body.message?.ts ?? "";
        const threadTs: string = body.message?.thread_ts ?? messageTs;
        const userId: string = body.user?.id ?? "unknown";
        const ctx: ActionContext = {
          channelId: channel,
          threadId: threadTs,
          userId,
          platform: "slack",
          actionId,
          value: body.actions?.[0]?.value ?? "",
          messageId: messageTs,
        };
        await handler(ctx);
      });
    },

    async start() {
      // Bolt app start is handled externally in app.ts
    },
  };
}
