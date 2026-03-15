import {
  getMockMetrics,
  getMockLogs,
  getMockDeploys,
  fetchServiceDeps,
  searchMockRunbooks,
  getMockPastIncidents,
  searchSimilarIncidents,
} from "./handlers";
import type {
  MetricQuery,
  LogQuery,
  DeployQuery,
  ServiceDepsQuery,
  RunbookQuery,
  IncidentQuery,
  SimilarIncidentQuery,
  ToolResult,
  ExecutorContext,
} from "./types";

// ── Executor ───────────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: ExecutorContext
): Promise<ToolResult> {
  const start = Date.now();

  let output: unknown;
  let error: string | undefined;

  try {
    switch (toolName) {
      case "query_metrics":
        output = getMockMetrics(toolInput as unknown as MetricQuery, ctx);
        break;

      case "search_logs":
        output = getMockLogs(toolInput as unknown as LogQuery, ctx);
        break;

      case "get_recent_deploys":
        output = getMockDeploys(toolInput as unknown as DeployQuery, ctx);
        break;

      case "get_service_deps":
        output = await fetchServiceDeps(toolInput as unknown as ServiceDepsQuery, ctx);
        break;

      case "search_runbooks":
        output = searchMockRunbooks(toolInput as unknown as RunbookQuery);
        break;

      case "get_past_incidents":
        output = getMockPastIncidents(toolInput as unknown as IncidentQuery);
        break;

      case "search_similar_incidents":
        output = await searchSimilarIncidents(toolInput as unknown as SimilarIncidentQuery, ctx);
        break;

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    output = null;
  }

  const result: ToolResult = {
    tool: toolName,
    input: toolInput,
    output,
    durationMs: Date.now() - start,
    ...(error ? { error } : {}),
  };

  logToolCall(result);
  return result;
}

// ── Tool definitions for Claude's tool_use ────────────────────────────────
// Passed to the Anthropic API as the `tools` parameter.

export const toolDefinitions = [
  {
    name: "query_metrics",
    description:
      "Query time-series metrics for a service (error rate, latency, throughput, CPU). Returns metric points for the investigation window.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name, e.g. 'payment-service'" },
        metric: { type: "string", description: "Specific metric name, e.g. 'service.error_rate'. Omit for all metrics." },
        from: { type: "string", description: "Start of window (ISO-8601)" },
        to:   { type: "string", description: "End of window (ISO-8601)" },
      },
      required: ["service"],
    },
  },
  {
    name: "search_logs",
    description:
      "Retrieve structured logs for a service. Supports filtering by log level, time range, and keyword.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name" },
        level:   { type: "string", enum: ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"], description: "Minimum log level" },
        from:    { type: "string", description: "Start of window (ISO-8601)" },
        to:      { type: "string", description: "End of window (ISO-8601)" },
        keyword: { type: "string", description: "Substring to search in log messages" },
        limit:   { type: "number", description: "Max number of log entries to return" },
      },
      required: ["service"],
    },
  },
  {
    name: "get_recent_deploys",
    description:
      "Get recent deployments for a service including commit SHA, files changed, and deploy timestamp.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name" },
        hours:   { type: "number", description: "Look back window in hours (default 48)" },
      },
      required: ["service"],
    },
  },
  {
    name: "get_service_deps",
    description:
      "Query the service dependency graph. Returns upstream (callers) and downstream (callees) services. Use depth for transitive traversal.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name or UUID" },
        depth:   { type: "number", description: "Transitive depth (1 = direct only, max 10)" },
      },
      required: ["service"],
    },
  },
  {
    name: "search_runbooks",
    description:
      "Search operational runbooks by keyword or service. Returns relevant runbooks with full remediation steps.",
    input_schema: {
      type: "object",
      properties: {
        keywords: { type: "array", items: { type: "string" }, description: "Keywords to match against title, tags, and content" },
        service:  { type: "string", description: "Filter runbooks applicable to this service" },
      },
      required: ["keywords"],
    },
  },
  {
    name: "get_past_incidents",
    description:
      "Retrieve past incidents for a service including root cause and resolution. Useful for identifying recurring patterns.",
    input_schema: {
      type: "object",
      properties: {
        service:  { type: "string", description: "Filter by affected service" },
        severity: { type: "string", enum: ["P1", "P2", "P3", "P4"], description: "Filter by severity" },
        limit:    { type: "number", description: "Max incidents to return (default all)" },
      },
      required: [],
    },
  },
  {
    name: "search_similar_incidents",
    description:
      "Search the investigation memory for similar past incidents using semantic similarity. Returns past investigations with their root causes, resolutions, and human feedback (confirmed/rejected/corrected). Also detects recurrence patterns. Use this FIRST to check if this type of incident has been seen before.",
    input_schema: {
      type: "object",
      properties: {
        query:   { type: "string", description: "Natural language description of the current incident symptoms" },
        service: { type: "string", description: "Filter to a specific service (recommended)" },
        limit:   { type: "number", description: "Max similar incidents to return (default 5)" },
      },
      required: ["query"],
    },
  },
] as const;

// ── Logger ─────────────────────────────────────────────────────────────────

function logToolCall(result: ToolResult) {
  const status = result.error ? "❌" : "✅";
  const inputStr = JSON.stringify(result.input);
  const truncated =
    inputStr.length > 120 ? inputStr.slice(0, 120) + "…" : inputStr;

  console.log(
    `[tool] ${status} ${result.tool} (${result.durationMs}ms) input=${truncated}${
      result.error ? ` error=${result.error}` : ""
    }`
  );
}
