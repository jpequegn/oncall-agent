import type { InvestigationResult } from "@shared/types";

export class SlackBot {
  async postInvestigationResult(
    channel: string,
    result: InvestigationResult
  ): Promise<void> {
    // Placeholder: real implementation will use Slack Web API
    console.log(`[SlackBot] Posting to ${channel}:`, result.summary ?? result.status);
  }

  async postAlert(channel: string, message: string): Promise<void> {
    console.log(`[SlackBot] Alert to ${channel}: ${message}`);
  }
}
