import type { ScenarioName } from "@shared/mock-data";
import type { FullInvestigationResult } from "@oncall/hypothesis-validator";
import type { BotAdapter } from "./adapter";
import type { MessageContext, ActionContext } from "./types";
import { parseAlert, type ParseOptions } from "./alert-parser";
import { formatToolName, formatSummary, toInvestigationBlocks } from "./formatters";

// ── In-memory stores ───────────────────────────────────────────────────

/** Maps `${channelId}-${messageId}` → investigation result for action handlers. */
export const investigationStore = new Map<string, FullInvestigationResult>();

/** Maps `${channelId}-${threadId}` → service info for pending rejection flows. */
export const pendingRejections = new Map<string, { service: string; alertId: string }>();

// ── Scenario detection ─────────────────────────────────────────────────

const SCENARIO_KEYWORDS: Record<string, ScenarioName> = {
  "payment-service":   "deploy-regression",
  "deploy-regression": "deploy-regression",
  "order-service":     "upstream-failure",
  "upstream-failure":  "upstream-failure",
  "fraud-service":     "no-clear-cause",
  "no-clear-cause":    "no-clear-cause",
};

function detectScenario(service: string, text: string): ScenarioName {
  const lower = (service + " " + text).toLowerCase();
  for (const [kw, scenario] of Object.entries(SCENARIO_KEYWORDS)) {
    if (lower.includes(kw)) return scenario;
  }
  return "deploy-regression";
}

// ── Severity helper ────────────────────────────────────────────────────

function severityToP(severity: string): "P1" | "P2" | "P3" | "P4" {
  switch (severity.toLowerCase()) {
    case "critical": return "P1";
    case "high":     return "P2";
    case "medium":   return "P3";
    case "low":      return "P4";
    default:         return "P2";
  }
}

// ── Options ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export interface OrchestratorOptions {
  serviceGraphUrl?: string;
  parseOptions?: ParseOptions;
  /** Injected Anthropic client for investigation (used in tests). */
  _investigationClient?: AnyClient;
  /** Injected Anthropic client for validation (used in tests). */
  _validationClient?: AnyClient;
}

// ── handleIncidentMention ──────────────────────────────────────────────

export async function handleIncidentMention(
  text: string,
  ctx: MessageContext,
  adapter: BotAdapter,
  opts: OrchestratorOptions = {}
): Promise<void> {
  // 1. Post initial status
  const { messageId: statusId } = await adapter.postMessage(ctx, {
    text: "🔍 Parsing alert...",
  });

  // 2. Parse alert
  let alert;
  try {
    alert = await parseAlert(text, {
      ...opts.parseOptions,
      source: ctx.platform,
    });
    alert.labels.channel = ctx.channelId;
  } catch (err) {
    await adapter.updateMessage(ctx, statusId, {
      text: `❌ Failed to parse alert: ${(err as Error).message}`,
    });
    return;
  }

  const scenario = detectScenario(alert.service, text);

  await adapter.updateMessage(ctx, statusId, {
    text: `🔍 Investigating *${alert.service}* (${alert.severity})...\n_Gathering evidence..._`,
  });

  // 3. Run investigation with live progress updates
  const completedTools: string[] = [];
  const investigationStart = Date.now();

  let investigation;
  try {
    const { investigate } = await import("@oncall/investigation-agent");
    investigation = await investigate(alert, {
      scenario,
      serviceGraphUrl: opts.serviceGraphUrl,
      client: opts._investigationClient,
      onToolCall: async (toolNames: string[]) => {
        completedTools.push(...toolNames.map(formatToolName));
        const lines = completedTools.map((t) => `✓ ${t}`).join("\n");
        await safeUpdate(adapter, ctx, statusId,
          `🔍 Investigating *${alert.service}*...\n${lines}`);
      },
    });
  } catch (err) {
    await adapter.updateMessage(ctx, statusId, {
      text: `❌ Investigation failed: ${(err as Error).message}\n_Please investigate manually or try again._`,
    });
    return;
  }

  const investigationDurationMs = Date.now() - investigationStart;

  if (investigation.status === "failed") {
    await adapter.updateMessage(ctx, statusId, {
      text: `❌ Investigation failed: ${investigation.summary ?? "unknown error"}\n_Please investigate manually._`,
    });
    return;
  }

  // 4. Run validation
  await safeUpdate(adapter, ctx, statusId,
    `🧪 Validating hypotheses...\n${completedTools.map((t) => `✓ ${t}`).join("\n")}`);

  const validationStart = Date.now();
  let validation;
  try {
    const { validate } = await import("@oncall/hypothesis-validator");
    validation = await validate(investigation, { client: opts._validationClient });
  } catch (err) {
    await adapter.updateMessage(ctx, statusId, {
      text: `❌ Validation failed: ${(err as Error).message}`,
    });
    return;
  }

  const validationDurationMs = Date.now() - validationStart;

  // 5. Assemble result and post
  const { rerankHypotheses } = await import("@oncall/hypothesis-validator");
  const finalHypotheses = rerankHypotheses(validation.validated_hypotheses);

  const fullResult: FullInvestigationResult = {
    alert,
    investigation,
    validation,
    final_hypotheses: finalHypotheses,
    escalate: validation.escalate,
    investigation_duration_ms: investigationDurationMs,
    validation_duration_ms: validationDurationMs,
    total_duration_ms: investigationDurationMs + validationDurationMs,
  };

  if (validation.escalate) {
    await safeUpdate(adapter, ctx, statusId,
      `🚨 *Escalation required* — ${validation.escalation_reason ?? "low confidence investigation"}`);
  } else {
    await safeUpdate(adapter, ctx, statusId, `✅ *Investigation complete*`);
  }

  const { messageId: resultId } = await adapter.postMessage(ctx, {
    text: formatSummary(fullResult),
    blocks: toInvestigationBlocks(fullResult, completedTools.length),
  });

  investigationStore.set(`${ctx.channelId}-${resultId}`, fullResult);
}

