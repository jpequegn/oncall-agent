import {
  TeamsActivityHandler,
  type TurnContext,
  CardFactory,
  MessageFactory,
  type Activity,
} from "botbuilder";
import type { BotAdapter, MessageContext, ActionContext, BotMessage, InvestigationBlocks } from "@oncall/bot-core";
import { ACTIONS } from "@oncall/bot-core";
import { renderAdaptiveCard } from "./formatters/adaptive-card";

// ── Context helpers ────────────────────────────────────────────────────────

function buildMessageContext(context: TurnContext): MessageContext {
  const activity = context.activity;
  return {
    channelId: activity.channelId ?? activity.conversation?.id ?? "",
    threadId: activity.conversation?.id ?? "",
    userId: activity.from?.id ?? "unknown",
    platform: "teams",
  };
}

function buildActionContext(context: TurnContext, actionId: string): ActionContext {
  const activity = context.activity;
  return {
    channelId: activity.channelId ?? activity.conversation?.id ?? "",
    threadId: activity.conversation?.id ?? "",
    userId: activity.from?.id ?? "unknown",
    platform: "teams",
    actionId,
    value: activity.value?.value ?? "",
    messageId: activity.replyToId ?? "",
  };
}

/**
 * Strip Teams-specific mention markup from message text.
 * Teams wraps bot mentions as `<at>BotName</at>` in the text.
 */
function stripTeamsMentions(text: string): string {
  return text.replace(/<at>[^<]*<\/at>/gi, "").trim();
}

// ── TeamsAdapter ───────────────────────────────────────────────────────────

/**
 * BotAdapter implementation for Microsoft Teams.
 * Extends TeamsActivityHandler to receive Bot Framework events
 * and exposes the BotAdapter interface for bot-core orchestrator.
 *
 * The TurnContext is captured during each turn and used by
 * postMessage/updateMessage within that same turn's async scope.
 */
export class TeamsAdapter extends TeamsActivityHandler implements BotAdapter {
  private mentionHandler?: (text: string, ctx: MessageContext) => Promise<void>;
  private actionHandlers = new Map<string, (ctx: ActionContext) => Promise<void>>();

  /**
   * Active TurnContext — set at the start of each turn.
   * Only valid within the async scope of a single turn.
   */
  private turnContext: TurnContext | null = null;

  constructor() {
    super();

    // Register member greeting via ActivityHandler's event system
    // (works with both TestAdapter and Teams-specific dispatching)
    this.onMembersAdded(async (context, next) => {
      for (const member of context.activity.membersAdded ?? []) {
        if (member.id !== context.activity.recipient?.id) {
          await context.sendActivity(
            MessageFactory.text("👋 Hi! I'm the OnCall Agent. Mention me with an alert description and I'll investigate.")
          );
        }
      }
      await next();
    });
  }

  // ── BotAdapter: postMessage ──────────────────────────────────────────

  async postMessage(ctx: MessageContext, message: BotMessage): Promise<{ messageId: string }> {
    if (!this.turnContext) {
      throw new Error("TeamsAdapter.postMessage called outside of a turn context");
    }

    let activity: Partial<Activity>;
    if (message.blocks) {
      const card = renderAdaptiveCard(message.blocks);
      activity = {
        type: "message",
        text: message.text,
        attachments: [CardFactory.adaptiveCard(card)],
      };
    } else {
      activity = MessageFactory.text(message.text);
    }

    const response = await this.turnContext.sendActivity(activity);
    return { messageId: response?.id ?? "" };
  }

  // ── BotAdapter: updateMessage ────────────────────────────────────────

  async updateMessage(ctx: MessageContext, messageId: string, message: BotMessage): Promise<void> {
    if (!this.turnContext) return;

    try {
      await this.turnContext.updateActivity({
        id: messageId,
        type: "message",
        text: message.text,
      });
    } catch {
      // Teams may not support updating all message types — silently continue
    }
  }

  // ── BotAdapter: onMention ────────────────────────────────────────────

  onMention(handler: (text: string, ctx: MessageContext) => Promise<void>): void {
    this.mentionHandler = handler;
  }

  // ── BotAdapter: onAction ─────────────────────────────────────────────

  onAction(actionId: string, handler: (ctx: ActionContext) => Promise<void>): void {
    this.actionHandlers.set(actionId, handler);
  }

  // ── BotAdapter: start ────────────────────────────────────────────────

  async start(): Promise<void> {
    // Managed externally by the HTTP server + CloudAdapter in app.ts
  }

  // ── Bot Framework: onMessage ─────────────────────────────────────────

  protected async onMessageActivity(context: TurnContext): Promise<void> {
    this.turnContext = context;

    if (this.mentionHandler) {
      const rawText = context.activity.text ?? "";
      const text = stripTeamsMentions(rawText).trim();
      const ctx = buildMessageContext(context);

      if (!text) {
        await context.sendActivity(
          MessageFactory.text("Please provide an alert or service name to investigate.")
        );
        return;
      }

      await this.mentionHandler(text, ctx);
    } else {
      // Fallback echo if no handler registered
      const text = stripTeamsMentions(context.activity.text ?? "");
      await context.sendActivity(
        MessageFactory.text(`🔍 Received: "${text}"`)
      );
    }
  }

  // ── Bot Framework: onInvoke (Adaptive Card Action.Submit) ────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async onInvokeActivity(context: TurnContext): Promise<any> {
    this.turnContext = context;

    const value = context.activity.value;
    const actionId = value?.actionId as string | undefined;

    if (actionId && this.actionHandlers.has(actionId)) {
      const handler = this.actionHandlers.get(actionId)!;
      const ctx = buildActionContext(context, actionId);
      await handler(ctx);
      return { status: 200 };
    }

    // Delegate to parent for other invoke types — catch errors
    // from malformed invoke activities (e.g. missing action.type)
    try {
      return await super.onInvokeActivity(context);
    } catch {
      return { status: 200 };
    }
  }

}
