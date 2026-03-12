import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").unique().notNull(),
    tier: integer("tier"),
    language: text("language"),
    repoUrl: text("repo_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [check("tier_check", sql`${table.tier} IN (1, 2, 3)`)]
);

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").unique().notNull(),
  slackChannel: text("slack_channel"),
  oncallRotation: text("oncall_rotation"),
});

export const serviceOwnership = pgTable(
  "service_ownership",
  {
    serviceId: uuid("service_id").references(() => services.id),
    teamId: uuid("team_id").references(() => teams.id),
  },
  (table) => [primaryKey({ columns: [table.serviceId, table.teamId] })]
);

export const serviceDependencies = pgTable(
  "service_dependencies",
  {
    fromServiceId: uuid("from_service_id").references(() => services.id),
    toServiceId: uuid("to_service_id").references(() => services.id),
    dependencyType: text("dependency_type").default("sync"),
  },
  (table) => [
    primaryKey({ columns: [table.fromServiceId, table.toServiceId] }),
  ]
);

export const runbooks = pgTable("runbooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  url: text("url"),
  tags: text("tags").array(),
  content: text("content"),
});

export const serviceRunbooks = pgTable(
  "service_runbooks",
  {
    serviceId: uuid("service_id").references(() => services.id),
    runbookId: uuid("runbook_id").references(() => runbooks.id),
  },
  (table) => [primaryKey({ columns: [table.serviceId, table.runbookId] })]
);

export const deployments = pgTable("deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").references(() => services.id),
  version: text("version"),
  commitSha: text("commit_sha"),
  deployedAt: timestamp("deployed_at", { withTimezone: true }).defaultNow(),
  deployer: text("deployer"),
});

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    severity: text("severity"),
    rootCause: text("root_cause"),
    resolution: text("resolution"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "severity_check",
      sql`${table.severity} IN ('P1', 'P2', 'P3', 'P4')`
    ),
  ]
);

export const incidentServices = pgTable(
  "incident_services",
  {
    incidentId: uuid("incident_id").references(() => incidents.id),
    serviceId: uuid("service_id").references(() => services.id),
  },
  (table) => [primaryKey({ columns: [table.incidentId, table.serviceId] })]
);
