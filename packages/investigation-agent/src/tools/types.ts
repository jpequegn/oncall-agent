import type { ScenarioName } from "@shared/mock-data";

// ── Tool input shapes (what Claude sends) ─────────────────────────────────

export interface MetricQuery {
  service: string;
  metric?: string;        // e.g. "service.error_rate" — if omitted, return all
  from?: string;          // ISO-8601
  to?: string;            // ISO-8601
}

export interface LogQuery {
  service: string;
  level?: "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
  from?: string;
  to?: string;
  keyword?: string;       // substring match on message
  limit?: number;
}

export interface DeployQuery {
  service: string;
  hours?: number;         // deployments within last N hours (default 48)
}

export interface ServiceDepsQuery {
  service: string;        // service name or UUID
  depth?: number;         // transitive depth (default: direct only)
}

export interface RunbookQuery {
  keywords: string[];     // tags or title keywords
  service?: string;       // filter by applicable service
}

export interface IncidentQuery {
  service?: string;       // filter by affected service
  severity?: "P1" | "P2" | "P3" | "P4";
  limit?: number;
}

export interface SimilarIncidentQuery {
  query: string;          // natural language description of the issue
  service?: string;       // filter by service
  limit?: number;         // max results (default 5)
}

// ── Tool result envelope ───────────────────────────────────────────────────

export interface ToolResult {
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  durationMs: number;
  error?: string;
}

// ── Executor context ───────────────────────────────────────────────────────

export interface ExecutorContext {
  scenario: ScenarioName;
  serviceGraphUrl?: string; // default http://localhost:3001
  memoryDatabaseUrl?: string; // for investigation memory queries
}