// ── handleConfirm ──────────────────────────────────────────────────────

export async function handleConfirm(
  ctx: ActionContext,
  adapter: BotAdapter,
): Promise<void> {
  await adapter.postMessage(ctx, {
    text: `✅ Thanks <@${ctx.userId}>! Storing this as a confirmed resolution...`,
  });

  const result = investigationStore.get(`${ctx.channelId}-${ctx.messageId}`);
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
      preventionNotes: `Confirmed via ${ctx.platform} by <@${ctx.userId}>`,
    });
  }
}

// ── handleReject ───────────────────────────────────────────────────────

export async function handleReject(
  ctx: ActionContext,
  adapter: BotAdapter,
): Promise<void> {
  const result = investigationStore.get(`${ctx.channelId}-${ctx.messageId}`);

  pendingRejections.set(`${ctx.channelId}-${ctx.threadId}`, {
    service: result?.alert.service ?? "",
    alertId: result?.alert.id ?? "",
  });

  await adapter.postMessage(ctx, {
    text: `❌ Got it — what was the actual root cause? _(Reply in this thread and I'll re-investigate with your correction.)_`,
  });
}

// ── handleInvestigateMore ──────────────────────────────────────────────

export async function handleInvestigateMore(
  ctx: ActionContext,
  adapter: BotAdapter,
  opts: OrchestratorOptions = {}
): Promise<void> {
  const result = investigationStore.get(`${ctx.channelId}-${ctx.messageId}`);
  if (!result) {
    await adapter.postMessage(ctx, {
      text: "❌ Could not find original investigation context. Please re-investigate manually.",
    });
    return;
  }

  const { messageId: statusId } = await adapter.postMessage(ctx, {
    text: "🔍 Running deeper investigation...",
  });

  // Build context hint from previous findings
  const top = result.final_hypotheses[0];
  const origH = top ? result.investigation.hypotheses[top.original_rank - 1] : undefined;
  const contextHint = [
    `Previous investigation found:`,
    origH ? `• Root cause (${top!.revised_confidence}% confidence): ${origH.description}` : "",
    result.investigation.summary ? `• Summary: ${result.investigation.summary}` : "",
    ``,
    `Engineer <@${ctx.userId}> requested deeper analysis. Please gather more evidence and refine the hypothesis.`,
  ].filter(Boolean).join("\n");

  const completedTools: string[] = [];

  try {
    const { investigate } = await import("@oncall/investigation-agent");
    const { validate, rerankHypotheses } = await import("@oncall/hypothesis-validator");

    const invStart = Date.now();
    const investigation = await investigate(result.alert, {
      scenario: detectScenario(result.alert.service, ""),
      maxIterations: 15,
      contextHint,
      client: opts._investigationClient,
      onToolCall: async (toolNames: string[]) => {
        completedTools.push(...toolNames.map(formatToolName));
        const lines = completedTools.map((t) => `✓ ${t}`).join("\n");
        await safeUpdate(adapter, ctx, statusId,
          `🔍 Deeper investigation of *${result.alert.service}*...\n${lines}`);
      },
    });
    const invDuration = Date.now() - invStart;

    if (investigation.status === "failed") {
      await adapter.updateMessage(ctx, statusId, {
        text: `❌ Deeper investigation failed: ${investigation.summary ?? "unknown error"}`,
      });
      return;
    }

    await adapter.updateMessage(ctx, statusId, {
      text: `🧪 Validating hypotheses...\n${completedTools.map((t) => `✓ ${t}`).join("\n")}`,
    });

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
      await adapter.updateMessage(ctx, statusId, {
        text: `🚨 *Escalation required* — ${validation.escalation_reason ?? "low confidence"}`,
      });
    } else {
      await adapter.updateMessage(ctx, statusId, {
        text: `✅ *Deeper investigation complete*`,
      });
    }

    const { messageId: newId } = await adapter.postMessage(ctx, {
      text: formatSummary(newResult),
      blocks: toInvestigationBlocks(newResult, completedTools.length),
    });

    investigationStore.set(`${ctx.channelId}-${newId}`, newResult);
  } catch (err) {
    await adapter.updateMessage(ctx, statusId, {
      text: `❌ Deeper investigation failed: ${(err as Error).message}`,
    });
  }
}

