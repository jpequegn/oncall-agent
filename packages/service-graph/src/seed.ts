import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import {
  services,
  teams,
  serviceOwnership,
  serviceDependencies,
  runbooks,
  serviceRunbooks,
  deployments,
  incidents,
  incidentServices,
} from "./schema";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/oncall_agent";

const client = postgres(DATABASE_URL);
const db = drizzle(client);

// ── Teams ──────────────────────────────────────────────────────────────────

const TEAMS = [
  { name: "Platform", slackChannel: "#platform-oncall", oncallRotation: "platform-rotation" },
  { name: "Payments", slackChannel: "#payments-oncall", oncallRotation: "payments-rotation" },
  { name: "Commerce", slackChannel: "#commerce-oncall", oncallRotation: "commerce-rotation" },
];

// ── Services ───────────────────────────────────────────────────────────────

const SERVICES = [
  { name: "api-gateway",          tier: 1, language: "Go",     repoUrl: "https://github.com/example/api-gateway" },
  { name: "auth-service",         tier: 1, language: "Go",     repoUrl: "https://github.com/example/auth-service" },
  { name: "payment-service",      tier: 1, language: "Java",   repoUrl: "https://github.com/example/payment-service" },
  { name: "order-service",        tier: 1, language: "Java",   repoUrl: "https://github.com/example/order-service" },
  { name: "inventory-service",    tier: 2, language: "Python", repoUrl: "https://github.com/example/inventory-service" },
  { name: "fraud-service",        tier: 2, language: "Python", repoUrl: "https://github.com/example/fraud-service" },
  { name: "notification-service", tier: 2, language: "Node",   repoUrl: "https://github.com/example/notification-service" },
  { name: "fraud-model-service",  tier: 3, language: "Python", repoUrl: "https://github.com/example/fraud-model-service" },
  { name: "user-db",              tier: 3, language: null,     repoUrl: null },
  { name: "payment-db",           tier: 3, language: null,     repoUrl: null },
  { name: "order-db",             tier: 3, language: null,     repoUrl: null },
  { name: "inventory-db",         tier: 3, language: null,     repoUrl: null },
  { name: "redis-cache",          tier: 3, language: null,     repoUrl: null },
  { name: "ml-feature-store",     tier: 3, language: "Python", repoUrl: "https://github.com/example/ml-feature-store" },
  { name: "email-service",        tier: 3, language: "Node",   repoUrl: "https://github.com/example/email-service" },
  { name: "sms-service",          tier: 3, language: "Node",   repoUrl: "https://github.com/example/sms-service" },
] as const;

// from → to dependencies
const DEPENDENCIES: [string, string, "sync" | "async" | "storage"][] = [
  ["api-gateway",          "auth-service",         "sync"],
  ["api-gateway",          "payment-service",      "sync"],
  ["api-gateway",          "order-service",        "sync"],
  ["auth-service",         "user-db",              "storage"],
  ["auth-service",         "redis-cache",          "storage"],
  ["payment-service",      "payment-db",           "storage"],
  ["payment-service",      "fraud-service",        "sync"],
  ["payment-service",      "notification-service", "async"],
  ["order-service",        "order-db",             "storage"],
  ["order-service",        "inventory-service",    "sync"],
  ["order-service",        "notification-service", "async"],
  ["inventory-service",    "inventory-db",         "storage"],
  ["fraud-service",        "fraud-model-service",  "sync"],
  ["fraud-service",        "user-db",              "storage"],
  ["notification-service", "email-service",        "async"],
  ["notification-service", "sms-service",          "async"],
  ["fraud-model-service",  "ml-feature-store",     "storage"],
];

// ── Runbooks ───────────────────────────────────────────────────────────────

