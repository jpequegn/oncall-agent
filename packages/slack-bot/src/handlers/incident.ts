import type { App } from "@slack/bolt";
import type { ScenarioName } from "@shared/mock-data";
import { parseAlert } from "../alert-parser";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAnthropicClient = any;

// ── Tool name formatter ────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  query_metrics:     "Queried service metrics",
  search_logs:       "Searched error logs",
  get_recent_deploys:"Checked recent deploys",
  get_service_deps:  "Mapped service dependencies",
  get_past_incidents:"Reviewed past incidents",
  search_runbooks:   "Searched runbooks",
};

export function formatToolName(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

// ── Scenario detection ─────────────────────────────────────────────────────

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

// ── Main handler ───────────────────────────────────────────────────────────

export interface HandleIncidentOptions {
  text: string;
  channelId: string;
  threadTs: string;
  app: App;
  serviceGraphUrl?: string;
  /** Injected Anthropic clients for testing. */
  _investigationClient?: AnyAnthropicClient;
  _validationClient?: AnyAnthropicClient;
}

export async function handleIncident(opts: HandleIncidentOptions): Promise<void> {
  const { text, channelId, threadTs, app, serviceGraphUrl, _investigationClient, _validationClient } = opts;

  // 1. Post initial status message
  const statusMsg = await app.client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: "🔍 Parsing alert...",
  });
  const statusTs = statusMsg.ts!;

  // 2. Parse alert
  let alert;
  try {
    alert = await parseAlert(text);
    alert.labels.channel = channelId;
  } catch (err) {
    await safeUpdate(app, channelId, statusTs,
      `❌ Failed to parse alert: ${(err as Error).message}`);
    return;
  }

  const scenario = detectScenario(alert.service, text);

  await safeUpdate(app, channelId, statusTs,
    `🔍 Investigating *${alert.service}* (${alert.severity})...\n_Gathering evidence..._`);

  // 3. Run investigation with live progress updates
  const completedTools: string[] = [];

  let investigation;
  try {
    const { investigate } = await import("@oncall/investigation-agent");
    investigation = await investigate(alert, {
      scenario,
      serviceGraphUrl,
      client: _investigationClient,
      onToolCall: async (toolNames) => {
        completedTools.push(...toolNames.map(formatToolName));
        const lines = completedTools.map((t) => `✓ ${t}`).join("\n");
        await safeUpdate(app, channelId, statusTs,
          `🔍 Investigating *${alert.service}*...\n${lines}`);
      },
    });
  } catch (err) {
    await safeUpdate(app, channelId, statusTs,
      `❌ Investigation failed: ${(err as Error).message}\n_Please investigate manually or try again._`);
    return;
  }

  if (investigation.status === "failed") {
    await safeUpdate(app, channelId, statusTs,
      `❌ Investigation failed: ${investigation.summary ?? "unknown error"}\n_Please investigate manually._`);
    return;
  }

  // 4. Run validation
  await safeUpdate(app, channelId, statusTs,
    `🧪 Validating hypotheses...\n${completedTools.map((t) => `✓ ${t}`).join("\n")}`);

  let validation;
  try {
    const { validate } = await import("@oncall/hypothesis-validator");
    validation = await validate(investigation, { client: _validationClient });
  } catch (err) {
    await safeUpdate(app, channelId, statusTs,
      `❌ Validation failed: ${(err as Error).message}`);
    return;
  }

  // 5. Post final result
  const { rerankHypotheses } = await import("@oncall/hypothesis-validator");
  const finalHypotheses = rerankHypotheses(validation.validated_hypotheses);
  const top = finalHypotheses[0];
  const topOriginal = top ? investigation.hypotheses[top.original_rank - 1] : undefined;

  if (validation.escalate) {
    await safeUpdate(app, channelId, statusTs,
      `🚨 *Escalation required* — ${validation.escalation_reason ?? "low confidence investigation"}`);
    await app.client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: formatEscalationResult(investigation.summary, finalHypotheses, investigation, validation.validator_notes),
    });
  } else {
    await safeUpdate(app, channelId, statusTs, `✅ *Investigation complete*`);
    await app.client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: formatSuccessResult(top, topOriginal, investigation.summary, validation.validator_notes),
    });
  }
}

// ── Formatters ─────────────────────────────────────────────────────────────

function confidenceBar(n: number): string {
  return "█".repeat(Math.round(n / 10)) + "░".repeat(10 - Math.round(n / 10));
}

function formatSuccessResult(
  top: ReturnType<typeof import("@oncall/hypothesis-validator").rerankHypotheses>[number] | undefined,
  topOriginal: import("@shared/types").Hypothesis | undefined,
  summary: string | undefined,
  validatorNotes: string
): string {
  const conf = top?.revised_confidence ?? 0;
  const bar = confidenceBar(conf);
  const lines = [
    summary ? `📢 ${summary}` : "",
    "",
    `*Root cause* (${conf}% confidence) \`${bar}\``,
    topOriginal ? `>${topOriginal.description}` : "",
    "",
    topOriginal?.suggestedActions[0] ? `*Action:* ${topOriginal.suggestedActions[0]}` : "",
    "",
    `_🔬 ${validatorNotes}_`,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

function formatEscalationResult(
  summary: string | undefined,
  finalHypotheses: ReturnType<typeof import("@oncall/hypothesis-validator").rerankHypotheses>,
  investigation: import("@shared/types").InvestigationResult,
  validatorNotes: string
): string {
  const lines: string[] = [
    summary ? `📢 ${summary}` : "",
    "",
    "*Hypotheses (low confidence — human review needed):*",
  ];
  for (const vh of finalHypotheses.slice(0, 3)) {
    const orig = investigation.hypotheses[vh.original_rank - 1];
    lines.push(`• ${orig?.description ?? "unknown"} _(${vh.revised_confidence}% revised)_`);
  }
  lines.push("", `_🔬 ${validatorNotes}_`);
  return lines.filter((l) => l !== "").join("\n");
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function safeUpdate(app: App, channel: string, ts: string, text: string): Promise<void> {
  try {
    await app.client.chat.update({ channel, ts, text });
  } catch {
    // If update fails (e.g. message deleted), silently continue
  }
}