// ── handleRejectionReply ───────────────────────────────────────────────

export async function handleRejectionReply(
  correctionText: string,
  ctx: MessageContext,
  adapter: BotAdapter,
  opts: OrchestratorOptions = {}
): Promise<void> {
  const key = `${ctx.channelId}-${ctx.threadId}`;
  const pending = pendingRejections.get(key);
  if (!pending) return;

  pendingRejections.delete(key);

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
    preventionNotes: `Corrected by <@${ctx.userId}>`,
  });

  await adapter.postMessage(ctx, {
    text: `Thanks <@${ctx.userId}>! Stored your correction. Re-investigating with this context...`,
  });

  const { messageId: statusId } = await adapter.postMessage(ctx, {
    text: "🔍 Re-investigating...",
  });

  const completedTools: string[] = [];
  const contextHint = `Human engineer correction: "${correctionText}"\n\nPlease investigate with this correction in mind.`;

  try {
    const { investigate } = await import("@oncall/investigation-agent");
    const { validate, rerankHypotheses } = await import("@oncall/hypothesis-validator");

    const alert = await parseAlert(pending.service, {
      ...opts.parseOptions,
      source: ctx.platform,
    });
    alert.labels.channel = ctx.channelId;

    const invStart = Date.now();
    const investigation = await investigate(alert, {
      scenario: "deploy-regression" as ScenarioName,
      contextHint,
      client: opts._investigationClient,
      onToolCall: async (toolNames: string[]) => {
        completedTools.push(...toolNames.map(formatToolName));
        const lines = completedTools.map((t) => `✓ ${t}`).join("\n");
        await safeUpdate(adapter, ctx, statusId,
          `🔍 Re-investigating *${pending.service}*...\n${lines}`);
      },
    });
    const invDuration = Date.now() - invStart;

    if (investigation.status === "failed") {
      await adapter.updateMessage(ctx, statusId, {
        text: `❌ Re-investigation failed: ${investigation.summary ?? "unknown"}`,
      });
      return;
    }

    await adapter.updateMessage(ctx, statusId, {
      text: `🧪 Validating...\n${completedTools.map((t) => `✓ ${t}`).join("\n")}`,
    });

    const valStart = Date.now();
    const validation = await validate(investigation, { client: opts._validationClient });
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
      await adapter.updateMessage(ctx, statusId, {
        text: `🚨 *Escalation required* — ${validation.escalation_reason ?? "low confidence"}`,
      });
    } else {
      await adapter.updateMessage(ctx, statusId, {
        text: `✅ *Re-investigation complete*`,
      });
    }

    const { messageId: newId } = await adapter.postMessage(ctx, {
      text: formatSummary(newResult),
      blocks: toInvestigationBlocks(newResult, completedTools.length),
    });

    investigationStore.set(`${ctx.channelId}-${newId}`, newResult);
  } catch (err) {
    await adapter.updateMessage(ctx, statusId, {
      text: `❌ Re-investigation failed: ${(err as Error).message}`,
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

async function safeUpdate(
  adapter: BotAdapter,
  ctx: MessageContext,
  messageId: string,
  text: string
): Promise<void> {
  try {
    await adapter.updateMessage(ctx, messageId, { text });
  } catch {
    // If update fails (e.g. message deleted), silently continue
  }
}
