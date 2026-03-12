export type { MockRunbook } from "./runbooks";
export type { MockIncident } from "./incidents";
export type * from "./types";

export { mockRunbooks } from "./runbooks";
export { mockIncidents } from "./incidents";
export {
  scenarioAMetrics,
  scenarioBMetrics,
  scenarioCMetrics,
} from "./metrics";
export {
  scenarioALogs,
  scenarioBLogs,
  scenarioCLogs,
} from "./logs";
export {
  scenarioADeploys,
  scenarioBDeploys,
  scenarioBInventoryDeploys,
  scenarioCDeploys,
  recentDeploys,
} from "./deploys";

import type { Scenario, ScenarioName } from "./types";
import { scenarioAMetrics, scenarioBMetrics, scenarioCMetrics } from "./metrics";
import { scenarioALogs, scenarioBLogs, scenarioCLogs } from "./logs";
import { scenarioADeploys, scenarioBDeploys, scenarioCDeploys } from "./deploys";

// ── Scenario router ────────────────────────────────────────────────────────

export const scenarios: Record<ScenarioName, Scenario> = {
  "deploy-regression": {
    name: "deploy-regression",
    description:
      "payment-service error rate spikes to 8% starting 14:30 — 2 minutes after deploy abc123 at 14:28 that touched PaymentProcessor.java",
    expectedOutcome:
      "Agent identifies deploy abc123 as root cause via NullPointerException at PaymentProcessor:247; recommends rollback to v2.4.0",
    triggerAlert: {
      service: "payment-service",
      title: "payment-service error rate > 5% for 5 minutes",
      severity: "critical",
      firedAt: "2024-01-15T14:35:00Z",
    },
    metrics: scenarioAMetrics,
    logs: scenarioALogs,
    deploys: scenarioADeploys,
  },

  "upstream-failure": {
    name: "upstream-failure",
    description:
      "order-service latency spikes at 09:22 due to inventory-service connection pool exhaustion (inventory-db CPU 94%); no recent deploys",
    expectedOutcome:
      "Agent traces latency from order-service → inventory-service → inventory-db connection pool exhaustion; recommends connection pool tuning and PgBouncer",
    triggerAlert: {
      service: "order-service",
      title: "order-service p99 latency > 5s for 3 minutes",
      severity: "critical",
      firedAt: "2024-01-15T09:25:00Z",
    },
    metrics: scenarioBMetrics,
    logs: scenarioBLogs,
    deploys: scenarioBDeploys,
  },

  "no-clear-cause": {
    name: "no-clear-cause",
    description:
      "fraud-service intermittent errors (3–7%) at irregular intervals; no deploy correlation; logs show transient upstream failures with successful retries",
    expectedOutcome:
      "Agent cannot identify a single root cause; confidence below threshold; escalates to human with summary of findings and suggested investigation paths",
    triggerAlert: {
      service: "fraud-service",
      title: "fraud-service error rate elevated (> 3%) — intermittent",
      severity: "high",
      firedAt: "2024-01-15T22:30:00Z",
    },
    metrics: scenarioCMetrics,
    logs: scenarioCLogs,
    deploys: scenarioCDeploys,
  },
};

export function getScenario(name: ScenarioName): Scenario {
  return scenarios[name];
}

export function listScenarios(): ScenarioName[] {
  return Object.keys(scenarios) as ScenarioName[];
}