const RUNBOOKS = [
  {
    title: "Null Pointer Exception Triage",
    url: "https://wiki.example.com/runbooks/null-pointer",
    tags: ["error", "java", "go"],
    content: "1. Check recent deployments\n2. Search logs for NPE stack traces\n3. Identify affected service version\n4. Roll back if needed",
  },
  {
    title: "Memory Leak Investigation",
    url: "https://wiki.example.com/runbooks/memory-leak",
    tags: ["memory", "performance", "heap"],
    content: "1. Check heap metrics in Grafana\n2. Take heap dump\n3. Analyze with MemoryAnalyzer\n4. Identify leak source\n5. Deploy fix or restart pod",
  },
  {
    title: "Connection Pool Exhaustion",
    url: "https://wiki.example.com/runbooks/connection-pool",
    tags: ["database", "connections", "performance"],
    content: "1. Check active connections: SELECT count(*) FROM pg_stat_activity\n2. Kill long-running queries\n3. Increase pool size if needed\n4. Check for connection leaks in code",
  },
  {
    title: "Slow Query Remediation",
    url: "https://wiki.example.com/runbooks/slow-query",
    tags: ["database", "performance", "query"],
    content: "1. Enable pg_stat_statements\n2. Find top slow queries\n3. Run EXPLAIN ANALYZE\n4. Add missing indexes\n5. Optimize query plan",
  },
  {
    title: "Emergency Deploy Rollback",
    url: "https://wiki.example.com/runbooks/rollback",
    tags: ["deployment", "rollback", "emergency"],
    content: "1. Identify bad deployment\n2. kubectl rollout undo deployment/<name>\n3. Verify pods are healthy\n4. Notify stakeholders\n5. Post incident review",
  },
];

// ── Incidents ──────────────────────────────────────────────────────────────

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3600_000);
}

const INCIDENTS: {
  title: string;
  severity: "P1" | "P2" | "P3" | "P4";
  rootCause: string;
  resolution: string;
  occurredAt: Date;
  resolvedAt: Date;
  serviceNames: string[];
}[] = [
  {
    title: "api-gateway 5xx spike — payment checkout failing",
    severity: "P1",
    rootCause: "payment-db connection pool exhausted after traffic surge",
    resolution: "Increased pool size from 20 to 50, added read replica",
    occurredAt: hoursAgo(48),
    resolvedAt: hoursAgo(46),
    serviceNames: ["api-gateway", "payment-service", "payment-db"],
  },
  {
    title: "auth-service OOMKilled — login unavailable",
    severity: "P1",
    rootCause: "Memory leak in JWT validation library v2.3.1",
    resolution: "Rolled back to v2.2.9, increased pod memory limit",
    occurredAt: hoursAgo(72),
    resolvedAt: hoursAgo(70),
    serviceNames: ["auth-service"],
  },
  {
    title: "fraud-model-service latency p99 > 10s",
    severity: "P2",
    rootCause: "ml-feature-store slow query missing index on feature_name",
    resolution: "Added composite index, query latency dropped to 50ms",
    occurredAt: hoursAgo(96),
    resolvedAt: hoursAgo(94),
    serviceNames: ["fraud-model-service", "ml-feature-store", "fraud-service"],
  },
  {
    title: "notification-service email delivery failure",
    severity: "P2",
    rootCause: "email-service rate limited by SendGrid after marketing blast",
    resolution: "Implemented exponential backoff retry, upgraded SendGrid plan",
    occurredAt: hoursAgo(120),
    resolvedAt: hoursAgo(118),
    serviceNames: ["notification-service", "email-service"],
  },
  {
    title: "inventory-service returning stale stock counts",
    severity: "P3",
    rootCause: "Redis cache TTL set too high (1hr), inventory-db writes not invalidating cache",
    resolution: "Reduced TTL to 5min, added cache invalidation on write",
    occurredAt: hoursAgo(144),
    resolvedAt: hoursAgo(142),
    serviceNames: ["inventory-service", "inventory-db", "redis-cache"],
  },
  {
    title: "order-service deadlock on high-traffic flash sale",
    severity: "P2",
    rootCause: "Concurrent writes to orders table causing row-level deadlocks",
    resolution: "Added SELECT FOR UPDATE SKIP LOCKED pattern, added retry logic",
    occurredAt: hoursAgo(168),
    resolvedAt: hoursAgo(166),
    serviceNames: ["order-service", "order-db"],
  },
  {
    title: "sms-service NPE causing notification drops",
    severity: "P3",
    rootCause: "Null phone number field not validated before Twilio API call",
    resolution: "Added null check, deployed v1.4.2 with input validation",
    occurredAt: hoursAgo(200),
    resolvedAt: hoursAgo(199),
    serviceNames: ["sms-service", "notification-service"],
  },
  {
    title: "api-gateway certificate expiry — HTTPS broken",
    severity: "P1",
    rootCause: "TLS certificate expired, auto-renewal cron job failed silently",
    resolution: "Manually renewed cert, fixed cron job, added alerting",
    occurredAt: hoursAgo(240),
    resolvedAt: hoursAgo(239),
    serviceNames: ["api-gateway"],
  },
  {
    title: "payment-service duplicate charge bug",
    severity: "P2",
    rootCause: "Idempotency key not enforced on retry — payment-db constraint missing",
    resolution: "Added UNIQUE constraint on idempotency_key, refunded affected customers",
    occurredAt: hoursAgo(300),
    resolvedAt: hoursAgo(298),
    serviceNames: ["payment-service", "payment-db"],
  },
  {
    title: "fraud-service false positive surge blocking legit payments",
    severity: "P2",
    rootCause: "Model retrain introduced bias toward new geographic region",
    resolution: "Rolled back model to previous version, triggered retraining with corrected data",
    occurredAt: hoursAgo(360),
    resolvedAt: hoursAgo(356),
    serviceNames: ["fraud-service", "fraud-model-service"],
  },
];

