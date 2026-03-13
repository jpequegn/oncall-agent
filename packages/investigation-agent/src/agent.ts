import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";
import type { Alert, InvestigationResult, Hypothesis } from "@shared/types";
import type { ScenarioName } from "@shared/mock-data";
import { executeTool, toolDefinitions } from "./tools/executor";
import type { ExecutorContext } from "./tools/types";

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 10;
const TIMEOUT_MS = 60_000;
const MODEL = "claude-sonnet-4-6";

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert Site Reliability Engineer investigating a production incident.
Your goal is to determine the most likely root cause and recommend a resolution.

Investigation process:
1. Normalize the alert: identify the service, severity, and timeframe
2. Gather evidence in parallel where possible using your available tools
3. Build a timeline correlating deploys, metric changes, and error patterns
4. Generate 2-3 ranked hypotheses with confidence scores (0-100%)
5. For each hypothesis, cite specific evidence

Output format — when you have enough evidence, respond with ONLY this JSON (no markdown, no extra text):
{
  "hypotheses": [
    {
      "rank": 1,
      "description": "...",
      "confidence": 85,
      "supporting_evidence": ["..."],
      "suggested_action": "...",
      "runbook_url": "..."
    }
  ],
  "timeline": [
    { "timestamp": "...", "event_type": "deploy|metric_spike|error_surge", "description": "..." }
  ],
  "summary": "One sentence summary for Slack"
}

Rules:
- Always check recent deploys and metrics first
- If a deploy correlates with a metric spike (within 5 minutes), confidence should be ≥80%
- If no deploy found and upstream dependency is degraded, focus on the dependency chain
- If evidence is inconclusive after exhausting tools, set top hypothesis confidence <50% and recommend human escalation
- Cite specific timestamps, commit SHAs, file names, or log messages as evidence`;

// ── Alert formatter ────────────────────────────────────────────────────────

function formatAlertMessage(alert: Alert, scenario: ScenarioName): string {
  return `🚨 INCIDENT ALERT

Alert ID: ${alert.id}
Service: ${alert.service}
Severity: ${alert.severity.toUpperCase()}
Fired at: ${alert.timestamp.toISOString()}
Title: ${alert.title}
${alert.description ? `Description: ${alert.description}` : ""}
${Object.keys(alert.labels).length ? `Labels: ${JSON.stringify(alert.labels)}` : ""}

Investigation scenario context: ${scenario}

Please investigate this incident. Use your tools to gather evidence, then produce your JSON report.`;
}

// ── Result parser ──────────────────────────────────────────────────────────

interface RawHypothesis {
  rank: number;
  description: string;
  confidence: number;
  supporting_evidence: string[];
  suggested_action: string;
  runbook_url?: string;
}

interface RawResult {
  hypotheses: RawHypothesis[];
  timeline: { timestamp: string; event_type: string; description: string }[];
  summary: string;
}

function parseInvestigationResult(
  raw: string,
  alert: Alert,
  startedAt: Date
): InvestigationResult {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  let parsed: RawResult;
  try {
    parsed = JSON.parse(cleaned) as RawResult;
  } catch {
    // Non-JSON final response — treat as summary with a single low-confidence hypothesis
    return {
      id: `inv-${Date.now()}`,
      alertId: alert.id,
      startedAt,
      completedAt: new Date(),
      status: "completed",
      hypotheses: [],
      summary: cleaned.slice(0, 500),
    };
  }

  const hypotheses: Hypothesis[] = (parsed.hypotheses ?? []).map((h) => ({
    id: `hyp-${h.rank}`,
    description: h.description,
    confidence: h.confidence,
    evidence: h.supporting_evidence ?? [],
    relatedServices: [],
    suggestedActions: [h.suggested_action, h.runbook_url].filter(Boolean) as string[],
  }));

  const top = hypotheses[0];

  return {
    id: `inv-${Date.now()}`,
    alertId: alert.id,
    startedAt,
    completedAt: new Date(),
    status: "completed",
    hypotheses,
    rootCause: top?.description,
    resolution: top?.suggestedActions[0],
    summary: parsed.summary,
  };
}

// ── Agent loop ─────────────────────────────────────────────────────────────

export interface InvestigateOptions {
  scenario: ScenarioName;
  serviceGraphUrl?: string;
  apiKey?: string;
  /** Inject a pre-configured Anthropic client (used in tests). */
  client?: Anthropic;
  /** Called after each batch of tool calls completes (for progress notifications). */
  onToolCall?: (toolNames: string[]) => Promise<void>;
}

export async function investigate(
  alert: Alert,
  opts: InvestigateOptions
): Promise<InvestigationResult> {
  const startedAt = new Date();
  const deadline = startedAt.getTime() + TIMEOUT_MS;

  const anthropic = opts.client ?? new Anthropic({
    apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
  });

  const ctx: ExecutorContext = {
    scenario: opts.scenario,
    serviceGraphUrl: opts.serviceGraphUrl,
  };

  const messages: MessageParam[] = [
    { role: "user", content: formatAlertMessage(alert, opts.scenario) },
  ];

  console.log(`\n🔍 Starting investigation for alert ${alert.id} (scenario: ${opts.scenario})`);

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (Date.now() > deadline) {
      console.warn(`⚠️  Timeout reached after ${iteration - 1} iterations`);
      return {
        id: `inv-${Date.now()}`,
        alertId: alert.id,
        startedAt,
        completedAt: new Date(),
        status: "failed",
        hypotheses: [],
        summary: "Investigation timed out",
      };
    }

    console.log(`\n── Turn ${iteration} ────────────────────────────────`);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: toolDefinitions as unknown as Anthropic.Tool[],
      messages,
    });

    console.log(
      `   stop_reason=${response.stop_reason} input_tokens=${response.usage.input_tokens} output_tokens=${response.usage.output_tokens}`
    );

    // ── End turn: parse final response ──────────────────────────────────
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
      console.log(`✅ Investigation complete`);
      return parseInvestigationResult(text, alert, startedAt);
    }

    // ── Tool use: execute all tool calls in parallel ─────────────────────
    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      console.log(`   tool calls (parallel): ${toolUseBlocks.map((b) => b.type === "tool_use" ? b.name : "").join(", ")}`);

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          if (block.type !== "tool_use") return null;
          const result = await executeTool(block.name, block.input as Record<string, unknown>, ctx);
          const content: ToolResultBlockParam = {
            type: "tool_result",
            tool_use_id: block.id,
            content: result.error
              ? `Error: ${result.error}`
              : JSON.stringify(result.output),
          };
          return content;
        })
      );

      if (opts.onToolCall) {
        const names = toolUseBlocks
          .filter((b) => b.type === "tool_use")
          .map((b) => (b.type === "tool_use" ? b.name : ""));
        await opts.onToolCall(names).catch(() => { /* never let callback crash the agent */ });
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: toolResults.filter(Boolean) as ToolResultBlockParam[],
      });

      continue;
    }

    // Unexpected stop reason
    console.warn(`Unexpected stop_reason: ${response.stop_reason}`);
    break;
  }

  return {
    id: `inv-${Date.now()}`,
    alertId: alert.id,
    startedAt,
    completedAt: new Date(),
    status: "failed",
    hypotheses: [],
    summary: `Investigation exceeded max iterations (${MAX_ITERATIONS})`,
  };
}
