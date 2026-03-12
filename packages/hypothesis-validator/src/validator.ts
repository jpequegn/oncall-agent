import Anthropic from "@anthropic-ai/sdk";
import type { InvestigationResult } from "@shared/types";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ValidationResult {
  incident_id: string;
  validated_hypotheses: Array<{
    original_rank: number;
    original_confidence: number;
    challenge_score: number;        // 0-100: how strongly challenged
    key_objections: string[];
    missing_evidence: string[];     // what would confirm or deny
    alternative_explanation?: string;
    revised_confidence: number;     // = original * (1 - challenge_score/100)
  }>;
  escalate: boolean;                // true if top hypothesis revised_confidence < 40%
  escalation_reason?: string;
  validator_notes: string;
}

export interface ValidateOptions {
  apiKey?: string;
  /** Inject a pre-configured Anthropic client (used in tests). */
  client?: Anthropic;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are an adversarial SRE reviewer. You will receive root cause hypotheses for a
production incident. Your job is NOT to find the root cause — it is to find flaws
in the reasoning.

For each hypothesis:
1. What evidence in the investigation report directly CONTRADICTS this hypothesis?
2. What would you EXPECT to see if this hypothesis were true that we did NOT observe?
3. Is the timing correlation strong enough to imply causation, or could it be coincidence?
4. Could this be a SYMPTOM of a deeper upstream issue rather than the root cause?
5. Rate your confidence this hypothesis is WRONG: 0-100% (100 = almost certainly wrong)

Be rigorous, skeptical, and brief. If you cannot find a strong objection, say so honestly.

Output JSON only — no markdown, no extra text:
{
  "validated_hypotheses": [
    {
      "original_rank": 1,
      "original_confidence": 87,
      "challenge_score": 15,
      "key_objections": ["..."],
      "missing_evidence": ["..."],
      "alternative_explanation": "...",
      "revised_confidence": 74
    }
  ],
  "escalation_reason": "...",
  "validator_notes": "..."
}

Rules:
- revised_confidence = original_confidence * (1 - challenge_score / 100), rounded to nearest integer
- If you cannot find a strong objection to a hypothesis, set challenge_score ≤ 20
- If evidence clearly and directly supports the hypothesis, set challenge_score ≤ 15
- Only include escalation_reason if top hypothesis revised_confidence < 40
- validator_notes should summarize your overall assessment in 1-2 sentences`;

// ── Input formatter ────────────────────────────────────────────────────────

function formatInvestigationForValidation(result: InvestigationResult): string {
  const lines: string[] = [
    `INVESTIGATION REPORT`,
    `Incident ID: ${result.id}`,
    `Alert ID: ${result.alertId}`,
    `Status: ${result.status}`,
    ``,
  ];

  if (result.summary) {
    lines.push(`Summary: ${result.summary}`, ``);
  }

  lines.push(`HYPOTHESES:`);
  for (const [i, h] of result.hypotheses.entries()) {
    lines.push(
      ``,
      `Hypothesis ${i + 1} (confidence: ${h.confidence}%)`,
      `  Description: ${h.description}`,
    );
    if (h.evidence.length) {
      lines.push(`  Evidence:`);
      for (const e of h.evidence) {
        lines.push(`    - ${e}`);
      }
    }
    if (h.suggestedActions.length) {
      lines.push(`  Suggested actions:`);
      for (const a of h.suggestedActions) {
        lines.push(`    - ${a}`);
      }
    }
  }

  lines.push(``, `Please adversarially challenge each hypothesis.`);
  return lines.join("\n");
}

// ── Output parser ──────────────────────────────────────────────────────────

interface RawValidatedHypothesis {
  original_rank: number;
  original_confidence: number;
  challenge_score: number;
  key_objections: string[];
  missing_evidence: string[];
  alternative_explanation?: string;
  revised_confidence: number;
}

interface RawValidationOutput {
  validated_hypotheses: RawValidatedHypothesis[];
  escalation_reason?: string;
  validator_notes: string;
}

function parseValidationResult(
  raw: string,
  incidentId: string,
  original: InvestigationResult
): ValidationResult {
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  let parsed: RawValidationOutput;
  try {
    parsed = JSON.parse(cleaned) as RawValidationOutput;
  } catch {
    // Fallback: pass-through with no challenges
    return {
      incident_id: incidentId,
      validated_hypotheses: original.hypotheses.map((h, i) => ({
        original_rank: i + 1,
        original_confidence: h.confidence,
        challenge_score: 0,
        key_objections: [],
        missing_evidence: [],
        revised_confidence: h.confidence,
      })),
      escalate: false,
      validator_notes: cleaned.slice(0, 500),
    };
  }

  // Recalculate revised_confidence to ensure formula is applied correctly
  const validated_hypotheses = parsed.validated_hypotheses.map((vh) => ({
    ...vh,
    revised_confidence: Math.round(vh.original_confidence * (1 - vh.challenge_score / 100)),
  }));

  const topRevised = validated_hypotheses[0]?.revised_confidence ?? 100;
  const escalate = topRevised < 40;

  return {
    incident_id: incidentId,
    validated_hypotheses,
    escalate,
    escalation_reason: escalate ? (parsed.escalation_reason ?? "Top hypothesis revised confidence below threshold (40%)") : undefined,
    validator_notes: parsed.validator_notes,
  };
}

// ── Main validate function ─────────────────────────────────────────────────

export async function validate(
  result: InvestigationResult,
  opts: ValidateOptions = {}
): Promise<ValidationResult> {
  const anthropic = opts.client ?? new Anthropic({
    apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
  });

  const userMessage = formatInvestigationForValidation(result);

  console.log(`\n🔬 Validating ${result.hypotheses.length} hypotheses for incident ${result.id}...`);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

  const validation = parseValidationResult(text, result.id, result);
  console.log(`✅ Validation complete — escalate=${validation.escalate}`);
  return validation;
}