// ── Deployers & versions ───────────────────────────────────────────────────

const DEPLOYERS = ["alice", "bob", "charlie", "dave", "eve", "ci-system"];

function randomSha(): string {
  return Math.random().toString(16).slice(2, 10);
}

function randomVersion(minor: number): string {
  return `1.${minor}.${Math.floor(Math.random() * 10)}`;
}

// ── Main seed ──────────────────────────────────────────────────────────────

async function seed() {
  console.log("🌱 Seeding database...");

  // Teams (upsert by name)
  console.log("  → teams");
  const teamRows = await Promise.all(
    TEAMS.map((t) =>
      db
        .insert(teams)
        .values(t)
        .onConflictDoUpdate({ target: teams.name, set: { slackChannel: t.slackChannel } })
        .returning()
    )
  );
  const teamMap = new Map(teamRows.flat().map((r) => [r.name, r.id]));

  // Services (upsert by name)
  console.log("  → services");
  const serviceRows = await Promise.all(
    SERVICES.map((s) =>
      db
        .insert(services)
        .values(s)
        .onConflictDoUpdate({ target: services.name, set: { tier: s.tier } })
        .returning()
    )
  );
  const serviceMap = new Map(serviceRows.flat().map((r) => [r.name, r.id]));

  // Service ownership
  console.log("  → service_ownership");
  const ownershipData: { serviceName: string; teamName: string }[] = [
    { serviceName: "api-gateway",          teamName: "Platform" },
    { serviceName: "auth-service",         teamName: "Platform" },
    { serviceName: "redis-cache",          teamName: "Platform" },
    { serviceName: "user-db",              teamName: "Platform" },
    { serviceName: "payment-service",      teamName: "Payments" },
    { serviceName: "payment-db",           teamName: "Payments" },
    { serviceName: "fraud-service",        teamName: "Payments" },
    { serviceName: "fraud-model-service",  teamName: "Payments" },
    { serviceName: "ml-feature-store",     teamName: "Payments" },
    { serviceName: "order-service",        teamName: "Commerce" },
    { serviceName: "order-db",             teamName: "Commerce" },
    { serviceName: "inventory-service",    teamName: "Commerce" },
    { serviceName: "inventory-db",         teamName: "Commerce" },
    { serviceName: "notification-service", teamName: "Commerce" },
    { serviceName: "email-service",        teamName: "Commerce" },
    { serviceName: "sms-service",          teamName: "Commerce" },
  ];
  await Promise.all(
    ownershipData.map(({ serviceName, teamName }) => {
      const serviceId = serviceMap.get(serviceName)!;
      const teamId = teamMap.get(teamName)!;
      return db
        .insert(serviceOwnership)
        .values({ serviceId, teamId })
        .onConflictDoNothing();
    })
  );

  // Dependencies
  console.log("  → service_dependencies");
  await Promise.all(
    DEPENDENCIES.map(([from, to, type]) => {
      const fromServiceId = serviceMap.get(from)!;
      const toServiceId = serviceMap.get(to)!;
      return db
        .insert(serviceDependencies)
        .values({ fromServiceId, toServiceId, dependencyType: type })
        .onConflictDoNothing();
    })
  );

  // Runbooks (upsert by title)
  console.log("  → runbooks");
  const runbookRows = await Promise.all(
    RUNBOOKS.map((r) =>
      db
        .insert(runbooks)
        .values(r)
        .onConflictDoUpdate({ target: runbooks.title, set: { url: r.url } })
        .returning()
    )
  );
  const runbookMap = new Map(runbookRows.flat().map((r) => [r.title, r.id]));

  // Service runbooks — assign at least one runbook per service
  console.log("  → service_runbooks");
  const runbookTitles = RUNBOOKS.map((r) => r.title);
  const serviceRunbookData: { serviceName: string; runbookTitle: string }[] = [
    { serviceName: "api-gateway",          runbookTitle: "Emergency Deploy Rollback" },
    { serviceName: "api-gateway",          runbookTitle: "Null Pointer Exception Triage" },
    { serviceName: "auth-service",         runbookTitle: "Memory Leak Investigation" },
    { serviceName: "auth-service",         runbookTitle: "Emergency Deploy Rollback" },
    { serviceName: "payment-service",      runbookTitle: "Connection Pool Exhaustion" },
    { serviceName: "payment-service",      runbookTitle: "Emergency Deploy Rollback" },
    { serviceName: "order-service",        runbookTitle: "Slow Query Remediation" },
    { serviceName: "order-service",        runbookTitle: "Emergency Deploy Rollback" },
    { serviceName: "inventory-service",    runbookTitle: "Connection Pool Exhaustion" },
    { serviceName: "fraud-service",        runbookTitle: "Null Pointer Exception Triage" },
    { serviceName: "fraud-model-service",  runbookTitle: "Slow Query Remediation" },
    { serviceName: "notification-service", runbookTitle: "Null Pointer Exception Triage" },
    { serviceName: "user-db",              runbookTitle: "Connection Pool Exhaustion" },
    { serviceName: "user-db",              runbookTitle: "Slow Query Remediation" },
    { serviceName: "payment-db",           runbookTitle: "Connection Pool Exhaustion" },
    { serviceName: "payment-db",           runbookTitle: "Slow Query Remediation" },
    { serviceName: "order-db",             runbookTitle: "Slow Query Remediation" },
    { serviceName: "inventory-db",         runbookTitle: "Slow Query Remediation" },
    { serviceName: "redis-cache",          runbookTitle: "Memory Leak Investigation" },
    { serviceName: "ml-feature-store",     runbookTitle: "Slow Query Remediation" },
    { serviceName: "email-service",        runbookTitle: "Emergency Deploy Rollback" },
    { serviceName: "sms-service",          runbookTitle: "Null Pointer Exception Triage" },
  ];
  await Promise.all(
    serviceRunbookData.map(({ serviceName, runbookTitle }) => {
      const serviceId = serviceMap.get(serviceName)!;
      const runbookId = runbookMap.get(runbookTitle)!;
      return db
        .insert(serviceRunbooks)
        .values({ serviceId, runbookId })
        .onConflictDoNothing();
    })
  );

  // Deployments — 20 spread across last 48 hours
  console.log("  → deployments");
  const deployableServices = [
    "api-gateway", "auth-service", "payment-service", "order-service",
    "inventory-service", "fraud-service", "notification-service",
    "fraud-model-service", "email-service", "sms-service",
  ];
  const deploymentData = Array.from({ length: 20 }, (_, i) => {
    const svcName = deployableServices[i % deployableServices.length]!;
    return {
      serviceId: serviceMap.get(svcName)!,
      version: randomVersion(i % 8),
      commitSha: randomSha(),
      deployedAt: new Date(Date.now() - (i * 2.4 * 3600_000)),
      deployer: DEPLOYERS[i % DEPLOYERS.length]!,
    };
  });
  await db.insert(deployments).values(deploymentData).onConflictDoNothing();

  // Incidents + incident_services
  console.log("  → incidents");
  for (const inc of INCIDENTS) {
    const { serviceNames, ...incData } = inc;
    const [inserted] = await db
      .insert(incidents)
      .values(incData)
      .onConflictDoNothing()
      .returning();
    if (!inserted) continue; // already exists
    await Promise.all(
      serviceNames.map((svcName) => {
        const serviceId = serviceMap.get(svcName);
        if (!serviceId) return Promise.resolve();
        return db
          .insert(incidentServices)
          .values({ incidentId: inserted.id, serviceId })
          .onConflictDoNothing();
      })
    );
  }

  console.log("✅ Seed complete");
  await client.end();
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
