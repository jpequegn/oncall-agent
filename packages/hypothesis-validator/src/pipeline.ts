import type { Alert } from "@shared/types";
import type { ScenarioName } from "@shared/mock-data";
import { investigate, type InvestigateOptions } from "@oncall/investigation-agent";
import { validate, type ValidateOptions } from "./validator";
import { rerankHypotheses } from "./scoring";
import type { FullInvestigationResult } from "./types";

export type { FullInvestigationResult } from "./types";

// ── Pipeline options ───────────────────────────────────────────────────────

export interface PipelineOptions {
  scenario: ScenarioName;
  serviceGraphUrl?: string;
  apiKey?: string;
  /** Inject clients for both phases (used in tests). */
  investigationClient?: InvestigateOptions["client"];
  validationClient?: ValidateOptions["client"];
}

// ── Full investigation pipeline ────────────────────────────────────────────

/**
 * Run the two-phase pipeline:
 *   Phase 1 — Investigation Agent: gather evidence, produce hypotheses
 *   Phase 2 — Hypothesis Validator: adversarially challenge hypotheses
 *
 * Returns a FullInvestigationResult with re-ranked final_hypotheses and
 * per-phase timing. Slack Bot imports this as its main entry point.
 */
export async function runFullInvestigation(
  alert: Alert,
  opts: PipelineOptions
): Promise<FullInvestigationResult> {
  console.log(`\n🚀 Starting full investigation pipeline for alert ${alert.id}`);

  // ── Phase 1: Investigation ───────────────────────────────────────────────
  console.log(`\nPhase 1: Investigation Agent...`);
  const t1Start = Date.now();

  const investigation = await investigate(alert, {
    scenario: opts.scenario,
    serviceGraphUrl: opts.serviceGraphUrl,
    apiKey: opts.apiKey,
    client: opts.investigationClient,
  });

  const investigation_duration_ms = Date.now() - t1Start;
  console.log(`   ✓ Phase 1 complete in ${investigation_duration_ms}ms — ${investigation.hypotheses.length} hypothesis(es)`);

  // ── Phase 2: Validation ──────────────────────────────────────────────────
  console.log(`\nPhase 2: Hypothesis Validator...`);
  const t2Start = Date.now();

  const validation = await validate(investigation, {
    apiKey: opts.apiKey,
    client: opts.validationClient,
  });

  const validation_duration_ms = Date.now() - t2Start;
  console.log(`   ✓ Phase 2 complete in ${validation_duration_ms}ms — escalate=${validation.escalate}`);

  // ── Re-rank and assemble ─────────────────────────────────────────────────
  const final_hypotheses = rerankHypotheses(validation.validated_hypotheses);
  const total_duration_ms = investigation_duration_ms + validation_duration_ms;

  console.log(`\n✅ Pipeline complete in ${total_duration_ms}ms`);

  return {
    alert,
    investigation,
    validation,
    final_hypotheses,
    escalate: validation.escalate,
    investigation_duration_ms,
    validation_duration_ms,
    total_duration_ms,
  };
}
