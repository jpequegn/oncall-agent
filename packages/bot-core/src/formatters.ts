import type { FullInvestigationResult } from "@oncall/hypothesis-validator";
import type { InvestigationBlocks } from "./types";

// ── Tool name formatting ────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  query_metrics:      "Queried service metrics",
  search_logs:        "Searched error logs",
  get_recent_deploys: "Checked recent deploys",
  get_service_deps:   "Mapped service dependencies",
  get_past_incidents: "Reviewed past incidents",
  search_runbooks:    "Searched runbooks",
};

export function formatToolName(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

// ── Duration formatting ─────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Plain-text summary ──────────────────────────────────────────────────

export function formatSummary(result: FullInvestigationResult): string {
  const top = result.final_hypotheses[0];
  const origH = top ? result.investigation.hypotheses[top.original_rank - 1] : undefined;

  if (result.escalate) {
    return `⚠️ Escalation required: ${result.validation.escalation_reason ?? "low confidence"}\n${result.investigation.summary ?? ""}`;
  }

  return [
    result.investigation.summary ?? `Investigation complete for ${result.alert.service}`,
    origH ? `Root cause (${top!.revised_confidence}% confidence): ${origH.description}` : "",
    origH?.suggestedActions[0] ? `Action: ${origH.suggestedActions[0]}` : "",
  ].filter(Boolean).join("\n");
}

// ── Convert pipeline result to InvestigationBlocks ──────────────────────

export function toInvestigationBlocks(
  result: FullInvestigationResult,
  toolCallCount: number = 0
): InvestigationBlocks {
  return {
    type: "investigation_result",
    alert: result.alert,
    hypotheses: result.final_hypotheses,
    timeline: [],
    duration_ms: result.total_duration_ms,
    tool_call_count: toolCallCount,
    escalate: result.escalate,
  };
}
