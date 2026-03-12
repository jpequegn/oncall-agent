/**
 * Shared test DB setup: migrate + seed a minimal topology, return service/team id maps.
 * Each test file calls this once in beforeAll and tears down in afterAll.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import {
  services,
  teams,
  serviceOwnership,
  serviceDependencies,
  deployments,
} from "../schema";

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/oncall_agent";

export const MIGRATIONS_DIR = path.join(import.meta.dir, "../../migrations");

export async function setupTestDb() {
  const client = postgres(TEST_DB_URL);
  const db = drizzle(client);

  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  // Truncate in FK-safe order
  await client`
    TRUNCATE deployments, incident_services, incidents,
             service_runbooks, runbooks, service_dependencies,
             service_ownership, services, teams
    RESTART IDENTITY CASCADE
  `;

  // Teams
  const [platformTeam] = await db
    .insert(teams)
    .values({ name: "Platform", slackChannel: "#platform-oncall", oncallRotation: "platform-rota" })
    .returning();
  const [paymentsTeam] = await db
    .insert(teams)
    .values({ name: "Payments", slackChannel: "#payments-oncall", oncallRotation: "payments-rota" })
    .returning();

  // Services — mirrors the issue spec topology
  const svcRows = await db
    .insert(services)
    .values([
      { name: "api-gateway",       tier: 1, language: "Go" },
      { name: "auth-service",      tier: 1, language: "Go" },
      { name: "payment-service",   tier: 1, language: "Java" },
      { name: "order-service",     tier: 1, language: "Java" },
      { name: "inventory-service", tier: 2, language: "Python" },
      { name: "fraud-service",     tier: 2, language: "Python" },
      { name: "user-db",           tier: 3, language: null },
      { name: "payment-db",        tier: 3, language: null },
      { name: "order-db",          tier: 3, language: null },
      { name: "inventory-db",      tier: 3, language: null },
      { name: "redis-cache",       tier: 3, language: null },
      { name: "fraud-model-svc",   tier: 3, language: "Python" },
    ])
    .returning();

  const svc = new Map(svcRows.map((s) => [s.name, s]));

  // Ownership
  await db.insert(serviceOwnership).values([
    { serviceId: svc.get("api-gateway")!.id,       teamId: platformTeam!.id },
    { serviceId: svc.get("auth-service")!.id,      teamId: platformTeam!.id },
    { serviceId: svc.get("user-db")!.id,           teamId: platformTeam!.id },
    { serviceId: svc.get("redis-cache")!.id,       teamId: platformTeam!.id },
    { serviceId: svc.get("payment-service")!.id,   teamId: paymentsTeam!.id },
    { serviceId: svc.get("payment-db")!.id,        teamId: paymentsTeam!.id },
    { serviceId: svc.get("fraud-service")!.id,     teamId: paymentsTeam!.id },
    { serviceId: svc.get("fraud-model-svc")!.id,   teamId: paymentsTeam!.id },
    { serviceId: svc.get("order-service")!.id,     teamId: platformTeam!.id },
    { serviceId: svc.get("order-db")!.id,          teamId: platformTeam!.id },
    { serviceId: svc.get("inventory-service")!.id, teamId: platformTeam!.id },
    { serviceId: svc.get("inventory-db")!.id,      teamId: platformTeam!.id },
  ]);

  // Dependencies
  await db.insert(serviceDependencies).values([
    { fromServiceId: svc.get("api-gateway")!.id,     toServiceId: svc.get("auth-service")!.id,    dependencyType: "sync" },
    { fromServiceId: svc.get("api-gateway")!.id,     toServiceId: svc.get("payment-service")!.id, dependencyType: "sync" },
    { fromServiceId: svc.get("api-gateway")!.id,     toServiceId: svc.get("order-service")!.id,   dependencyType: "sync" },
    { fromServiceId: svc.get("auth-service")!.id,    toServiceId: svc.get("user-db")!.id,         dependencyType: "storage" },
    { fromServiceId: svc.get("auth-service")!.id,    toServiceId: svc.get("redis-cache")!.id,     dependencyType: "storage" },
    { fromServiceId: svc.get("payment-service")!.id, toServiceId: svc.get("payment-db")!.id,      dependencyType: "storage" },
    { fromServiceId: svc.get("payment-service")!.id, toServiceId: svc.get("fraud-service")!.id,   dependencyType: "sync" },
    { fromServiceId: svc.get("order-service")!.id,   toServiceId: svc.get("order-db")!.id,        dependencyType: "storage" },
    { fromServiceId: svc.get("order-service")!.id,   toServiceId: svc.get("inventory-service")!.id, dependencyType: "sync" },
    { fromServiceId: svc.get("inventory-service")!.id, toServiceId: svc.get("inventory-db")!.id,  dependencyType: "storage" },
    { fromServiceId: svc.get("fraud-service")!.id,   toServiceId: svc.get("fraud-model-svc")!.id, dependencyType: "sync" },
    { fromServiceId: svc.get("fraud-service")!.id,   toServiceId: svc.get("user-db")!.id,         dependencyType: "storage" },
  ]);

  // Deployments for auth-service: 2 recent, 1 old
  const now = Date.now();
  await db.insert(deployments).values([
    { serviceId: svc.get("auth-service")!.id,    version: "1.2.0", commitSha: "abc123", deployedAt: new Date(now - 1 * 3600_000),  deployer: "alice" },
    { serviceId: svc.get("auth-service")!.id,    version: "1.1.9", commitSha: "def456", deployedAt: new Date(now - 6 * 3600_000),  deployer: "bob" },
    { serviceId: svc.get("auth-service")!.id,    version: "1.1.8", commitSha: "ghi789", deployedAt: new Date(now - 50 * 3600_000), deployer: "ci" },
    { serviceId: svc.get("payment-service")!.id, version: "2.0.1", commitSha: "jkl012", deployedAt: new Date(now - 3 * 3600_000),  deployer: "charlie" },
  ]);

  return { client, db, svc, platformTeam: platformTeam!, paymentsTeam: paymentsTeam! };
}
