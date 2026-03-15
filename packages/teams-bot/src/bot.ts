import { ActivityHandler, type TurnContext, MessageFactory } from "botbuilder";

/**
 * OnCall Agent bot for Microsoft Teams.
 * Handles incoming messages and routes them to the investigation pipeline.
 * For now, implements a simple echo for Bot Framework Emulator testing.
 */
export class OnCallBot extends ActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context: TurnContext, next) => {
      const text = context.activity.text?.trim() ?? "";

      if (!text) {
        await context.sendActivity(MessageFactory.text("Please provide an alert or service name to investigate."));
        await next();
        return;
      }

      // Echo for now — will be replaced with bot-core orchestrator in issue #26
      await context.sendActivity(
        MessageFactory.text(`🔍 Received: "${text}"\n\n_Investigation pipeline will be wired in a follow-up issue._`)
      );

      await next();
    });

    this.onMembersAdded(async (context: TurnContext, next) => {
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
}
