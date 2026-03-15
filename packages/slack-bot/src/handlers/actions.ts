import type { App } from "@slack/bolt";
import type { FullInvestigationResult } from "@oncall/hypothesis-validator";
import type { Block } from "../formatters/investigation";
import { formatInvestigationResult, formatPlainText } from "../formatters/investigation";

// ── In-memory stores ───────────────────────────────────────────────────────

/**
 * Maps `${channel}-${messageTs}` → FullInvestigationResult so action
 * handlers can access the original investigation context.
 */
export const investigationStore = new Map<string, FullInvestigationResult>();

/**
 * Maps `${channel}-${threadTs}` → service name for pending rejection flows.
 * When set, the next message in that thread is treated as the correction.
 */
export const pendingRejections = new Map<string, { service: string; alertId: string }>();

// ── Button-disable helper ──────────────────────────────────────────────────

/**
 * Replace the actions block in a message with a plain confirmation notice.
 * Returns the updated blocks array (with the actions block removed).
 */
function disableButtons(originalBlocks: Block[], notice: string): Block[] {
  const withoutActions = originalBlocks.filter((b) => b.type !== "actions");
  withoutActions.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: notice }],
  });
  return withoutActions;
}

// ── Register all action handlers ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export interface ActionHandlerOptions {
  /** Injected Anthropic client for investigation (used in tests). */
  _investigationClient?: AnyClient;
  /** Injected Anthropic client for validation (used in tests). */
  _validationClient?: AnyClient;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerActionHandlers(app: App, opts: ActionHandlerOptions = {}): void {

  // ── 👍 Confirm ────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.action("hypothesis_confirm", async ({ ack, body, client }: any) => {
    await ack();

    const channel: string = body.container?.channel_id ?? body.channel?.id ?? "";
    const messageTs: string = body.container?.message_ts ?? body.message?.ts ?? "";
    const threadTs: string = body.message?.thread_ts ?? messageTs;
    const userId: string = body.user?.id ?? "unknown";

    // Acknowledge in thread
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `✅ Thanks <@${userId}>! Storing this as a confirmed resolution...`,
    });

    // Persist to knowledge base
    const result = investigationStore.get(`${channel}-${messageTs}`);
    if (result) {
      const { addMockIncident } = await import("@shared/mock-data");
      const top = result.final_hypotheses[0];
      const origH = top ? result.investigation.hypotheses[top.original_rank - 1] : undefined;
      addMockIncident({
        id: `inc-confirmed-${Date.now()}`,
        title: result.alert.title,
        severity: severityToP(result.alert.severity),
        services: [result.alert.service],
        occurredAt: result.alert.timestamp.toISOString(),
        resolvedAt: new Date().toISOString(),
        durationMinutes: Math.round(result.total_duration_ms / 60_000),
        rootCause: origH?.description ?? result.investigation.rootCause ?? "Unknown",
        resolution: origH?.suggestedActions[0] ?? result.investigation.resolution ?? "Unknown",
        preventionNotes: `Confirmed via Slack by <@${userId}>`,
      });
    }

    // Disable buttons on original message
    const originalBlocks = (body.message?.blocks ?? []) as Block[];
    await client.chat.update({
      channel,
      ts: messageTs,
      text: formatPlainText(result!),
      blocks: disableButtons(originalBlocks, `✅ *Confirmed* by <@${userId}>`),
    });
  });

  // ── ❌ Reject ─────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.action("hypothesis_reject", async ({ ack, body, client }: any) => {
    await ack();

    const channel: string = body.container?.channel_id ?? body.channel?.id ?? "";
    const messageTs: string = body.container?.message_ts ?? body.message?.ts ?? "";
    const threadTs: string = body.message?.thread_ts ?? messageTs;

    const result = investigationStore.get(`${channel}-${messageTs}`);

    // Register pending rejection so the next thread message triggers re-investigation
    pendingRejections.set(`${channel}-${threadTs}`, {
      service: result?.alert.service ?? "",
      alertId: result?.alert.id ?? "",
    });

    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `❌ Got it — what was the actual root cause? _(Reply in this thread and I'll re-investigate with your correction.)_`,
    });

    // Disable buttons on original message
    const originalBlocks = (body.message?.blocks ?? []) as Block[];
    const userId: string = body.user?.id ?? "unknown";
    await client.chat.update({
      channel,
      ts: messageTs,
      text: result ? formatPlainText(result) : "",
      blocks: disableButtons(originalBlocks, `❌ *Rejected* by <@${userId}> — awaiting correction`),
    });
  });

  // ── 🔍 Dig deeper ─────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.action("investigate_more", async ({ ack, body, client }: any) => {
    await ack();

    const channel: string = body.container?.channel_id ?? body.channel?.id ?? "";
    const messageTs: string = body.container?.message_ts ?? body.message?.ts ?? "";
    const threadTs: string = body.message?.thread_ts ?? messageTs;

    const result = investigationStore.get(`${channel}-${messageTs}`);
    if (!result) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "❌ Could not find original investigation context. Please re-investigate manually.",
      });
      return;
    }

    // Disable buttons immediately
    const originalBlocks = (body.message?.blocks ?? []) as Block[];
    const userId: string = body.user?.id ?? "unknown";
    await client.chat.update({
      channel,
      ts: messageTs,
      text: formatPlainText(result),
      blocks: disableButtons(originalBlocks, `🔍 *Deeper investigation* requested by <@${userId}>`),
    });

    // Post status message
    const statusMsg = await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "🔍 Running deeper investigation...",
    });
    const statusTs: string = statusMsg.ts!;

    // Build context hint from previous findings
    const top = result.final_hypotheses[0];
    const origH = top ? result.investigation.hypotheses[top.original_rank - 1] : undefined;
    const contextHint = [
      `Previous investigation found:`,
      origH ? `• Root cause (${top!.revised_confidence}% confidence): ${origH.description}` : "",
      result.investigation.summary ? `• Summary: ${result.investigation.summary}` : "",
      ``,
      `Engineer <@${userId}> requested deeper analysis. Please gather more evidence and refine the hypothesis.`,
    ].filter(Boolean).join("\n");

    const completedTools: string[] = [];

    try {
      const { investigate } = await import("@oncall/investigation-agent");
      const { validate, rerankHypotheses } = await import("@oncall/hypothesis-validator");

      const detectScenario = (service: string): import("@shared/mock-data").ScenarioName => {
        const lower = service.toLowerCase();
        if (lower.includes("payment")) return "deploy-regression";
        if (lower.includes("order")) return "upstream-failure";
        return "deploy-regression";
      };

      const invStart = Date.now();
      const investigation = await investigate(result.alert, {
        scenario: detectScenario(result.alert.service),
        maxIterations: 15,
        contextHint,
        client: opts._investigationClient,
        onToolCall: async (toolNames) => {
          const { formatToolName } = await import("./incident");
          completedTools.push(...toolNames.map(formatToolName));
          const lines = completedTools.map((t) => `✓ ${t}`).join("\n");
          try {
            await client.chat.update({
              channel, ts: statusTs,
              text: `🔍 Deeper investigation of *${result.alert.service}*...\n${lines}`,
            });
          } catch { /* deleted message */ }
        },
      });
      const invDuration = Date.now() - invStart;

      if (investigation.status === "failed") {
        await client.chat.update({ channel, ts: statusTs,
          text: `❌ Deeper investigation failed: ${investigation.summary ?? "unknown error"}` });
        return;
      }

      await client.chat.update({ channel, ts: statusTs,
        text: `🧪 Validating hypotheses...\n${completedTools.map((t) => `✓ ${t}`).join("\n")}` });

      const valStart = Date.now();
      const validation = await validate(investigation, { client: opts._validationClient });
      const valDuration = Date.now() - valStart;

      const finalHypotheses = rerankHypotheses(validation.validated_hypotheses);
      const newResult: FullInvestigationResult = {
        alert: result.alert,
        investigation,
        validation,
        final_hypotheses: finalHypotheses,
        escalate: validation.escalate,
        investigation_duration_ms: invDuration,
        validation_duration_ms: valDuration,
        total_duration_ms: invDuration + valDuration,
      };

      if (validation.escalate) {
        await client.chat.update({ channel, ts: statusTs,
          text: `🚨 *Escalation required* — ${validation.escalation_reason ?? "low confidence"}` });
      } else {
        await client.chat.update({ channel, ts: statusTs, text: `✅ *Deeper investigation complete*` });
      }

      const newMsg = await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: formatPlainText(newResult),
        blocks: formatInvestigationResult(newResult),
      });

      if (newMsg.ts) {
        investigationStore.set(`${channel}-${newMsg.ts}`, newResult);
      }
    } catch (err) {
      await client.chat.update({ channel, ts: statusTs,
        text: `❌ Deeper investigation failed: ${(err as Error).message}` });
    }
  });
}

