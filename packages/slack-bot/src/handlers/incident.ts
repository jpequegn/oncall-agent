import type { App } from "@slack/bolt";
import {
  handleIncidentMention,
  type MessageContext,
  type OrchestratorOptions,
} from "@oncall/bot-core";
import { makeSlackAdapter } from "../slack-adapter";

// ── Tool name formatter (kept for backward compat with tests) ────────────

export { formatToolName } from "@oncall/bot-core";

// ── Main handler ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAnthropicClient = any;

export interface HandleIncidentOptions {
  text: string;
  channelId: string;
  threadTs: string;
  app: App;
  serviceGraphUrl?: string;
  _investigationClient?: AnyAnthropicClient;
  _validationClient?: AnyAnthropicClient;
}

export async function handleIncident(opts: HandleIncidentOptions): Promise<void> {
  const { text, channelId, threadTs, app, serviceGraphUrl, _investigationClient, _validationClient } = opts;

  const ctx: MessageContext = {
    channelId,
    threadId: threadTs,
    userId: "",
    platform: "slack",
  };

  const adapter = makeSlackAdapter(app, channelId);

  const orchOpts: OrchestratorOptions = {
    serviceGraphUrl,
    _investigationClient,
    _validationClient,
  };

  await handleIncidentMention(text, ctx, adapter, orchOpts);
}
