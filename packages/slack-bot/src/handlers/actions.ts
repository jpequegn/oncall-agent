import type { App } from "@slack/bolt";
import {
  ACTIONS,
  handleConfirm,
  handleReject,
  handleInvestigateMore,
  handleRejectionReply,
  investigationStore,
  pendingRejections,
  type MessageContext,
  type OrchestratorOptions,
} from "@oncall/bot-core";
import { SlackAdapter } from "../slack-adapter";
import { formatInvestigationResult, formatPlainText } from "../formatters/investigation";
import type { Block } from "../formatters/investigation";

// Re-export stores for app.ts and tests
export { investigationStore, pendingRejections };

// ── Button-disable helper ──────────────────────────────────────────────────

function disableButtons(originalBlocks: Block[], notice: string): Block[] {
  const withoutActions = originalBlocks.filter((b) => b.type !== "actions");
  withoutActions.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: notice }],
  });
  return withoutActions;
}

// ── Register all action handlers ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export interface ActionHandlerOptions {
  _investigationClient?: AnyClient;
  _validationClient?: AnyClient;
}

export function registerActionHandlers(app: App, opts: ActionHandlerOptions = {}): void {
  const adapter = new SlackAdapter(app);

  const orchOpts: OrchestratorOptions = {
    _investigationClient: opts._investigationClient,
    _validationClient: opts._validationClient,
  };

  // ── 👍 Confirm ────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.action(ACTIONS.CONFIRM, async ({ ack, body, client }: any) => {
    await ack();

    const channel: string = body.container?.channel_id ?? body.channel?.id ?? "";
    const messageTs: string = body.container?.message_ts ?? body.message?.ts ?? "";
    const threadTs: string = body.message?.thread_ts ?? messageTs;
    const userId: string = body.user?.id ?? "unknown";

    await handleConfirm({
      channelId: channel, threadId: threadTs, userId, platform: "slack",
      actionId: ACTIONS.CONFIRM, value: "confirm", messageId: messageTs,
    }, adapter);

    // Disable buttons on original message (Slack-specific Block Kit)
    const result = investigationStore.get(`${channel}-${messageTs}`);
    const originalBlocks = (body.message?.blocks ?? []) as Block[];
    await client.chat.update({
      channel, ts: messageTs,
      text: result ? formatPlainText(result) : "",
      blocks: disableButtons(originalBlocks, `✅ *Confirmed* by <@${userId}>`),
    });
  });

  // ── ❌ Reject ─────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.action(ACTIONS.REJECT, async ({ ack, body, client }: any) => {
    await ack();

    const channel: string = body.container?.channel_id ?? body.channel?.id ?? "";
    const messageTs: string = body.container?.message_ts ?? body.message?.ts ?? "";
    const threadTs: string = body.message?.thread_ts ?? messageTs;
    const userId: string = body.user?.id ?? "unknown";

    await handleReject({
      channelId: channel, threadId: threadTs, userId, platform: "slack",
      actionId: ACTIONS.REJECT, value: "reject", messageId: messageTs,
    }, adapter);

    // Disable buttons (Slack-specific)
    const result = investigationStore.get(`${channel}-${messageTs}`);
    const originalBlocks = (body.message?.blocks ?? []) as Block[];
    await client.chat.update({
      channel, ts: messageTs,
      text: result ? formatPlainText(result) : "",
      blocks: disableButtons(originalBlocks, `❌ *Rejected* by <@${userId}> — awaiting correction`),
    });
  });

  // ── 🔍 Dig deeper ─────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.action(ACTIONS.INVESTIGATE_MORE, async ({ ack, body, client }: any) => {
    await ack();

    const channel: string = body.container?.channel_id ?? body.channel?.id ?? "";
    const messageTs: string = body.container?.message_ts ?? body.message?.ts ?? "";
    const threadTs: string = body.message?.thread_ts ?? messageTs;
    const userId: string = body.user?.id ?? "unknown";

    // Disable buttons immediately (Slack-specific)
    const result = investigationStore.get(`${channel}-${messageTs}`);
    const originalBlocks = (body.message?.blocks ?? []) as Block[];
    await client.chat.update({
      channel, ts: messageTs,
      text: result ? formatPlainText(result) : "",
      blocks: disableButtons(originalBlocks, `🔍 *Deeper investigation* requested by <@${userId}>`),
    });

    await handleInvestigateMore({
      channelId: channel, threadId: threadTs, userId, platform: "slack",
      actionId: ACTIONS.INVESTIGATE_MORE, value: "investigate_more", messageId: messageTs,
    }, adapter, orchOpts);
  });
}

// ── Handle pending rejection replies ──────────────────────────────────────

export async function handlePendingRejection(
  app: App,
  channel: string,
  threadTs: string,
  correctionText: string,
  userId: string
): Promise<void> {
  const adapter = new SlackAdapter(app);
  const ctx: MessageContext = {
    channelId: channel,
    threadId: threadTs,
    userId,
    platform: "slack",
  };
  await handleRejectionReply(correctionText, ctx, adapter);
}
