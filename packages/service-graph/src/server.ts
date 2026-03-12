import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { services } from "./schema";
import {
  getDirectDependencies,
  getTransitiveDependencies,
  getServiceOwner,
  findImpactRadius,
  getRecentDeployments,
} from "./queries";

const PORT = Number(process.env.PORT ?? 3001);
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/oncall_agent";

// Shared DB client for list queries
const client = postgres(DATABASE_URL);
const db = drizzle(client);

// ── Helpers ────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function notFound(msg = "Not found"): Response {
  return json({ error: msg }, 404);
}

function badRequest(msg: string): Response {
  return json({ error: msg }, 400);
}

/** Resolve a route param that may be a UUID or a service name. */
async function resolveServiceId(idOrName: string): Promise<string | null> {
  // UUID pattern
  if (/^[0-9a-f-]{36}$/i.test(idOrName)) return idOrName;

  const rows = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.name, idOrName));
  return rows[0]?.id ?? null;
}

// ── Request logging ────────────────────────────────────────────────────────

function log(req: Request, status: number, durationMs: number) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${new URL(req.url).pathname} → ${status} (${durationMs}ms)`);
}

// ── Router ─────────────────────────────────────────────────────────────────

async function handle(req: Request): Promise<Response> {
  const start = Date.now();
  const url = new URL(req.url);
  const segments = url.pathname.replace(/^\//, "").split("/");

  let res: Response;

  try {
    // GET /services
    if (req.method === "GET" && segments[0] === "services" && segments.length === 1) {
      const rows = await db.select().from(services);
      res = json(rows);

    // GET /services/:id/deps?depth=N
    } else if (req.method === "GET" && segments[0] === "services" && segments[2] === "deps" && segments.length === 3) {
      const serviceId = await resolveServiceId(segments[1]!);
      if (!serviceId) { res = notFound(`Service '${segments[1]}' not found`); }
      else {
        const depthParam = url.searchParams.get("depth");
        if (depthParam !== null) {
          const depth = parseInt(depthParam, 10);
          if (isNaN(depth) || depth < 1 || depth > 10) {
            res = badRequest("depth must be an integer between 1 and 10");
          } else {
            const deps = await getTransitiveDependencies(serviceId, depth, DATABASE_URL);
            res = json({ serviceId, depth, dependencies: deps });
          }
        } else {
          const deps = await getDirectDependencies(serviceId, DATABASE_URL);
          res = json({ serviceId, ...deps });
        }
      }

    // GET /services/:id/owner
    } else if (req.method === "GET" && segments[0] === "services" && segments[2] === "owner" && segments.length === 3) {
      const serviceId = await resolveServiceId(segments[1]!);
      if (!serviceId) { res = notFound(`Service '${segments[1]}' not found`); }
      else {
        const owner = await getServiceOwner(serviceId, DATABASE_URL);
        if (!owner) res = notFound("No owner found for this service");
        else res = json(owner);
      }

    // GET /services/:id/impact
    } else if (req.method === "GET" && segments[0] === "services" && segments[2] === "impact" && segments.length === 3) {
      const serviceId = await resolveServiceId(segments[1]!);
      if (!serviceId) { res = notFound(`Service '${segments[1]}' not found`); }
      else {
        const impacted = await findImpactRadius(serviceId, DATABASE_URL);
        res = json({ serviceId, impactedServices: impacted });
      }

    // GET /services/:id/deployments?hours=N
    } else if (req.method === "GET" && segments[0] === "services" && segments[2] === "deployments" && segments.length === 3) {
      const serviceId = await resolveServiceId(segments[1]!);
      if (!serviceId) { res = notFound(`Service '${segments[1]}' not found`); }
      else {
        const hoursParam = url.searchParams.get("hours") ?? "24";
        const hours = parseInt(hoursParam, 10);
        if (isNaN(hours) || hours < 1 || hours > 720) {
          res = badRequest("hours must be an integer between 1 and 720");
        } else {
          const deploys = await getRecentDeployments(serviceId, hours, DATABASE_URL);
          res = json({ serviceId, hours, deployments: deploys });
        }
      }

    } else {
      res = notFound("Route not found");
    }
  } catch (err) {
    console.error("Unhandled error:", err);
    res = json({ error: "Internal server error" }, 500);
  }

  log(req, res.status, Date.now() - start);
  return res;
}

// ── Start ──────────────────────────────────────────────────────────────────

const server = Bun.serve({ port: PORT, fetch: handle });
console.log(`🚀 service-graph API listening on http://localhost:${server.port}`);
