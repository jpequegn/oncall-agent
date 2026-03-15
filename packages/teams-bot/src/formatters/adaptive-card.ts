import type { InvestigationBlocks } from "@oncall/bot-core";
import type { Hypothesis } from "@shared/types";
import type { ValidatedHypothesis } from "@oncall/bot-core";
import { ACTIONS, formatDuration } from "@oncall/bot-core";

// ── Evidence formatting ────────────────────────────────────────────────

const MAX_EVIDENCE = 5;

function formatEvidence(evidence: string[]): string {
  if (!evidence.length) return "_No specific evidence cited._";
  const shown = evidence.slice(0, MAX_EVIDENCE);
  const rest = evidence.length - shown.length;
  const lines = shown.map((e) => `• ${e}`);
  if (rest > 0) lines.push(`_…and ${rest} more_`);
  return lines.join("\n");
}

// ── Confidence emoji ───────────────────────────────────────────────────

function confidenceEmoji(pct: number): string {
  if (pct >= 80) return "🟢";
  if (pct >= 50) return "🟡";
  return "🔴";
}

// ── Hypothesis card body ───────────────────────────────────────────────

function hypothesisBody(
  vh: ValidatedHypothesis,
  origH: Hypothesis | undefined,
  rank: number,
  isTop: boolean,
): Record<string, unknown>[] {
  const emoji = confidenceEmoji(vh.revised_confidence);
  const label = isTop ? `**Hypothesis #${rank}** ${emoji}` : `Hypothesis #${rank} ${emoji}`;
  const items: Record<string, unknown>[] = [];

  items.push({
    type: "TextBlock",
    text: `${label} · Confidence: **${vh.original_confidence}%** → **${vh.revised_confidence}%** _(challenge: ${vh.challenge_score}/100)_`,
    wrap: true,
    spacing: isTop ? "Medium" : "Small",
  });

  if (origH) {
    items.push({
      type: "TextBlock",
      text: `> ${origH.description}`,
      wrap: true,
      spacing: "None",
    });
  }

  if (isTop && origH?.evidence.length) {
    items.push({
      type: "TextBlock",
      text: `**Evidence:**\n${formatEvidence(origH.evidence)}`,
      wrap: true,
      spacing: "Small",
    });
  }

  if (isTop && vh.key_objections.length) {
    items.push({
      type: "TextBlock",
      text: `🔬 **Adversarial check:** ${vh.key_objections[0]}`,
      isSubtle: true,
      spacing: "Small",
    });
  }

  if (isTop && origH?.suggestedActions.length) {
    const action = origH.suggestedActions.find((a) => !a.startsWith("http"));
    const runbook = origH.suggestedActions.find((a) => a.startsWith("http"));
    if (action) {
      let actionText = `**Suggested action:** ${action}`;
      if (runbook) actionText += ` · [Runbook](${runbook})`;
      items.push({ type: "TextBlock", text: actionText, wrap: true, spacing: "Small" });
    }
  }

  return items;
}

// ── Main renderer ──────────────────────────────────────────────────────

/**
 * Render InvestigationBlocks as an Adaptive Card JSON payload.
 * This is the Teams-specific counterpart of Slack's renderBlockKit.
 *
 * Uses Adaptive Cards v1.5 features:
 * - FactSet for meta info (duration, severity, tool calls)
 * - Action.ShowCard for secondary hypotheses (collapsible)
 * - Evidence truncation with overflow note
 */
export function renderAdaptiveCard(data: InvestigationBlocks): Record<string, unknown> {
  const { alert, hypotheses, originalHypotheses, investigation, validation, escalate, duration_ms, tool_call_count } = data;

  const body: Record<string, unknown>[] = [];

  // Header
  body.push({
    type: "TextBlock",
    text: `📊 Investigation: ${alert.service}`,
    size: "Large",
    weight: "Bolder",
  });

  // Meta as FactSet
  body.push({
    type: "FactSet",
    facts: [
      { title: "Duration", value: formatDuration(duration_ms) },
      { title: "Severity", value: alert.severity.toUpperCase() },
      { title: "Status", value: investigation.status },
      { title: "Tool calls", value: String(tool_call_count) },
    ],
    spacing: "Small",
  });

  // Escalation banner
  if (escalate) {
    body.push({
      type: "TextBlock",
      text: `⚠️ **Escalation required** — ${validation.escalation_reason ?? "Low-confidence investigation. Human review needed."}`,
      color: "Attention",
      weight: "Bolder",
      spacing: "Medium",
      wrap: true,
    });
  }

  // Summary
  if (investigation.summary) {
    body.push({ type: "TextBlock", text: `📢 ${investigation.summary}`, wrap: true, spacing: "Medium" });
  }

  // Separator
  body.push({ type: "ColumnSet", separator: true, spacing: "Medium", columns: [] });

  // Hypotheses
  if (hypotheses.length === 0) {
    body.push({ type: "TextBlock", text: "_No hypotheses generated._", isSubtle: true });
  } else {
    // Top hypothesis — always shown inline
    const topVh = hypotheses[0]!;
    const topOrigH = originalHypotheses[topVh.original_rank - 1];
    body.push(...hypothesisBody(topVh, topOrigH, 1, true));
  }

  // Validator notes
  if (validation.validator_notes) {
    body.push({ type: "ColumnSet", separator: true, spacing: "Small", columns: [] });
    body.push({
      type: "TextBlock",
      text: `🔬 _${validation.validator_notes}_`,
      isSubtle: true,
      wrap: true,
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────

  const actions: Record<string, unknown>[] = [];

  // Action buttons (only when not escalating)
  if (!escalate && hypotheses.length > 0) {
    actions.push(
      {
        type: "Action.Submit",
        title: "👍 Correct",
        style: "positive",
        data: { actionId: ACTIONS.CONFIRM, value: "confirm" },
      },
      {
        type: "Action.Submit",
        title: "❌ Wrong",
        style: "destructive",
        data: { actionId: ACTIONS.REJECT, value: "reject" },
      },
      {
        type: "Action.Submit",
        title: "🔍 Dig deeper",
        data: { actionId: ACTIONS.INVESTIGATE_MORE, value: "investigate_more" },
      },
    );
  }

  // Secondary hypotheses in collapsible Action.ShowCard
  if (hypotheses.length > 1) {
    const secondaryBody: Record<string, unknown>[] = [];
    for (let i = 1; i < hypotheses.length; i++) {
      const vh = hypotheses[i]!;
      const origH = originalHypotheses[vh.original_rank - 1];
      secondaryBody.push(...hypothesisBody(vh, origH, i + 1, false));
      if (i < hypotheses.length - 1) {
        secondaryBody.push({ type: "ColumnSet", separator: true, spacing: "Small", columns: [] });
      }
    }

    actions.push({
      type: "Action.ShowCard",
      title: `📋 ${hypotheses.length - 1} more ${hypotheses.length - 1 === 1 ? "hypothesis" : "hypotheses"}`,
      card: {
        type: "AdaptiveCard",
        body: secondaryBody,
      },
    });
  }

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body,
    actions: actions.length > 0 ? actions : undefined,
  };
}
