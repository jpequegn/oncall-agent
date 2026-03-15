import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  CloudAdapter,
  ConfigurationServiceClientCredentialFactory,
  createBotFrameworkAuthenticationFromConfiguration,
} from "botbuilder";
import { OnCallBot } from "./bot";

// ── Environment ────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3978);

const config = {
  MicrosoftAppId: process.env.MICROSOFT_APP_ID ?? "",
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD ?? "",
  MicrosoftAppType: "MultiTenant",
};

// ── Adapter ────────────────────────────────────────────────────────────────

const credentialsFactory = new ConfigurationServiceClientCredentialFactory(config);
const botFrameworkAuth = createBotFrameworkAuthenticationFromConfiguration(null, credentialsFactory);
const adapter = new CloudAdapter(botFrameworkAuth);

adapter.onTurnError = async (context, error) => {
  console.error(`[OnCallBot] Unhandled error: ${error.message}`);
  await context.sendActivity("❌ An internal error occurred. Please try again.");
};

// ── Bot ────────────────────────────────────────────────────────────────────

const bot = new OnCallBot();

// ── Express-like shim for CloudAdapter.process() ───────────────────────────

interface AdapterRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
}

interface AdapterResponse {
  status: (code: number) => AdapterResponse;
  send: (body: unknown) => AdapterResponse;
  end: () => void;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function shimRequest(req: IncomingMessage, body: unknown): AdapterRequest {
  return {
    method: req.method ?? "GET",
    headers: req.headers as Record<string, string | string[] | undefined>,
    body,
    on: req.on.bind(req),
  };
}

function shimResponse(res: ServerResponse): AdapterResponse {
  let statusCode = 200;
  return {
    status(code: number) {
      statusCode = code;
      return this;
    },
    send(body: unknown) {
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(payload);
      return this;
    },
    end() {
      if (!res.writableEnded) {
        res.writeHead(statusCode);
        res.end();
      }
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
      await (adapter as any).process(shimRequest(req, body), shimResponse(res), async (context: any) => {
        await bot.run(context);
      });
    } catch (err) {
      console.error("[OnCallBot] Error processing message:", (err as Error).message);
      if (!res.writableEnded) {
        res.writeHead(500);
        res.end("Internal Server Error");
      }
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
});
