import { App } from "@slack/bolt";
import {
  ACTIONS,
  handleIncidentMention,
  handleConfirm,
  handleReject,
  handleInvestigateMore,
  handleRejectionReply,
  pendingRejections,
  type MessageContext,
} from "@oncall/bot-core";
import { SlackAdapter } from "./slack-adapter";

// ── Environment ────────────────────────────────────────────────────────────

const SLACK_BOT_TOKEN      = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_APP_TOKEN      = process.env.SLACK_APP_TOKEN;
const PORT                 = Number(process.env.PORT ?? 3000);
const SERVICE_GRAPH_URL    = process.env.SERVICE_GRAPH_URL ?? "http://localhost:3001";

if (!SLACK_BOT_TOKEN || !SLACK_SIGNING_SECRET) {
  console.error("❌ Missing required env vars: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET");
  process.exit(1);
}

// ── Bolt app + adapter ─────────────────────────────────────────────────────

const appConfig: ConstructorParameters<typeof App>[0] = {
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
};

if (SLACK_APP_TOKEN) {
  appConfig.appToken = SLACK_APP_TOKEN;
  appConfig.socketMode = true;
}

const app = new App(appConfig);
const adapter = new SlackAdapter(app);
const orchOpts = { serviceGraphUrl: SERVICE_GRAPH_URL };

// ── Wire events via adapter ────────────────────────────────────────────────

adapter.onMention(async (text, ctx) => {
  await handleIncidentMention(text, ctx, adapter, orchOpts);
});

adapter.onAction(ACTIONS.CONFIRM, async (ctx) => {
  await handleConfirm(ctx, adapter);
});

adapter.onAction(ACTIONS.REJECT, async (ctx) => {
  await handleReject(ctx, adapter);
});

adapter.onAction(ACTIONS.INVESTIGATE_MORE, async (ctx) => {
  await handleInvestigateMore(ctx, adapter, orchOpts);
});

// ── Thread message listener (rejection correction flow) ────────────────────

app.message(async ({ message }) => {
  if (message.subtype) return;
  const msg = message as { channel: string; ts: string; thread_ts?: string; text?: string; user?: string };
  if (!msg.thread_ts || !msg.text) return;
  if (!pendingRejections.has(`${msg.channel}-${msg.thread_ts}`)) return;

  const ctx: MessageContext = {
    channelId: msg.channel,
    threadId: msg.thread_ts,
    userId: msg.user ?? "unknown",
    platform: "slack",
  };
  await handleRejectionReply(msg.text, ctx, adapter);
});

// ── Command: /investigate ──────────────────────────────────────────────────

app.command("/investigate", async ({ command, ack, say }) => {
  await ack();
  const text = command.text.trim();
  if (!text) {
    await say({ text: "Usage: `/investigate <service-name or description>`" });
    return;
  }
  const ctx: MessageContext = {
    channelId: command.channel_id,
    threadId: command.trigger_id,
    userId: command.user_id,
    platform: "slack",
  };
  await handleIncidentMention(text, ctx, adapter, orchOpts);
});

// ── Health check ───────────────────────────────────────────────────────────

if (!SLACK_APP_TOKEN) {
  const server = Bun.serve({
    port: PORT + 1,
    fetch(req: Request) {
      if (new URL(req.url).pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok", service: "slack-bot" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  console.log(`🏥 Health check: http://localhost:${server.port}/health`);
}

// ── Start ──────────────────────────────────────────────────────────────────

await app.start(PORT);
console.log(`⚡ Slack bot running on port ${PORT}`);
console.log(`   Mode: ${SLACK_APP_TOKEN ? "Socket Mode" : "HTTP"}`);
console.log(`   Service graph: ${SERVICE_GRAPH_URL}`);
