import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  CloudAdapter,
  ConfigurationServiceClientCredentialFactory,
  createBotFrameworkAuthenticationFromConfiguration,
} from "botbuilder";
import {
  ACTIONS,
  handleIncidentMention,
  handleConfirm,
  handleReject,
  handleInvestigateMore,
} from "@oncall/bot-core";
import { TeamsAdapter } from "./teams-adapter";

// ── Environment ────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3978);
const SERVICE_GRAPH_URL = process.env.SERVICE_GRAPH_URL ?? "http://localhost:3001";

const config = {
  MicrosoftAppId: process.env.MICROSOFT_APP_ID ?? "",
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD ?? "",
  MicrosoftAppType: "MultiTenant",
};

// ── Bot Framework adapter ──────────────────────────────────────────────────

const credentialsFactory = new ConfigurationServiceClientCredentialFactory(config);
const botFrameworkAuth = createBotFrameworkAuthenticationFromConfiguration(null, credentialsFactory);
const cloudAdapter = new CloudAdapter(botFrameworkAuth);

cloudAdapter.onTurnError = async (context, error) => {
  console.error(`[OnCallBot] Unhandled error: ${error.message}`);
  await context.sendActivity("❌ An internal error occurred. Please try again.");
};

// ── TeamsAdapter (BotAdapter) + orchestrator wiring ────────────────────────

const bot = new TeamsAdapter();
const orchOpts = { serviceGraphUrl: SERVICE_GRAPH_URL };

bot.onMention(async (text, ctx) => {
  await handleIncidentMention(text, ctx, bot, orchOpts);
});

bot.onAction(ACTIONS.CONFIRM, async (ctx) => {
  await handleConfirm(ctx, bot);
});

bot.onAction(ACTIONS.REJECT, async (ctx) => {
  await handleReject(ctx, bot);
});

bot.onAction(ACTIONS.INVESTIGATE_MORE, async (ctx) => {
  await handleInvestigateMore(ctx, bot, orchOpts);
});

// ── Express-like shim for CloudAdapter.process() ───────────────────────────

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

function shimRequest(req: IncomingMessage, body: unknown) {
  return {
    method: req.method ?? "GET",
    headers: req.headers as Record<string, string | string[] | undefined>,
    body,
    on: req.on.bind(req),
  };
}

function shimResponse(res: ServerResponse) {
  let statusCode = 200;
  return {
    status(code: number) { statusCode = code; return this; },
    send(body: unknown) {
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(payload);
      return this;
    },
    end() {
      if (!res.writableEnded) { res.writeHead(statusCode); res.end(); }
    },
  };
}

// ── HTTP Server ────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/api/messages" && req.method === "POST") {
    try {
      const body = await readBody(req);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (cloudAdapter as any).process(shimRequest(req, body), shimResponse(res), async (context: any) => {
        await bot.run(context);
      });
    } catch (err) {
      console.error("[OnCallBot] Error processing message:", (err as Error).message);
      if (!res.writableEnded) { res.writeHead(500); res.end("Internal Server Error"); }
    }
  } else if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "teams-bot" }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`⚡ Teams bot running on port ${PORT}`);
  console.log(`   Endpoint: http://localhost:${PORT}/api/messages`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`   App ID: ${config.MicrosoftAppId || "(none — local dev mode)"}`);
  console.log(`   Service graph: ${SERVICE_GRAPH_URL}`);
});
