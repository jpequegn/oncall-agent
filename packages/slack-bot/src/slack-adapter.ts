import type { App } from "@slack/bolt";
import type { BotAdapter, MessageContext, ActionContext, BotMessage } from "@oncall/bot-core";
import { renderBlockKit, renderPlainText } from "./formatters/investigation";

/**
 * Slack-specific BotAdapter implementation.
 * Wraps a Slack Bolt App and renders InvestigationBlocks as Block Kit.
 */
export class SlackAdapter implements BotAdapter {
  constructor(private app: App) {}

  async postMessage(ctx: MessageContext, message: BotMessage): Promise<{ messageId: string }> {
    const result = await this.app.client.chat.postMessage({
      channel: ctx.channelId,
      thread_ts: ctx.threadId,
      text: message.text,
      blocks: message.blocks ? renderBlockKit(message.blocks) : undefined,
    });
    return { messageId: result.ts! };
  }

  async updateMessage(ctx: MessageContext, messageId: string, message: BotMessage): Promise<void> {
    await this.app.client.chat.update({
      channel: ctx.channelId,
      ts: messageId,
      text: message.text,
      blocks: message.blocks ? renderBlockKit(message.blocks) : undefined,
    });
  }

  onMention(handler: (text: string, ctx: MessageContext) => Promise<void>): void {
    this.app.event("app_mention", async ({ event }) => {
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
  }

  onAction(actionId: string, handler: (ctx: ActionContext) => Promise<void>): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.app.action(actionId, async ({ ack, body }: any) => {
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
  }

  async start(): Promise<void> {
    const port = Number(process.env.PORT ?? 3000);
    await this.app.start(port);
  }
}
