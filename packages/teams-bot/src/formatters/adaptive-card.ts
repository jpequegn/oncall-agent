import type { InvestigationBlocks } from "@oncall/bot-core";
import { ACTIONS, formatDuration } from "@oncall/bot-core";

/**
 * Render InvestigationBlocks as an Adaptive Card JSON payload.
 * This is the Teams-specific counterpart of Slack's renderBlockKit.
 */
export function renderAdaptiveCard(data: InvestigationBlocks): Record<string, unknown> {
  const { alert, hypotheses, originalHypotheses, investigation, validation, escalate, duration_ms } = data;

  const body: Record<string, unknown>[] = [];

  // Header
  body.push({
    type: "TextBlock",
    text: `📊 Investigation: ${alert.service}`,
    size: "Large",
    weight: "Bolder",
  });

  // Meta line
  body.push({
    type: "TextBlock",
    text: `**Duration:** ${formatDuration(duration_ms)}  ·  **Severity:** ${alert.severity.toUpperCase()}  ·  **Status:** ${investigation.status}`,
    spacing: "Small",
  });

  // Escalation banner
  if (escalate) {
    body.push({
      type: "TextBlock",
      text: `⚠️ **Escalation required** — ${validation.escalation_reason ?? "Low-confidence investigation. Human review needed."}`,
      color: "Attention",
      spacing: "Medium",
    });
  }

  // Summary
  if (investigation.summary) {
    body.push({ type: "TextBlock", text: `📢 ${investigation.summary}`, wrap: true, spacing: "Medium" });
  }

  // Separator
  body.push({ type: "TextBlock", text: "───", spacing: "Small" });

  // Hypotheses
  if (hypotheses.length === 0) {
    body.push({ type: "TextBlock", text: "_No hypotheses generated._", isSubtle: true });
  } else {
    hypotheses.forEach((vh, i) => {
      const origH = originalHypotheses[vh.original_rank - 1];
      const isTop = i === 0;
      const emoji = vh.revised_confidence >= 80 ? "🟢" : vh.revised_confidence >= 50 ? "🟡" : "🔴";
      const label = isTop ? `**Hypothesis #${i + 1}** ${emoji}` : `Hypothesis #${i + 1} ${emoji}`;

      body.push({
        type: "TextBlock",
        text: `${label} · Confidence: **${vh.original_confidence}%** → **${vh.revised_confidence}%** _(challenge: ${vh.challenge_score}/100)_`,
        wrap: true,
        spacing: i === 0 ? "Medium" : "Small",
      });

      if (origH) {
        body.push({
          type: "TextBlock",
          text: `> ${origH.description}`,
          wrap: true,
          spacing: "None",
        });
      }

      if (isTop && origH?.evidence.length) {
        const evidence = origH.evidence.slice(0, 5).map((e) => `• ${e}`).join("\n");
        body.push({
          type: "TextBlock",
          text: `**Evidence:**\n${evidence}`,
          wrap: true,
          spacing: "Small",
        });
      }

      if (isTop && vh.key_objections.length) {
        body.push({
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
          body.push({ type: "TextBlock", text: actionText, wrap: true, spacing: "Small" });
        }
      }
    });
  }

  // Validator notes
  if (validation.validator_notes) {
    body.push({ type: "TextBlock", text: "───", spacing: "Small" });
    body.push({
      type: "TextBlock",
      text: `🔬 _${validation.validator_notes}_`,
      isSubtle: true,
      wrap: true,
    });
  }

  // Action buttons (only when not escalating)
  const actions: Record<string, unknown>[] = [];
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

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body,
    actions: actions.length > 0 ? actions : undefined,
  };
}
