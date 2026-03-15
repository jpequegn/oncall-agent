import type { ValidatedHypothesis } from "@oncall/hypothesis-validator";
import type { Hypothesis } from "@shared/types";
import type { InvestigationBlocks } from "@oncall/bot-core";
import { ACTIONS, formatDuration } from "@oncall/bot-core";

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

// ── renderBlockKit: InvestigationBlocks → Slack Block Kit ────────────────

export function renderBlockKit(data: InvestigationBlocks): Block[] {
  const { alert, hypotheses, originalHypotheses, investigation, validation, escalate, duration_ms } = data;
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
      text: `*Duration:* ${formatDuration(duration_ms)}  ·  *Severity:* ${alert.severity.toUpperCase()}  ·  *Status:* ${investigation.status}`,
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
  if (hypotheses.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No hypotheses generated._" },
    });
  } else {
    hypotheses.forEach((vh, i) => {
      const origH = originalHypotheses[vh.original_rank - 1];
      const isTop = i === 0;
      blocks.push(...hypothesisBlocks(vh, origH, i + 1, isTop));
      if (i < hypotheses.length - 1) blocks.push({ type: "divider" });
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

  // Action buttons (only when not escalating)
  if (!escalate && hypotheses.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "👍 Correct", emoji: true },
          value: "confirm",
          action_id: ACTIONS.CONFIRM,
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Wrong", emoji: true },
          value: "reject",
          action_id: ACTIONS.REJECT,
          style: "danger",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔍 Dig deeper", emoji: true },
          value: "investigate_more",
          action_id: ACTIONS.INVESTIGATE_MORE,
        },
      ],
    });
  }

  return blocks;
}

// ── renderPlainText: InvestigationBlocks → string ───────────────────────

export function renderPlainText(data: InvestigationBlocks): string {
  const top = data.hypotheses[0];
  const origH = top ? data.originalHypotheses[top.original_rank - 1] : undefined;

  if (data.escalate) {
    return `⚠️ Escalation required: ${data.validation.escalation_reason ?? "low confidence"}\n${data.investigation.summary ?? ""}`;
  }

  return [
    data.investigation.summary ?? `Investigation complete for ${data.alert.service}`,
    origH ? `Root cause (${top!.revised_confidence}% confidence): ${origH.description}` : "",
    origH?.suggestedActions[0] ? `Action: ${origH.suggestedActions[0]}` : "",
  ].filter(Boolean).join("\n");
}

// ── Legacy exports (used by existing action handler tests) ──────────────

/** @deprecated Use renderBlockKit instead */
export function formatInvestigationResult(result: {
  alert: InvestigationBlocks["alert"];
  investigation: InvestigationBlocks["investigation"];
  validation: InvestigationBlocks["validation"];
  final_hypotheses: InvestigationBlocks["hypotheses"];
  escalate: boolean;
  total_duration_ms: number;
}): Block[] {
  return renderBlockKit({
    type: "investigation_result",
    alert: result.alert,
    hypotheses: result.final_hypotheses,
    originalHypotheses: result.investigation.hypotheses,
    investigation: result.investigation,
    validation: result.validation,
    timeline: [],
    duration_ms: result.total_duration_ms,
    tool_call_count: 0,
    escalate: result.escalate,
  });
}

/** @deprecated Use renderPlainText instead */
export function formatPlainText(result: {
  alert: InvestigationBlocks["alert"];
  investigation: InvestigationBlocks["investigation"];
  validation: InvestigationBlocks["validation"];
  final_hypotheses: InvestigationBlocks["hypotheses"];
  escalate: boolean;
  total_duration_ms: number;
}): string {
  return renderPlainText({
    type: "investigation_result",
    alert: result.alert,
    hypotheses: result.final_hypotheses,
    originalHypotheses: result.investigation.hypotheses,
    investigation: result.investigation,
    validation: result.validation,
    timeline: [],
    duration_ms: result.total_duration_ms,
    tool_call_count: 0,
    escalate: result.escalate,
  });
}
