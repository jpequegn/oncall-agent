import type { MessageContext, ActionContext, BotMessage } from "./types";

export interface BotAdapter {
  /** Post a new message in a channel/thread. */
  postMessage(ctx: MessageContext, message: BotMessage): Promise<{ messageId: string }>;

  /** Update an existing message in-place. */
  updateMessage(ctx: MessageContext, messageId: string, message: BotMessage): Promise<void>;

  /** Register a handler for @-mentions. */
  onMention(handler: (text: string, ctx: MessageContext) => Promise<void>): void;

  /** Register a handler for interactive action buttons. */
  onAction(actionId: string, handler: (ctx: ActionContext) => Promise<void>): void;

  /** Start the adapter (connect to platform API). */
  start(): Promise<void>;
}
