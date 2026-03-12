// Types matching the shapes returned by real external APIs.
// Used by the Investigation Agent tool layer to type both real and mock responses.

// ── Datadog Metrics ────────────────────────────────────────────────────────

export interface MetricPoint {
  timestamp: string; // ISO-8601
  value: number;
}

export interface MetricSeries {
  metric: string;        // e.g. "service.error_rate"
  service: string;
  unit: string;          // e.g. "percent", "milliseconds", "requests_per_second"
  points: MetricPoint[];
}

export interface MetricsResponse {
  series: MetricSeries[];
  from: string;
  to: string;
  resolution: "1m" | "5m" | "1h";
}

// ── GitHub Deployments ─────────────────────────────────────────────────────

export interface CommitFile {
  filename: string;
  additions: number;
  deletions: number;
  status: "added" | "modified" | "removed";
}

export interface DeployRecord {
  id: string;
  service: string;
  version: string;
  commitSha: string;
  commitMessage: string;
  author: string;
  deployedAt: string; // ISO-8601
  environment: "production" | "staging" | "dev";
  status: "success" | "failure" | "rollback";
  filesChanged: CommitFile[];
}

export interface DeploysResponse {
  service: string;
  deployments: DeployRecord[];
}

// ── Log Store ──────────────────────────────────────────────────────────────

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export interface LogEntry {
  timestamp: string; // ISO-8601
  level: LogLevel;
  service: string;
  host: string;
  message: string;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, string>;
}

export interface LogsResponse {
  service: string;
  from: string;
  to: string;
  entries: LogEntry[];
}

// ── Scenario envelope ──────────────────────────────────────────────────────

export type ScenarioName = "deploy-regression" | "upstream-failure" | "no-clear-cause";

export interface Scenario {
  name: ScenarioName;
  description: string;
  expectedOutcome: string;
  triggerAlert: {
    service: string;
    title: string;
    severity: "critical" | "high" | "medium";
    firedAt: string;
  };
  metrics: MetricsResponse;
  logs: LogsResponse;
  deploys: DeploysResponse;
}
