import { App } from "@slack/bolt";
import type { ScenarioName } from "@shared/mock-data";
import { parseAlert } from "./alert-parser";

// ── Environment ────────────────────────────────────────────────────────────

const SLACK_BOT_TOKEN   = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_APP_TOKEN   = process.env.SLACK_APP_TOKEN; // for Socket Mode
const PORT              = Number(process.env.PORT ?? 3000);
const SERVICE_GRAPH_URL = process.env.SERVICE_GRAPH_URL ?? "http://localhost:3001";

if (!SLACK_BOT_TOKEN || !SLACK_SIGNING_SECRET) {
  console.error("❌ Missing required env vars: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET");
  process.exit(1);
}

// ── Scenario detection ─────────────────────────────────────────────────────

const SCENARIO_KEYWORDS: Record<string, ScenarioName> = {
  "deploy-regression": "deploy-regression",
  "deploy regression": "deploy-regression",
  "upstream-failure":  "upstream-failure",
  "upstream failure":  "upstream-failure",
  "no-clear-cause":    "no-clear-cause",
  "no clear cause":    "no-clear-cause",
  "payment-service":   "deploy-regression",
  "order-service":     "upstream-failure",
  "fraud-service":     "no-clear-cause",
};

function detectScenario(service: string, text: string): ScenarioName {
  const lower = (service + " " + text).toLowerCase();
  for (const [keyword, scenario] of Object.entries(SCENARIO_KEYWORDS)) {
    if (lower.includes(keyword)) return scenario;
  }
  return "deploy-regression"; // default
}

// ── Investigation trigger ──────────────────────────────────────────────────

async function triggerInvestigation(opts: {
  text: string;
  threadTs: string;
  channelId: string;
  say: (args: { text: string; thread_ts: string }) => Promise<unknown>;
}) {
  const { text, threadTs, channelId, say } = opts;

  // Parse the alert using LLM extraction with regex fallback
  const alert = await parseAlert(text);
  alert.labels.channel = channelId;

  const scenario = detectScenario(alert.service, text);

  await say({ text: `🔍 Investigating *${alert.service}*... (severity: ${alert.severity})`, thread_ts: threadTs });

  // Lazy import to keep startup fast
  const { runFullInvestigation } = await import("@oncall/hypothesis-validator");

  try {
    const result = await runFullInvestigation(alert, {
      scenario: scenario as ScenarioName,
      serviceGraphUrl: SERVICE_GRAPH_URL,
    });

    if (result.escalate) {
      await say({
        text: `🚨 *Escalation required*: ${result.validation.escalation_reason}\n\n*Top hypothesis (${result.final_hypotheses[0]?.revised_confidence ?? 0}% confidence):* ${result.investigation.hypotheses[0]?.description ?? "none"}`,
        thread_ts: threadTs,
      });
    } else {
      const top = result.final_hypotheses[0];
      const origH = top ? result.investigation.hypotheses[top.original_rank - 1] : undefined;
      await say({
        text: `✅ *Root cause identified* (${top?.revised_confidence ?? 0}% confidence)\n>${origH?.description ?? "unknown"}\n\n*Action:* ${origH?.suggestedActions[0] ?? "See investigation details"}`,
        thread_ts: threadTs,
      });
    }
  } catch (err) {
    await say({
      text: `❌ Investigation failed: ${(err as Error).message}`,
      thread_ts: threadTs,
    });
  }
}

// ── Bolt app ───────────────────────────────────────────────────────────────

const appConfig: ConstructorParameters<typeof App>[0] = {
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
};

// Use Socket Mode when SLACK_APP_TOKEN is provided (development), else HTTP
if (SLACK_APP_TOKEN) {
  appConfig.appToken = SLACK_APP_TOKEN;
  appConfig.socketMode = true;
}

const app = new App(appConfig);

// ── Event: app_mention ─────────────────────────────────────────────────────

app.event("app_mention", async ({ event, say }) => {
  const alertText = event.text.replace(/<@[^>]+>/g, "").trim();

  await triggerInvestigation({
    text: alertText || event.text,
    threadTs: ("thread_ts" in event ? event.thread_ts as string : undefined) ?? event.ts,
    channelId: event.channel,
    say: (args) => say(args),
  });
});

// ── Command: /investigate ──────────────────────────────────────────────────

app.command("/investigate", async ({ command, ack, say }) => {
  await ack();

  const text = command.text.trim();
  if (!text) {
    await say({
      text: "Usage: `/investigate <service-name or description>`\nExamples:\n• `/investigate payment-service`\n• `/investigate order-service high latency`",
      thread_ts: undefined as unknown as string,
    });
    return;
  }

  await triggerInvestigation({
    text,
    threadTs: command.trigger_id, // slash commands don't have thread_ts; use trigger_id as fallback
    channelId: command.channel_id,
    say: (args) => say({ text: args.text }),
  });
});

// ── Health check ───────────────────────────────────────────────────────────

// Bun HTTP handler alongside Bolt (only in HTTP mode)
if (!SLACK_APP_TOKEN) {
  const server = Bun.serve({
    port: PORT + 1, // health on PORT+1 to avoid conflict with Bolt's receiver
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
