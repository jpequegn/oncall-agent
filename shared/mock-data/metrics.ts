import type { MetricsResponse, MetricPoint } from "./types";

// ── Helpers ────────────────────────────────────────────────────────────────

function points(
  start: Date,
  count: number,
  stepMinutes: number,
  valueFn: (i: number, t: Date) => number
): MetricPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const t = new Date(start.getTime() + i * stepMinutes * 60_000);
    return { timestamp: t.toISOString(), value: Math.round(valueFn(i, t) * 100) / 100 };
  });
}

// ── Scenario A: Deploy-caused regression ──────────────────────────────────
// Anchor: 2024-01-15T14:00:00Z
// Deploy at 14:28, error spike from 14:30 onward

const A_START = new Date("2024-01-15T14:00:00Z");
const A_SPIKE_AT = 30; // minute index when spike begins

export const scenarioAMetrics: MetricsResponse = {
  from: "2024-01-15T14:00:00Z",
  to:   "2024-01-15T15:00:00Z",
  resolution: "1m",
  series: [
    {
      metric: "service.error_rate",
      service: "payment-service",
      unit: "percent",
      points: points(A_START, 60, 1, (i) =>
        i < A_SPIKE_AT ? 0.3 + Math.random() * 0.2 : 7.8 + Math.random() * 0.5
      ),
    },
    {
      metric: "service.request_rate",
      service: "payment-service",
      unit: "requests_per_second",
      points: points(A_START, 60, 1, (i) =>
        120 + Math.sin(i / 10) * 15 + Math.random() * 5
      ),
    },
    {
      metric: "service.p99_latency",
      service: "payment-service",
      unit: "milliseconds",
      points: points(A_START, 60, 1, (i) =>
        i < A_SPIKE_AT ? 180 + Math.random() * 20 : 4200 + Math.random() * 800
      ),
    },
    {
      metric: "service.error_rate",
      service: "api-gateway",
      unit: "percent",
      points: points(A_START, 60, 1, (i) =>
        i < A_SPIKE_AT ? 0.1 + Math.random() * 0.1 : 2.1 + Math.random() * 0.3
      ),
    },
  ],
};

// ── Scenario B: Upstream dependency failure ────────────────────────────────
// Anchor: 2024-01-15T09:00:00Z
// inventory-db CPU spikes at minute 20, order-service latency follows at minute 22

const B_START = new Date("2024-01-15T09:00:00Z");
const B_SPIKE_AT = 20;

export const scenarioBMetrics: MetricsResponse = {
  from: "2024-01-15T09:00:00Z",
  to:   "2024-01-15T10:00:00Z",
  resolution: "1m",
  series: [
    {
      metric: "service.p99_latency",
      service: "order-service",
      unit: "milliseconds",
      points: points(B_START, 60, 1, (i) =>
        i < B_SPIKE_AT + 2 ? 220 + Math.random() * 30 : 8500 + Math.random() * 1500
      ),
    },
    {
      metric: "service.error_rate",
      service: "order-service",
      unit: "percent",
      points: points(B_START, 60, 1, (i) =>
        i < B_SPIKE_AT + 2 ? 0.2 + Math.random() * 0.1 : 15 + Math.random() * 3
      ),
    },
    {
      metric: "system.cpu_utilization",
      service: "inventory-service",
      unit: "percent",
      points: points(B_START, 60, 1, (i) =>
        i < B_SPIKE_AT ? 28 + Math.random() * 5 : 94 + Math.random() * 4
      ),
    },
    {
      metric: "db.connection_pool_wait_time",
      service: "inventory-db",
      unit: "milliseconds",
      points: points(B_START, 60, 1, (i) =>
        i < B_SPIKE_AT ? 2 + Math.random() * 1 : 4800 + Math.random() * 500
      ),
    },
    {
      metric: "db.active_connections",
      service: "inventory-db",
      unit: "count",
      points: points(B_START, 60, 1, (i) =>
        i < B_SPIKE_AT ? 12 + Math.random() * 2 : 100 + Math.random() * 5
      ),
    },
  ],
};

// ── Scenario C: No clear root cause ───────────────────────────────────────
// Anchor: 2024-01-15T22:00:00Z
// fraud-service intermittent errors, no consistent pattern

const C_START = new Date("2024-01-15T22:00:00Z");

export const scenarioCMetrics: MetricsResponse = {
  from: "2024-01-15T22:00:00Z",
  to:   "2024-01-15T23:00:00Z",
  resolution: "1m",
  series: [
    {
      metric: "service.error_rate",
      service: "fraud-service",
      unit: "percent",
      // Intermittent: spikes at irregular intervals, no clear pattern
      points: points(C_START, 60, 1, (i) => {
        const spikes = [5, 13, 27, 31, 44, 52, 58];
        return spikes.includes(i) ? 3 + Math.random() * 4 : 0.4 + Math.random() * 0.3;
      }),
    },
    {
      metric: "service.p99_latency",
      service: "fraud-service",
      unit: "milliseconds",
      points: points(C_START, 60, 1, (i) => {
        const spikes = [5, 13, 27, 31, 44, 52, 58];
        return spikes.includes(i) ? 1200 + Math.random() * 600 : 320 + Math.random() * 50;
      }),
    },
    {
      metric: "service.request_rate",
      service: "fraud-service",
      unit: "requests_per_second",
      // Steady, no correlation with errors
      points: points(C_START, 60, 1, () => 45 + Math.random() * 8),
    },
    {
      metric: "system.cpu_utilization",
      service: "fraud-service",
      unit: "percent",
      points: points(C_START, 60, 1, () => 35 + Math.random() * 10),
    },
  ],
};
