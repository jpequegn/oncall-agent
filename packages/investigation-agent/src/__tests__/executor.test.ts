import { describe, it, expect, mock } from "bun:test";
import { executeTool, toolDefinitions } from "../tools/executor";
import type { ExecutorContext } from "../tools/types";

const CTX_A: ExecutorContext = { scenario: "deploy-regression" };
const CTX_B: ExecutorContext = { scenario: "upstream-failure" };
const CTX_C: ExecutorContext = { scenario: "no-clear-cause" };

// ── query_metrics ──────────────────────────────────────────────────────────

describe("query_metrics", () => {
  it("returns metrics for payment-service in scenario A", async () => {
    const result = await executeTool("query_metrics", { service: "payment-service" }, CTX_A);
    expect(result.error).toBeUndefined();
    const out = result.output as { series: { service: string; metric: string; points: unknown[] }[] };
    expect(out.series.length).toBeGreaterThan(0);
    expect(out.series.every((s) => s.service === "payment-service")).toBe(true);
    expect(out.series[0]!.points.length).toBeGreaterThan(0);
  });

  it("filters to a specific metric name", async () => {
    const result = await executeTool(
      "query_metrics",
      { service: "payment-service", metric: "service.error_rate" },
      CTX_A
    );
    const out = result.output as { series: { metric: string }[] };
    expect(out.series.every((s) => s.metric === "service.error_rate")).toBe(true);
  });

  it("returns empty series for unknown service", async () => {
    const result = await executeTool("query_metrics", { service: "ghost-service" }, CTX_A);
    const out = result.output as { series: unknown[] };
    expect(out.series).toHaveLength(0);
  });

  it("filters points by time range", async () => {
    const result = await executeTool(
      "query_metrics",
      { service: "payment-service", from: "2024-01-15T14:30:00Z", to: "2024-01-15T14:40:00Z" },
      CTX_A
    );
    const out = result.output as { series: { points: { timestamp: string }[] }[] };
    if (out.series[0]) {
      const timestamps = out.series[0].points.map((p) => p.timestamp);
      expect(timestamps.every((t) => t >= "2024-01-15T14:30:00Z")).toBe(true);
      expect(timestamps.every((t) => t <= "2024-01-15T14:40:00Z")).toBe(true);
    }
  });
});

// ── search_logs ────────────────────────────────────────────────────────────

describe("search_logs", () => {
  it("returns logs for payment-service in scenario A", async () => {
    const result = await executeTool("search_logs", { service: "payment-service" }, CTX_A);
    expect(result.error).toBeUndefined();
    const out = result.output as { entries: { service: string }[] };
    expect(out.entries.length).toBeGreaterThan(0);
    expect(out.entries.every((e) => e.service === "payment-service")).toBe(true);
  });

  it("keyword filter finds NPE log entries", async () => {
    const result = await executeTool(
      "search_logs",
      { service: "payment-service", keyword: "NullPointerException" },
      CTX_A
    );
    const out = result.output as { entries: { message: string }[] };
    expect(out.entries.length).toBeGreaterThan(0);
    expect(out.entries.every((e) => e.message.includes("NullPointerException"))).toBe(true);
  });

  it("level filter returns only ERROR entries", async () => {
    const result = await executeTool(
      "search_logs",
      { service: "payment-service", level: "ERROR" },
      CTX_A
    );
    const out = result.output as { entries: { level: string }[] };
    expect(out.entries.every((e) => e.level === "ERROR")).toBe(true);
  });

  it("limit parameter caps results", async () => {
    const result = await executeTool(
      "search_logs",
      { service: "payment-service", limit: 2 },
      CTX_A
    );
    const out = result.output as { entries: unknown[] };
    expect(out.entries.length).toBeLessThanOrEqual(2);
  });

  it("returns connection timeout errors in scenario B", async () => {
    const result = await executeTool(
      "search_logs",
      { service: "inventory-service", keyword: "timeout" },
      CTX_B
    );
    const out = result.output as { entries: { message: string }[] };
    expect(out.entries.length).toBeGreaterThan(0);
    expect(out.entries.some((e) => e.message.toLowerCase().includes("timeout"))).toBe(true);
  });
});

// ── get_recent_deploys ─────────────────────────────────────────────────────

