import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import path from "path";
import {
  services,
  teams,
  serviceOwnership,
  serviceDependencies,
  deployments,
} from "./schema";
import {
  getDirectDependencies,
  getTransitiveDependencies,
  getServiceOwner,
  findImpactRadius,
  getRecentDeployments,
} from "./queries";

// Use a separate test DB via env or fall back to default
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/oncall_agent";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

// IDs populated during setup
let userDbId: string;
let authServiceId: string;
let paymentServiceId: string;
let platformTeamId: string;

beforeAll(async () => {
  client = postgres(TEST_DB_URL);
  db = drizzle(client);

  await migrate(db, {
    migrationsFolder: path.join(import.meta.dir, "../migrations"),
  });

  // Clean slate for test tables (order matters due to FK)
  await db.execute(
    // @ts-ignore — raw sql for truncation
    `TRUNCATE deployments, incident_services, incidents, service_runbooks, runbooks, service_dependencies, service_ownership, services, teams RESTART IDENTITY CASCADE`
  );

  // Seed minimal test data
  const [teamRow] = await db
    .insert(teams)
    .values({ name: "Platform", slackChannel: "#platform-oncall", oncallRotation: "platform-rota" })
    .returning();
  platformTeamId = teamRow!.id;

  const svcRows = await db
    .insert(services)
    .values([
      { name: "user-db",         tier: 3, language: null },
      { name: "auth-service",    tier: 1, language: "Go" },
      { name: "api-gateway",     tier: 1, language: "Go" },
      { name: "payment-service", tier: 1, language: "Java" },
      { name: "order-service",   tier: 1, language: "Java" },
    ])
    .returning();

  const byName = new Map(svcRows.map((s) => [s.name, s.id]));
  userDbId        = byName.get("user-db")!;
  authServiceId   = byName.get("auth-service")!;
  paymentServiceId = byName.get("payment-service")!;
  const apiGwId   = byName.get("api-gateway")!;
  const orderId   = byName.get("order-service")!;

  // Ownership: Platform owns everything
  await db.insert(serviceOwnership).values(
    svcRows.map((s) => ({ serviceId: s.id, teamId: platformTeamId }))
  );

  // Dependencies: api-gateway → auth-service → user-db
  //               api-gateway → payment-service
  //               api-gateway → order-service
  await db.insert(serviceDependencies).values([
    { fromServiceId: apiGwId,        toServiceId: authServiceId,   dependencyType: "sync" },
    { fromServiceId: apiGwId,        toServiceId: paymentServiceId, dependencyType: "sync" },
    { fromServiceId: apiGwId,        toServiceId: orderId,          dependencyType: "sync" },
    { fromServiceId: authServiceId,  toServiceId: userDbId,         dependencyType: "storage" },
    { fromServiceId: paymentServiceId, toServiceId: userDbId,       dependencyType: "storage" },
  ]);

  // Deployments: 2 for auth-service in last 24h, 1 older
  const now = Date.now();
  await db.insert(deployments).values([
    { serviceId: authServiceId, version: "1.2.0", commitSha: "abc123", deployedAt: new Date(now - 3_600_000),  deployer: "alice" },
    { serviceId: authServiceId, version: "1.1.9", commitSha: "def456", deployedAt: new Date(now - 7_200_000),  deployer: "bob" },
    { serviceId: authServiceId, version: "1.1.8", commitSha: "ghi789", deployedAt: new Date(now - 50_000_000), deployer: "ci" },
  ]);
});

afterAll(async () => {
  await client.end();
});

describe("getDirectDependencies", () => {
  it("returns downstream services for api-gateway", async () => {
    const apiGw = await db.select().from(services).where(eq(services.name, "api-gateway"));
    const { downstream, upstream } = await getDirectDependencies(apiGw[0]!.id, TEST_DB_URL);
    const names = downstream.map((s) => s.name).sort();
    expect(names).toContain("auth-service");
    expect(names).toContain("payment-service");
    expect(names).toContain("order-service");
    expect(upstream).toHaveLength(0); // nothing calls api-gateway
  });

  it("returns upstream services for auth-service", async () => {
    const { upstream, downstream } = await getDirectDependencies(authServiceId, TEST_DB_URL);
    expect(upstream.map((s) => s.name)).toContain("api-gateway");
    expect(downstream.map((s) => s.name)).toContain("user-db");
  });
});

describe("getTransitiveDependencies", () => {
  it("returns multi-level deps for api-gateway at depth 3", async () => {
    const apiGw = await db.select().from(services).where(eq(services.name, "api-gateway"));
    const deps = await getTransitiveDependencies(apiGw[0]!.id, 3, TEST_DB_URL);
    const toIds = deps.map((d) => d.toServiceId);
    // depth 1: auth-service, payment-service, order-service
    // depth 2: user-db (via auth and payment)
    expect(toIds).toContain(authServiceId);
    expect(toIds).toContain(paymentServiceId);
    expect(toIds).toContain(userDbId);
  });

  it("respects depth limit", async () => {
    const apiGw = await db.select().from(services).where(eq(services.name, "api-gateway"));
    const deps = await getTransitiveDependencies(apiGw[0]!.id, 1, TEST_DB_URL);
    expect(deps.every((d) => d.depth === 1)).toBe(true);
    // user-db is at depth 2, should not appear
    expect(deps.map((d) => d.toServiceId)).not.toContain(userDbId);
  });
});

describe("getServiceOwner", () => {
  it("returns team info for auth-service", async () => {
    const owner = await getServiceOwner(authServiceId, TEST_DB_URL);
    expect(owner).not.toBeNull();
    expect(owner!.teamName).toBe("Platform");
    expect(owner!.slackChannel).toBe("#platform-oncall");
    expect(owner!.oncallRotation).toBe("platform-rota");
  });

  it("returns null for unknown service id", async () => {
    const owner = await getServiceOwner("00000000-0000-0000-0000-000000000000", TEST_DB_URL);
    expect(owner).toBeNull();
  });
});

describe("findImpactRadius", () => {
  it("returns all services that depend on user-db", async () => {
    const impacted = await findImpactRadius(userDbId, TEST_DB_URL);
    const names = impacted.map((s) => s.name);
    // auth-service and payment-service directly depend on user-db
    expect(names).toContain("auth-service");
    expect(names).toContain("payment-service");
    // api-gateway transitively depends on user-db
    expect(names).toContain("api-gateway");
  });

  it("returns empty for a service no one depends on", async () => {
    const apiGw = await db.select().from(services).where(eq(services.name, "api-gateway"));
    const impacted = await findImpactRadius(apiGw[0]!.id, TEST_DB_URL);
    expect(impacted).toHaveLength(0);
  });
});

describe("getRecentDeployments", () => {
  it("returns deployments within the last 24 hours", async () => {
    const recent = await getRecentDeployments(authServiceId, 24, TEST_DB_URL);
    expect(recent).toHaveLength(2);
    expect(recent.map((d) => d.version)).toContain("1.2.0");
    expect(recent.map((d) => d.version)).toContain("1.1.9");
  });

  it("excludes deployments older than the window", async () => {
    const recent = await getRecentDeployments(authServiceId, 1, TEST_DB_URL);
    // only the 1h-old deployment should be included
    expect(recent).toHaveLength(1);
    expect(recent[0]!.version).toBe("1.2.0");
  });

  it("returns empty for service with no recent deployments", async () => {
    const recent = await getRecentDeployments(userDbId, 24, TEST_DB_URL);
    expect(recent).toHaveLength(0);
  });
});
