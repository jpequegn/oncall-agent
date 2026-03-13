import type { FullInvestigationResult, ValidatedHypothesis } from "@oncall/hypothesis-validator";
import type { InvestigationResult, Hypothesis } from "@shared/types";

// ── Slack Block Kit types (minimal) ───────────────────────────────────────

export interface TextObject {
  type: "plain_text" | "mrkdwn";
  text: string;
  emoji?: boolean;
}

export interface HeaderBlock  { type: "header";  text: TextObject }
export interface DividerBlock { type: "divider" }
export interface SectionBlock { type: "section"; text: TextObject; accessory?: unknown }
export interface ContextBlock { type: "context"; elements: TextObject[] }
export interface ActionsBlock {
  type: "actions";
  elements: Array<{
    type: "button";
    text: TextObject;
    value: string;
    action_id: string;
    style?: "primary" | "danger";
  }>;
}

export type Block = HeaderBlock | DividerBlock | SectionBlock | ContextBlock | ActionsBlock;

// ── Duration formatter ─────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Confidence bar ─────────────────────────────────────────────────────────

function confidenceEmoji(pct: number): string {
  if (pct >= 80) return "🟢";
  if (pct >= 50) return "🟡";
  return "🔴";
}

// ── Evidence bullets ───────────────────────────────────────────────────────

const MAX_EVIDENCE = 5;

function formatEvidence(evidence: string[]): string {
  if (!evidence.length) return "_No specific evidence cited._";
  const shown = evidence.slice(0, MAX_EVIDENCE);
  const rest  = evidence.length - shown.length;
  const lines = shown.map((e) => `• ${e}`);
  if (rest > 0) lines.push(`_…and ${rest} more_`);
  return lines.join("\n");
}

// ── Hypothesis block builder ──────────────────────────────────────────────

function hypothesisBlocks(
  vh: ValidatedHypothesis,
  origH: Hypothesis | undefined,
  rank: number,
  isTop: boolean
): Block[] {
  const conf = vh.revised_confidence;
  const emoji = confidenceEmoji(conf);
  const label = isTop ? `*Hypothesis #${rank}* ${emoji}` : `Hypothesis #${rank} ${emoji}`;
  const header = `${label} · Confidence: *${vh.original_confidence}%* → *${conf}%* _(challenge: ${vh.challenge_score}/100)_`;
  const desc   = origH?.description ?? "No description available";

  const blocks: Block[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `${header}\n>${desc}` },
    },
  ];

  if (isTop && origH?.evidence.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Evidence:*\n${formatEvidence(origH.evidence)}` },
    });
  }

  if (isTop && vh.key_objections.length) {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `🔬 *Adversarial check:* ${vh.key_objections[0]}`,
      }],
    });
  }

  if (isTop && origH?.suggestedActions.length) {
    const runbook = origH.suggestedActions.find((a) => a.startsWith("http"));
    const action  = origH.suggestedActions.find((a) => !a.startsWith("http"));
    if (action) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Suggested action:* ${action}${runbook ? `\n*Runbook:* <${runbook}|docs>` : ""}` },
      });
    }
  }

  return blocks;
}

// ── Main formatter ─────────────────────────────────────────────────────────

export function formatInvestigationResult(result: FullInvestigationResult): Block[] {
  const { alert, investigation, validation, final_hypotheses, escalate, total_duration_ms } = result;
  const blocks: Block[] = [];

  // Header
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: `📊 Investigation: ${alert.service}`, emoji: true },
  });

  // Meta line
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Duration:* ${formatDuration(total_duration_ms)}  ·  *Severity:* ${alert.severity.toUpperCase()}  ·  *Status:* ${investigation.status}`,
    },
  });

  // Escalation banner
  if (escalate) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `⚠️ *Escalation required* — ${validation.escalation_reason ?? "Low-confidence investigation. Human review needed."}`,
      },
    });
  }

  // Summary
  if (investigation.summary) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `📢 ${investigation.summary}` },
    });
  }

  blocks.push({ type: "divider" });

  // Hypotheses
  if (final_hypotheses.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No hypotheses generated._" },
    });
  } else {
    final_hypotheses.forEach((vh, i) => {
      const origH = investigation.hypotheses[vh.original_rank - 1];
      const isTop = i === 0;
      blocks.push(...hypothesisBlocks(vh, origH, i + 1, isTop));
      if (i < final_hypotheses.length - 1) blocks.push({ type: "divider" });
    });
  }

  // Validator notes
  if (validation.validator_notes) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `🔬 _${validation.validator_notes}_` }],
    });
  }

  // Action buttons (only when not escalating — escalation means human takes over)
  if (!escalate && final_hypotheses.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "👍 Correct", emoji: true },
          value: "confirm",
          action_id: "hypothesis_confirm",
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Wrong", emoji: true },
          value: "reject",
          action_id: "hypothesis_reject",
          style: "danger",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔍 Dig deeper", emoji: true },
          value: "investigate_more",
          action_id: "investigate_more",
        },
      ],
    });
  }

  return blocks;
}

// ── Escalation-only formatter (for status message updates) ─────────────────

export function formatEscalationBlocks(result: FullInvestigationResult): Block[] {
  return formatInvestigationResult(result);
}

// ── Plain-text fallback (for notifications/unfurls) ───────────────────────

export function formatPlainText(result: FullInvestigationResult): string {
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