describe("get_recent_deploys", () => {
  it("returns deploy abc123 for payment-service in scenario A", async () => {
    const result = await executeTool(
      "get_recent_deploys",
      { service: "payment-service", hours: 2 },
      CTX_A
    );
    expect(result.error).toBeUndefined();
    const out = result.output as { deployments: { commitSha: string }[] };
    expect(out.deployments.some((d) => d.commitSha === "abc123")).toBe(true);
  });

  it("returns no deploys for order-service in scenario B (no recent deploy)", async () => {
    const result = await executeTool(
      "get_recent_deploys",
      { service: "order-service", hours: 24 },
      CTX_B
    );
    const out = result.output as { deployments: unknown[] };
    expect(out.deployments).toHaveLength(0);
  });

  it("filesChanged includes PaymentProcessor.java for abc123", async () => {
    const result = await executeTool(
      "get_recent_deploys",
      { service: "payment-service", hours: 2 },
      CTX_A
    );
    const out = result.output as { deployments: { commitSha: string; filesChanged: { filename: string }[] }[] };
    const deploy = out.deployments.find((d) => d.commitSha === "abc123");
    expect(deploy).toBeDefined();
    expect(deploy!.filesChanged.some((f) => f.filename.includes("PaymentProcessor.java"))).toBe(true);
  });
});

// ── get_service_deps ───────────────────────────────────────────────────────

describe("get_service_deps", () => {
  it("returns error result when service-graph is unavailable", async () => {
    const result = await executeTool(
      "get_service_deps",
      { service: "payment-service" },
      { ...CTX_A, serviceGraphUrl: "http://localhost:19999" } // non-existent port
    );
    // Should not throw — error is captured in result
    expect(result.error).toBeDefined();
    expect(result.output).toBeNull();
  });
});

// ── search_runbooks ────────────────────────────────────────────────────────

describe("search_runbooks", () => {
  it("finds rollback runbook by keyword", async () => {
    const result = await executeTool(
      "search_runbooks",
      { keywords: ["rollback"] },
      CTX_A
    );
    expect(result.error).toBeUndefined();
    const out = result.output as { title: string }[];
    expect(out.some((r) => r.title.toLowerCase().includes("rollback"))).toBe(true);
  });

  it("filters runbooks by service", async () => {
    const result = await executeTool(
      "search_runbooks",
      { keywords: [], service: "payment-service" },
      CTX_A
    );
    const out = result.output as { applicableServices: string[] }[];
    expect(out.every((r) => r.applicableServices.includes("payment-service"))).toBe(true);
  });

  it("returns empty array for unknown keywords and service", async () => {
    const result = await executeTool(
      "search_runbooks",
      { keywords: ["zzz-nonexistent-keyword"], service: "ghost-service" },
      CTX_A
    );
    const out = result.output as unknown[];
    expect(out).toHaveLength(0);
  });
});

// ── get_past_incidents ─────────────────────────────────────────────────────

describe("get_past_incidents", () => {
  it("returns incidents involving payment-service", async () => {
    const result = await executeTool(
      "get_past_incidents",
      { service: "payment-service" },
      CTX_A
    );
    expect(result.error).toBeUndefined();
    const out = result.output as { services: string[] }[];
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((i) => i.services.includes("payment-service"))).toBe(true);
  });

  it("filters by P1 severity", async () => {
    const result = await executeTool(
      "get_past_incidents",
      { severity: "P1" },
      CTX_A
    );
    const out = result.output as { severity: string }[];
    expect(out.every((i) => i.severity === "P1")).toBe(true);
  });

  it("limit caps the result count", async () => {
    const result = await executeTool("get_past_incidents", { limit: 3 }, CTX_A);
    const out = result.output as unknown[];
    expect(out.length).toBeLessThanOrEqual(3);
  });
});

// ── unknown tool ───────────────────────────────────────────────────────────

describe("unknown tool", () => {
  it("captures error without throwing", async () => {
    const result = await executeTool("nonexistent_tool", {}, CTX_A);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/Unknown tool/);
    expect(result.output).toBeNull();
  });
});

// ── tool definitions ───────────────────────────────────────────────────────

describe("toolDefinitions", () => {
  it("exports all 7 tool definitions", () => {
    expect(toolDefinitions).toHaveLength(7);
    const names = toolDefinitions.map((t) => t.name);
    expect(names).toContain("query_metrics");
    expect(names).toContain("search_logs");
    expect(names).toContain("get_recent_deploys");
    expect(names).toContain("get_service_deps");
    expect(names).toContain("search_runbooks");
    expect(names).toContain("get_past_incidents");
    expect(names).toContain("search_similar_incidents");
  });

  it("each definition has required name, description, and input_schema", () => {
    for (const def of toolDefinitions) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.input_schema).toBeDefined();
      expect(def.input_schema.type).toBe("object");
    }
  });
});
