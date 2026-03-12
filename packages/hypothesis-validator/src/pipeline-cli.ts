#!/usr/bin/env bun
import { parseArgs } from "util";
import { readFileSync } from "fs";
import type { Alert } from "@shared/types";
import type { ScenarioName } from "@shared/mock-data";
import { getScenario, listScenarios } from "@shared/mock-data";
import { runFullInvestigation } from "./pipeline";

// ── Scenario aliases ───────────────────────────────────────────────────────

const SCENARIO_ALIASES: Record<string, ScenarioName> = {
  A: "deploy-regression",
  B: "upstream-failure",
  C: "no-clear-cause",
  "deploy-regression": "deploy-regression",
  "upstream-failure": "upstream-failure",
  "no-clear-cause": "no-clear-cause",
};

// ── Parse args ─────────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    scenario:    { type: "string",  short: "s" },
    service:     { type: "string" },
    severity:    { type: "string" },
    description: { type: "string" },
    alert:       { type: "string" },
    json:        { type: "boolean", default: false },
    help:        { type: "boolean", short: "h", default: false },
    "service-graph-url": { type: "string" },
  },
  strict: false,
  allowPositionals: false,
});

// ── Help ───────────────────────────────────────────────────────────────────

if (values.help || (!values.scenario && !values.service && !values.alert)) {
  console.log(`
Usage: bun run investigate [options]

Runs the full pipeline: Investigation Agent → Hypothesis Validator

Options:
  --scenario, -s <name>    Run a predefined scenario (A, B, C or full name)
  --service <name>         Service name for a custom alert
  --severity <level>       Severity: critical | high | medium | low (default: critical)
  --description <text>     Alert description for a custom alert
  --alert <path>           Path to a JSON alert file
  --json                   Output machine-readable JSON instead of pretty print
  --service-graph-url      Override service-graph API URL (default: http://localhost:3001)
  --help, -h               Show this help

Available scenarios:
${listScenarios().map((s) => `  ${s}`).join("\n")}

Examples:
  bun run investigate --scenario A
  bun run investigate --scenario B --json
  bun run investigate --scenario C
  bun run investigate --service payment-service --description "Error rate spiked to 8%"
`);
  process.exit(0);
}

// ── Build alert ────────────────────────────────────────────────────────────

let alert: Alert;
let scenario: ScenarioName;

if (values.alert) {
  try {
    const raw = JSON.parse(readFileSync(values.alert as string, "utf-8"));
    alert = { ...raw, timestamp: new Date(raw.timestamp) };
    scenario = (SCENARIO_ALIASES[values.scenario as string] ?? "deploy-regression") as ScenarioName;
  } catch (err) {
    console.error(`❌ Failed to load alert file: ${(err as Error).message}`);
    process.exit(1);
  }
} else if (values.scenario) {
  const scenarioName = SCENARIO_ALIASES[values.scenario as string];
  if (!scenarioName) {
    console.error(`❌ Unknown scenario: ${values.scenario}`);
    console.error(`   Valid options: ${Object.keys(SCENARIO_ALIASES).join(", ")}`);
    process.exit(1);
  }
  scenario = scenarioName;
  const s = getScenario(scenario);
  alert = {
    id: `alert-${Date.now()}`,
    title: s.triggerAlert.title,
    severity: s.triggerAlert.severity,
    service: s.triggerAlert.service,
    timestamp: new Date(s.triggerAlert.firedAt),
    labels: { env: "production", scenario },
    description: s.description,
  };
} else {
  scenario = (SCENARIO_ALIASES[values.scenario as string ?? ""] ?? "deploy-regression") as ScenarioName;
  alert = {
    id: `alert-${Date.now()}`,
    title: values.description as string ?? `Alert: ${values.service} degraded`,
    severity: (values.severity as Alert["severity"]) ?? "critical",
    service: values.service as string ?? "unknown-service",
    timestamp: new Date(),
    labels: { env: "production" },
    description: values.description as string,
  };
}

// ── Pretty-print helpers ───────────────────────────────────────────────────

function confidenceBar(n: number): string {
  return "█".repeat(Math.round(n / 10)) + "░".repeat(10 - Math.round(n / 10));
}

function printResult(result: Awaited<ReturnType<typeof runFullInvestigation>>) {
  const { investigation, validation, final_hypotheses } = result;

  if (investigation.status === "failed") {
    console.log(`\n❌ Investigation failed: ${investigation.summary}`);
    return;
  }

  console.log(`\n📊 Pipeline complete`);
  console.log(`   Investigation: ${result.investigation_duration_ms}ms`);
  console.log(`   Validation:    ${result.validation_duration_ms}ms`);
  console.log(`   Total:         ${result.total_duration_ms}ms`);
  console.log();

  if (investigation.summary) {
    console.log(`📢 Summary: ${investigation.summary}`);
    console.log();
  }

  if (result.escalate) {
    console.log(`🚨 ESCALATION REQUIRED: ${validation.escalation_reason}`);
    console.log();
  }

  if (final_hypotheses.length === 0) {
    console.log("⚠️  No hypotheses generated.");
    return;
  }

  console.log(`🔬 Validated Hypotheses (re-ranked by revised confidence):`);
  console.log();

  for (const [i, vh] of final_hypotheses.entries()) {
    const origH = investigation.hypotheses[vh.original_rank - 1];
    const bar = confidenceBar(vh.revised_confidence);
    console.log(`Hypothesis ${i + 1} — original: ${vh.original_confidence}% → revised: ${vh.revised_confidence}% [${bar}]`);
    if (origH) {
      console.log(`  ${origH.description}`);
    }
    if (vh.key_objections.length) {
      console.log(`  Objections:`);
      vh.key_objections.forEach((o) => console.log(`    ⚠ ${o}`));
    }
    if (origH?.suggestedActions.length) {
      console.log(`  Action: ${origH.suggestedActions[0]}`);
    }
    console.log();
  }

  console.log(`📝 Validator notes: ${validation.validator_notes}`);
}

// ── Run ────────────────────────────────────────────────────────────────────

if (!values.json) {
  const sev = alert.severity.toUpperCase();
  console.log(`\n🔍 Investigating ${alert.service} (${sev}) with validation...`);
  console.log(`   Alert: ${alert.title}`);
  console.log(`   Scenario: ${scenario}`);
  console.log();
}

try {
  const result = await runFullInvestigation(alert, {
    scenario,
    serviceGraphUrl: values["service-graph-url"] as string | undefined,
  });

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResult(result);
  }

  process.exit(result.escalate || result.investigation.status === "failed" ? 1 : 0);
} catch (err) {
  console.error(`\n❌ Fatal error: ${(err as Error).message}`);
  process.exit(1);
}
