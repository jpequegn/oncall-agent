import {
  getScenario,
  mockRunbooks,
  mockIncidents,
  scenarioBInventoryDeploys,
} from "@shared/mock-data";
import type {
  MetricsResponse,
  LogsResponse,
  DeploysResponse,
} from "@shared/mock-data";
import type {
  MetricQuery,
  LogQuery,
  DeployQuery,
  ServiceDepsQuery,
  RunbookQuery,
  IncidentQuery,
  SimilarIncidentQuery,
  ExecutorContext,
} from "./types";

// ── query_metrics ──────────────────────────────────────────────────────────

export function getMockMetrics(
  input: MetricQuery,
  ctx: ExecutorContext
): MetricsResponse {
  const scenario = getScenario(ctx.scenario);
  const { series, from, to, resolution } = scenario.metrics;

  // Filter to requested service
  let filtered = series.filter((s) => s.service === input.service);

  // Optionally filter to a specific metric name
  if (input.metric) {
    filtered = filtered.filter((s) => s.metric === input.metric);
  }

  // Optionally filter points by time range
  if (input.from || input.to) {
    const fromTs = input.from ? new Date(input.from).getTime() : 0;
    const toTs = input.to ? new Date(input.to).getTime() : Infinity;
    filtered = filtered.map((s) => ({
      ...s,
      points: s.points.filter((p) => {
        const t = new Date(p.timestamp).getTime();
        return t >= fromTs && t <= toTs;
      }),
    }));
  }

  return { series: filtered, from, to, resolution };
}

// ── search_logs ───────────────────────────────────────────────────────────

export function getMockLogs(
  input: LogQuery,
  ctx: ExecutorContext
): LogsResponse {
  const scenario = getScenario(ctx.scenario);
  let entries = scenario.logs.entries.filter(
    (e) => e.service === input.service
  );

  if (input.level) {
    entries = entries.filter((e) => e.level === input.level);
  }
  if (input.from) {
    const fromTs = new Date(input.from).getTime();
    entries = entries.filter(
      (e) => new Date(e.timestamp).getTime() >= fromTs
    );
  }
  if (input.to) {
    const toTs = new Date(input.to).getTime();
    entries = entries.filter(
      (e) => new Date(e.timestamp).getTime() <= toTs
    );
  }
  if (input.keyword) {
    const kw = input.keyword.toLowerCase();
    entries = entries.filter((e) =>
      e.message.toLowerCase().includes(kw)
    );
  }
  if (input.limit) {
    entries = entries.slice(0, input.limit);
  }

  return {
    service: input.service,
    from: input.from ?? scenario.logs.from,
    to: input.to ?? scenario.logs.to,
    entries,
  };
}

// ── get_recent_deploys ────────────────────────────────────────────────────

export function getMockDeploys(
  input: DeployQuery,
  ctx: ExecutorContext
): DeploysResponse {
  const scenario = getScenario(ctx.scenario);
  let deployments = scenario.deploys.deployments.filter(
    (d) => d.service === input.service
  );

  // Scenario B has a secondary deploys source for inventory-service
  if (
    ctx.scenario === "upstream-failure" &&
    input.service === "inventory-service"
  ) {
    deployments = scenarioBInventoryDeploys.deployments;
  }

  const hours = input.hours ?? 48;
  const cutoff = new Date(
    new Date(scenario.triggerAlert.firedAt).getTime() - hours * 3_600_000
  );
  deployments = deployments.filter(
    (d) => new Date(d.deployedAt) >= cutoff
  );

  return { service: input.service, deployments };
}

// ── get_service_deps ──────────────────────────────────────────────────────

export async function fetchServiceDeps(
  input: ServiceDepsQuery,
  ctx: ExecutorContext
): Promise<unknown> {
  const base = ctx.serviceGraphUrl ?? "http://localhost:3001";
  const path = input.depth
    ? `/services/${encodeURIComponent(input.service)}/deps?depth=${input.depth}`
    : `/services/${encodeURIComponent(input.service)}/deps`;

  const res = await fetch(`${base}${path}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`service-graph returned ${res.status}: ${body}`);
  }
  return res.json();
}

// ── search_runbooks ───────────────────────────────────────────────────────

export function searchMockRunbooks(input: RunbookQuery): typeof mockRunbooks {
  let results = mockRunbooks;

  if (input.service) {
    results = results.filter((r) =>
      r.applicableServices.includes(input.service!)
    );
  }

  if (input.keywords.length > 0) {
    const kwLower = input.keywords.map((k) => k.toLowerCase());
    results = results.filter((r) => {
      const haystack = [
        r.title.toLowerCase(),
        ...r.tags.map((t) => t.toLowerCase()),
        r.content.toLowerCase(),
      ].join(" ");
      return kwLower.some((kw) => haystack.includes(kw));
    });
  }

  return results;
}

// ── get_past_incidents ────────────────────────────────────────────────────

// ── search_similar_incidents ─────────────────────────────────────────────

export async function searchSimilarIncidents(
  input: SimilarIncidentQuery,
  ctx: ExecutorContext
): Promise<unknown> {
  try {
    const { searchHybrid, detectRecurrence } = await import("@oncall/investigation-memory");

    const [similar, recurrence] = await Promise.all([
      searchHybrid(input.query, {
        service: input.service,
        limit: input.limit ?? 5,
        databaseUrl: ctx.memoryDatabaseUrl,
      }),
      input.service
        ? detectRecurrence(input.service, 14, 3, {
            databaseUrl: ctx.memoryDatabaseUrl,
          })
        : Promise.resolve(null),
    ]);

    return {
      similar_incidents: similar.map((s) => ({
        alert_title: s.alertTitle,
        service: s.service,
        severity: s.severity,
        root_cause: s.rootCause,
        resolution: s.resolution,
        summary: s.summary,
        feedback: s.feedback,
        human_correction: s.correctionText,
        confidence: s.topConfidence,
        investigated_at: s.investigatedAt,
        similarity_score: Math.round(s.similarity * 100) / 100,
      })),
      recurrence_pattern: recurrence
        ? {
            count: recurrence.count,
            window_days: 14,
            common_root_causes: recurrence.commonRootCauses,
            message: `WARNING: ${recurrence.count} incidents for ${recurrence.service} in the last 14 days. This may indicate a systemic issue.`,
          }
        : null,
    };
  } catch {
    // Investigation memory not available — return empty (graceful degradation)
    return {
      similar_incidents: [],
      recurrence_pattern: null,
      note: "Investigation memory is not available. Proceeding without historical context.",
    };
  }
}

// ── get_past_incidents ────────────────────────────────────────────────────

export function getMockPastIncidents(input: IncidentQuery): typeof mockIncidents {
  let results = mockIncidents;

  if (input.service) {
    results = results.filter((i) =>
      i.services.includes(input.service!)
    );
  }
  if (input.severity) {
    results = results.filter((i) => i.severity === input.severity);
  }
  if (input.limit) {
    results = results.slice(0, input.limit);
  }

  return results;
}
