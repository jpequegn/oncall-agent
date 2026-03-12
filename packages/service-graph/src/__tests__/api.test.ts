import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createHandler } from "../handler";
import { setupTestDb, TEST_DB_URL } from "./setup";

type DbSetup = Awaited<ReturnType<typeof setupTestDb>>;
let setup: DbSetup;
let handle: (req: Request) => Promise<Response>;
let closeHandler: () => Promise<void>;

const BASE = "http://localhost";

function get(path: string) {
  return handle(new Request(`${BASE}${path}`));
}

beforeAll(async () => {
  setup = await setupTestDb();
  const h = createHandler(TEST_DB_URL);
  handle = h.handle;
  closeHandler = h.close;
});

afterAll(async () => {
  await closeHandler();
  await setup.client.end();
});

describe("GET /services", () => {
  it("returns an array of all seeded services", async () => {
    const res = await get("/services");
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string }[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(12);
    const names = body.map((s) => s.name);
    expect(names).toContain("api-gateway");
    expect(names).toContain("payment-service");
    expect(names).toContain("user-db");
  });
});

describe("GET /services/:id/deps", () => {
  it("returns upstream and downstream for payment-service by name", async () => {
    const res = await get("/services/payment-service/deps");
    expect(res.status).toBe(200);
    const body = await res.json() as { upstream: { name: string }[]; downstream: { name: string }[] };
    expect(body).toHaveProperty("upstream");
    expect(body).toHaveProperty("downstream");
    expect(body.upstream.map((s) => s.name)).toContain("api-gateway");
    const downNames = body.downstream.map((s) => s.name).sort();
    expect(downNames).toContain("fraud-service");
    expect(downNames).toContain("payment-db");
  });

  it("returns upstream and downstream for payment-service by UUID", async () => {
    const id = setup.svc.get("payment-service")!.id;
    const res = await get(`/services/${id}/deps`);
    expect(res.status).toBe(200);
    const body = await res.json() as { upstream: unknown[]; downstream: unknown[] };
    expect(body.upstream.length).toBeGreaterThan(0);
  });

  it("returns 404 for unknown service name", async () => {
    const res = await get("/services/unknown-service/deps");
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  it("returns transitive deps with ?depth=3", async () => {
    const res = await get("/services/api-gateway/deps?depth=3");
    expect(res.status).toBe(200);
    const body = await res.json() as { dependencies: { toServiceId: string }[]; depth: number };
    expect(body.depth).toBe(3);
    const ids = body.dependencies.map((d) => d.toServiceId);
    // user-db is at depth 2 from api-gateway
    expect(ids).toContain(setup.svc.get("user-db")!.id);
  });

  it("returns 400 for depth=0", async () => {
    const res = await get("/services/api-gateway/deps?depth=0");
    expect(res.status).toBe(400);
  });

  it("returns 400 for depth=11", async () => {
    const res = await get("/services/api-gateway/deps?depth=11");
    expect(res.status).toBe(400);
  });
});

describe("GET /services/:id/owner", () => {
  it("returns team info for auth-service", async () => {
    const res = await get("/services/auth-service/owner");
    expect(res.status).toBe(200);
    const body = await res.json() as { teamName: string; slackChannel: string };
    expect(body.teamName).toBe("Platform");
    expect(body.slackChannel).toBe("#platform-oncall");
  });

  it("returns 404 for unknown service", async () => {
    const res = await get("/services/no-such-svc/owner");
    expect(res.status).toBe(404);
  });
});

describe("GET /services/:id/impact", () => {
  it("includes api-gateway when querying user-db impact", async () => {
    const res = await get("/services/user-db/impact");
    expect(res.status).toBe(200);
    const body = await res.json() as { impactedServices: { name: string }[] };
    const names = body.impactedServices.map((s) => s.name);
    expect(names).toContain("api-gateway");
    expect(names).toContain("auth-service");
  });

  it("returns empty impactedServices for a root service", async () => {
    const res = await get("/services/api-gateway/impact");
    expect(res.status).toBe(200);
    const body = await res.json() as { impactedServices: unknown[] };
    expect(body.impactedServices).toHaveLength(0);
  });

  it("returns 404 for unknown service", async () => {
    const res = await get("/services/ghost-service/impact");
    expect(res.status).toBe(404);
  });
});

describe("GET /services/:id/deployments", () => {
  it("returns recent deployments for auth-service (default 24h)", async () => {
    const res = await get("/services/auth-service/deployments");
    expect(res.status).toBe(200);
    const body = await res.json() as { deployments: { version: string }[]; hours: number };
    expect(body.hours).toBe(24);
    expect(body.deployments.length).toBeGreaterThanOrEqual(2);
  });

  it("respects custom hours param", async () => {
    const res = await get("/services/auth-service/deployments?hours=1");
    expect(res.status).toBe(200);
    const body = await res.json() as { deployments: { version: string }[] };
    expect(body.deployments).toHaveLength(1);
    expect(body.deployments[0]!.version).toBe("1.2.0");
  });

  it("returns 400 for hours=0", async () => {
    const res = await get("/services/auth-service/deployments?hours=0");
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown service", async () => {
    const res = await get("/services/ghost-svc/deployments");
    expect(res.status).toBe(404);
  });
});

describe("unknown routes", () => {
  it("returns 404 for unrecognised path", async () => {
    const res = await get("/healthz");
    expect(res.status).toBe(404);
  });
});
