import { describe, test, expect } from "bun:test";
import { formatToolName, formatDuration, formatSummary, toInvestigationBlocks } from "../formatters";
import type { FullInvestigationResult } from "@oncall/hypothesis-validator";

// ── Helper ──────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<FullInvestigationResult> = {}): FullInvestigationResult {
  return {
    alert: {
      id: "alert-1",
      title: "High error rate on payment-service",
      severity: "critical",
      service: "payment-service",
      timestamp: new Date("2026-01-15T14:30:00Z"),
      labels: { env: "production" },
    },
    investigation: {
      id: "inv-1",
      alertId: "alert-1",
      startedAt: new Date("2026-01-15T14:30:00Z"),
      status: "completed",
      hypotheses: [
        {
          id: "h-1",
          description: "Bad deploy at 14:28 introduced regression",
          confidence: 85,
          evidence: ["Error spike correlates with deploy v2.3.1"],
          relatedServices: ["payment-service"],
          suggestedActions: ["Rollback to v2.3.0", "https://wiki.example.com/runbook"],
        },
      ],
      rootCause: "Bad deploy",
      resolution: "Rollback",
      summary: "Payment-service 500s caused by deploy regression",
    },
    validation: {
      incident_id: "inv-1",
      validated_hypotheses: [
        {
          original_rank: 1,
          original_confidence: 85,
          challenge_score: 20,
          key_objections: ["Could be upstream timeout"],
          missing_evidence: [],
          revised_confidence: 80,
        },
      ],
      escalate: false,
      validator_notes: "Strong evidence for deploy regression",
    },
    final_hypotheses: [
      {
        original_rank: 1,
        original_confidence: 85,
        challenge_score: 20,
        key_objections: ["Could be upstream timeout"],
        missing_evidence: [],
        revised_confidence: 80,
      },
    ],
    escalate: false,
    investigation_duration_ms: 3000,
    validation_duration_ms: 2000,
    total_duration_ms: 5000,
    ...overrides,
  };
}

// ── formatToolName ──────────────────────────────────────────────────────

describe("formatToolName", () => {
  test("maps known tool names", () => {
    expect(formatToolName("query_metrics")).toBe("Queried service metrics");
    expect(formatToolName("search_logs")).toBe("Searched error logs");
    expect(formatToolName("get_recent_deploys")).toBe("Checked recent deploys");
    expect(formatToolName("get_service_deps")).toBe("Mapped service dependencies");
    expect(formatToolName("get_past_incidents")).toBe("Reviewed past incidents");
    expect(formatToolName("search_runbooks")).toBe("Searched runbooks");
  });

  test("falls back to humanized underscore name", () => {
    expect(formatToolName("check_database")).toBe("check database");
    expect(formatToolName("run_diagnostics")).toBe("run diagnostics");
  });
});

// ── formatDuration ──────────────────────────────────────────────────────

describe("formatDuration", () => {
  test("sub-second shows ms", () => {
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  test("1s+ shows seconds with one decimal", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(5432)).toBe("5.4s");
    expect(formatDuration(12345)).toBe("12.3s");
  });
});

// ── formatSummary ───────────────────────────────────────────────────────

describe("formatSummary", () => {
  test("normal result includes summary and root cause", () => {
    const summary = formatSummary(makeResult());
    expect(summary).toContain("Payment-service 500s caused by deploy regression");
    expect(summary).toContain("Root cause (80% confidence)");
    expect(summary).toContain("Bad deploy at 14:28");
  });

  test("includes suggested action", () => {
    const summary = formatSummary(makeResult());
    expect(summary).toContain("Action: Rollback to v2.3.0");
  });

  test("escalation result shows escalation message", () => {
    const summary = formatSummary(makeResult({
      escalate: true,
      validation: {
        incident_id: "inv-1",
        validated_hypotheses: [],
        escalate: true,
        escalation_reason: "low confidence across all hypotheses",
        validator_notes: "",
      },
      final_hypotheses: [],
    }));
    expect(summary).toContain("⚠️ Escalation required");
    expect(summary).toContain("low confidence");
  });

  test("fallback when no summary", () => {
    const result = makeResult();
    result.investigation.summary = undefined;
    result.final_hypotheses = [];
    const summary = formatSummary(result);
    expect(summary).toContain("Investigation complete for payment-service");
  });
});

// ── toInvestigationBlocks ───────────────────────────────────────────────

describe("toInvestigationBlocks", () => {
  test("returns correct shape", () => {
    const blocks = toInvestigationBlocks(makeResult(), 4);
    expect(blocks.type).toBe("investigation_result");
    expect(blocks.alert.service).toBe("payment-service");
    expect(blocks.hypotheses).toHaveLength(1);
    expect(blocks.duration_ms).toBe(5000);
    expect(blocks.tool_call_count).toBe(4);
    expect(blocks.escalate).toBe(false);
  });

  test("defaults tool_call_count to 0", () => {
    const blocks = toInvestigationBlocks(makeResult());
    expect(blocks.tool_call_count).toBe(0);
  });

  test("reflects escalation state", () => {
    const blocks = toInvestigationBlocks(makeResult({ escalate: true }));
    expect(blocks.escalate).toBe(true);
  });
});