// ── Handle pending rejection replies ──────────────────────────────────────

export async function handlePendingRejection(
  app: App,
  channel: string,
  threadTs: string,
  correctionText: string,
  userId: string
): Promise<void> {
  const pending = pendingRejections.get(`${channel}-${threadTs}`);
  if (!pending) return;

  pendingRejections.delete(`${channel}-${threadTs}`);

  // Store the correction in the knowledge base
  const { addMockIncident } = await import("@shared/mock-data");
  addMockIncident({
    id: `inc-correction-${Date.now()}`,
    title: `Human correction for ${pending.service}`,
    severity: "P2",
    services: [pending.service],
    occurredAt: new Date().toISOString(),
    resolvedAt: new Date().toISOString(),
    durationMinutes: 0,
    rootCause: correctionText,
    resolution: "Human-provided correction",
    preventionNotes: `Corrected by <@${userId}>`,
  });

  await app.client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: `Thanks <@${userId}>! Stored your correction. Re-investigating with this context...`,
  });

  // Re-investigate with the correction as context
  const statusMsg = await app.client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: "🔍 Re-investigating...",
  });
  const statusTs = statusMsg.ts!;

  const completedTools: string[] = [];

  try {
    const { investigate } = await import("@oncall/investigation-agent");
    const { validate, rerankHypotheses } = await import("@oncall/hypothesis-validator");
    const { parseAlert } = await import("../alert-parser");

    const alert = await parseAlert(pending.service);
    alert.labels.channel = channel;

    const contextHint = `Human engineer correction: "${correctionText}"\n\nPlease investigate with this correction in mind.`;

    const invStart = Date.now();
    const investigation = await investigate(alert, {
      scenario: "deploy-regression",
      contextHint,
      onToolCall: async (toolNames) => {
        const { formatToolName } = await import("./incident");
        completedTools.push(...toolNames.map(formatToolName));
        const lines = completedTools.map((t) => `✓ ${t}`).join("\n");
        try {
          await app.client.chat.update({ channel, ts: statusTs,
            text: `🔍 Re-investigating *${pending.service}*...\n${lines}` });
        } catch { /* deleted */ }
      },
    });
    const invDuration = Date.now() - invStart;

    if (investigation.status === "failed") {
      await app.client.chat.update({ channel, ts: statusTs,
        text: `❌ Re-investigation failed: ${investigation.summary ?? "unknown"}` });
      return;
    }

    await app.client.chat.update({ channel, ts: statusTs,
      text: `🧪 Validating...\n${completedTools.map((t) => `✓ ${t}`).join("\n")}` });

    const valStart = Date.now();
    const validation = await validate(investigation, {});
    const valDuration = Date.now() - valStart;

    const finalHypotheses = rerankHypotheses(validation.validated_hypotheses);
    const newResult: FullInvestigationResult = {
      alert,
      investigation,
      validation,
      final_hypotheses: finalHypotheses,
      escalate: validation.escalate,
      investigation_duration_ms: invDuration,
      validation_duration_ms: valDuration,
      total_duration_ms: invDuration + valDuration,
    };

    if (validation.escalate) {
      await app.client.chat.update({ channel, ts: statusTs,
        text: `🚨 *Escalation required* — ${validation.escalation_reason ?? "low confidence"}` });
    } else {
      await app.client.chat.update({ channel, ts: statusTs, text: `✅ *Re-investigation complete*` });
    }

    const newMsg = await app.client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: formatPlainText(newResult),
      blocks: formatInvestigationResult(newResult),
    });

    if (newMsg.ts) {
      investigationStore.set(`${channel}-${newMsg.ts}`, newResult);
    }
  } catch (err) {
    await app.client.chat.update({ channel, ts: statusTs,
      text: `❌ Re-investigation failed: ${(err as Error).message}` });
  }
}

// ── Severity mapper ────────────────────────────────────────────────────────

function severityToP(severity: string): "P1" | "P2" | "P3" | "P4" {
  switch (severity.toLowerCase()) {
    case "critical": return "P1";
    case "high":     return "P2";
    case "medium":   return "P3";
    case "low":      return "P4";
    default:         return "P2";
  }
}
