import { App } from "@slack/bolt";
import { handleIncident } from "./handlers/incident";
import { registerActionHandlers, handlePendingRejection, pendingRejections } from "./handlers/actions";

// ── Environment ────────────────────────────────────────────────────────────

const SLACK_BOT_TOKEN      = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_APP_TOKEN      = process.env.SLACK_APP_TOKEN; // for Socket Mode
const PORT                 = Number(process.env.PORT ?? 3000);
const SERVICE_GRAPH_URL    = process.env.SERVICE_GRAPH_URL ?? "http://localhost:3001";

if (!SLACK_BOT_TOKEN || !SLACK_SIGNING_SECRET) {
  console.error("❌ Missing required env vars: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET");
  process.exit(1);
}

// ── Bolt app ───────────────────────────────────────────────────────────────

const appConfig: ConstructorParameters<typeof App>[0] = {
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
};

if (SLACK_APP_TOKEN) {
  appConfig.appToken = SLACK_APP_TOKEN;
  appConfig.socketMode = true;
}

const app = new App(appConfig);

// ── Event: app_mention ─────────────────────────────────────────────────────

app.event("app_mention", async ({ event }) => {
  const alertText = event.text.replace(/<@[^>]+>/g, "").trim();
  const threadTs = ("thread_ts" in event ? event.thread_ts as string : undefined) ?? event.ts;

  await handleIncident({
    text: alertText || event.text,
    channelId: event.channel,
    threadTs,
    app,
    serviceGraphUrl: SERVICE_GRAPH_URL,
  });
});

// ── Action handlers (button interactions) ─────────────────────────────────

registerActionHandlers(app);

// ── Thread message listener (rejection correction flow) ────────────────────

app.message(async ({ message, client }) => {
  // Only handle threaded messages that are not from bots
  if (message.subtype) return; // bot messages, edits, etc.
  const msg = message as { channel: string; ts: string; thread_ts?: string; text?: string; user?: string };
  if (!msg.thread_ts || !msg.text) return;

  const key = `${msg.channel}-${msg.thread_ts}`;
  if (!pendingRejections.has(key)) return;

  await handlePendingRejection(app, msg.channel, msg.thread_ts, msg.text, msg.user ?? "unknown");
});

// ── Command: /investigate ──────────────────────────────────────────────────

app.command("/investigate", async ({ command, ack, say }) => {
  await ack();

  const text = command.text.trim();
  if (!text) {
    await say({
      text: "Usage: `/investigate <service-name or description>`\nExamples:\n• `/investigate payment-service`\n• `/investigate order-service high latency`",
    });
    return;
  }

  await handleIncident({
    text,
    channelId: command.channel_id,
    threadTs: command.trigger_id,
    app,
    serviceGraphUrl: SERVICE_GRAPH_URL,
  });
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
