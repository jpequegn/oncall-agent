import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type postgres from "postgres";
import type { drizzle } from "drizzle-orm/postgres-js";
import {
  getDirectDependencies,
  getTransitiveDependencies,
  getServiceOwner,
  findImpactRadius,
  getRecentDeployments,
} from "../queries";
import { setupTestDb, TEST_DB_URL } from "./setup";

type DbSetup = Awaited<ReturnType<typeof setupTestDb>>;
let setup: DbSetup;

beforeAll(async () => {
  setup = await setupTestDb();
});

afterAll(async () => {
  await setup.client.end();
});

describe("getDirectDependencies", () => {
  it("returns correct downstream services for api-gateway", async () => {
    const { downstream, upstream } = await getDirectDependencies(
      setup.svc.get("api-gateway")!.id,
      TEST_DB_URL
    );
    const names = downstream.map((s) => s.name).sort();
    expect(names).toEqual(["auth-service", "order-service", "payment-service"]);
    expect(upstream).toHaveLength(0);
  });

  it("returns correct upstream and downstream for auth-service", async () => {
    const { upstream, downstream } = await getDirectDependencies(
      setup.svc.get("auth-service")!.id,
      TEST_DB_URL
    );
    expect(upstream.map((s) => s.name)).toContain("api-gateway");
    const downNames = downstream.map((s) => s.name).sort();
    expect(downNames).toEqual(["redis-cache", "user-db"]);
  });

  it("returns empty upstream and downstream for an isolated leaf node", async () => {
    // inventory-db has no upstream callers and no outgoing deps
    const { upstream, downstream } = await getDirectDependencies(
      setup.svc.get("inventory-db")!.id,
      TEST_DB_URL
    );
    expect(upstream.map((s) => s.name)).toContain("inventory-service");
    expect(downstream).toHaveLength(0);
  });
});

describe("getTransitiveDependencies", () => {
  it("depth=1 matches direct downstream deps", async () => {
    const apiGwId = setup.svc.get("api-gateway")!.id;
    const direct = await getDirectDependencies(apiGwId, TEST_DB_URL);
    const transitive = await getTransitiveDependencies(apiGwId, 1, TEST_DB_URL);

    const directIds = direct.downstream.map((s) => s.id).sort();
    const transitiveIds = [...new Set(transitive.map((d) => d.toServiceId))].sort();
    expect(transitiveIds).toEqual(directIds);
  });

  it("depth=3 includes multi-hop dependencies", async () => {
    const apiGwId = setup.svc.get("api-gateway")!.id;
    const deps = await getTransitiveDependencies(apiGwId, 3, TEST_DB_URL);
    const toIds = deps.map((d) => d.toServiceId);

    // depth 1: auth-service, payment-service, order-service
    expect(toIds).toContain(setup.svc.get("auth-service")!.id);
    expect(toIds).toContain(setup.svc.get("payment-service")!.id);
    // depth 2: user-db (via auth), fraud-service (via payment)
    expect(toIds).toContain(setup.svc.get("user-db")!.id);
    expect(toIds).toContain(setup.svc.get("fraud-service")!.id);
    // depth 3: fraud-model-svc (via payment→fraud)
    expect(toIds).toContain(setup.svc.get("fraud-model-svc")!.id);
  });

  it("strictly respects depth limit", async () => {
    const apiGwId = setup.svc.get("api-gateway")!.id;
    const deps = await getTransitiveDependencies(apiGwId, 1, TEST_DB_URL);
    // All entries must be at depth 1
    expect(deps.every((d) => d.depth === 1)).toBe(true);
    // user-db is at depth 2 — must not appear
    expect(deps.map((d) => d.toServiceId)).not.toContain(
      setup.svc.get("user-db")!.id
    );
  });

  it("returns empty array for a leaf service with no outgoing deps", async () => {
    const deps = await getTransitiveDependencies(
      setup.svc.get("user-db")!.id,
      3,
      TEST_DB_URL
    );
    expect(deps).toHaveLength(0);
  });
});

describe("getServiceOwner", () => {
  it("returns team info for auth-service (Platform)", async () => {
    const owner = await getServiceOwner(
      setup.svc.get("auth-service")!.id,
      TEST_DB_URL
    );
    expect(owner).not.toBeNull();
    expect(owner!.teamName).toBe("Platform");
    expect(owner!.slackChannel).toBe("#platform-oncall");
    expect(owner!.oncallRotation).toBe("platform-rota");
  });

  it("returns team info for payment-service (Payments)", async () => {
    const owner = await getServiceOwner(
      setup.svc.get("payment-service")!.id,
      TEST_DB_URL
    );
    expect(owner!.teamName).toBe("Payments");
    expect(owner!.slackChannel).toBe("#payments-oncall");
  });

  it("returns null for an unknown UUID", async () => {
    const owner = await getServiceOwner(
      "00000000-0000-0000-0000-000000000000",
      TEST_DB_URL
    );
    expect(owner).toBeNull();
  });
});

describe("findImpactRadius", () => {
  it("returns direct and transitive dependents of user-db", async () => {
    const impacted = await findImpactRadius(
      setup.svc.get("user-db")!.id,
      TEST_DB_URL
    );
    const names = impacted.map((s) => s.name);
    // auth-service and fraud-service depend directly on user-db
    expect(names).toContain("auth-service");
    expect(names).toContain("fraud-service");
    // api-gateway and payment-service depend transitively
    expect(names).toContain("api-gateway");
    expect(names).toContain("payment-service");
  });

  it("returns empty array for a root service with no callers", async () => {
    const impacted = await findImpactRadius(
      setup.svc.get("api-gateway")!.id,
      TEST_DB_URL
    );
    expect(impacted).toHaveLength(0);
  });

  it("does not include the queried service itself", async () => {
    const userDbId = setup.svc.get("user-db")!.id;
    const impacted = await findImpactRadius(userDbId, TEST_DB_URL);
    expect(impacted.map((s) => s.id)).not.toContain(userDbId);
  });
});

describe("getRecentDeployments", () => {
  it("returns both deployments for auth-service within 24 hours", async () => {
    const result = await getRecentDeployments(
      setup.svc.get("auth-service")!.id,
      24,
      TEST_DB_URL
    );
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.version)).toContain("1.2.0");
    expect(result.map((d) => d.version)).toContain("1.1.9");
  });

  it("1-hour window returns only the most recent deploy", async () => {
    const result = await getRecentDeployments(
      setup.svc.get("auth-service")!.id,
      1,
      TEST_DB_URL
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.version).toBe("1.2.0");
  });

  it("excludes deployments older than the time window", async () => {
    // 1.1.8 was deployed 50h ago — shouldn't appear even in 48h window
    const result = await getRecentDeployments(
      setup.svc.get("auth-service")!.id,
      48,
      TEST_DB_URL
    );
    expect(result.map((d) => d.version)).not.toContain("1.1.8");
  });

  it("returns empty for a service with no deployments", async () => {
    const result = await getRecentDeployments(
      setup.svc.get("user-db")!.id,
      24,
      TEST_DB_URL
    );
    expect(result).toHaveLength(0);
  });
});
