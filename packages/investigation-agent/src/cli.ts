#!/usr/bin/env bun
import { parseArgs } from "util";
import { readFileSync } from "fs";
import type { Alert } from "@shared/types";
import type { ScenarioName } from "@shared/mock-data";
import { getScenario, listScenarios } from "@shared/mock-data";
import { investigate } from "./agent";

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
  bun run investigate --service payment-service --description "Error rate spiked to 8%"
  bun run investigate --alert ./alert.json
`);
  process.exit(0);
}

// ── Build alert ────────────────────────────────────────────────────────────

let alert: Alert;
let scenario: ScenarioName;

if (values.alert) {
  // Load from file
  try {
    const raw = JSON.parse(readFileSync(values.alert as string, "utf-8"));
    alert = {
      ...raw,
      timestamp: new Date(raw.timestamp),
    };
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
  // Custom alert from flags
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

function printHeader() {
  const sev = alert.severity.toUpperCase();
  console.log(`\n🔍 Investigating ${alert.service} (${sev})...`);
  console.log(`   Alert: ${alert.title}`);
  console.log(`   Fired: ${alert.timestamp.toISOString()}`);
  console.log(`   Scenario: ${scenario}`);
  console.log();
}

function printResult(result: Awaited<ReturnType<typeof investigate>>, durationMs: number) {
  if (result.status === "failed") {
    console.log(`\n❌ Investigation failed: ${result.summary}`);
    return;
  }

  console.log(`\n📊 Investigation complete (${(durationMs / 1000).toFixed(1)}s)`);
  console.log();

  if (result.summary) {
    console.log(`📢 Summary: ${result.summary}`);
    console.log();
  }

  if (result.hypotheses.length === 0) {
    console.log("⚠️  No hypotheses generated.");
    return;
  }

  result.hypotheses.forEach((h, i) => {
    const bar = "█".repeat(Math.round(h.confidence / 10)) + "░".repeat(10 - Math.round(h.confidence / 10));
    console.log(`Hypothesis ${i + 1} (confidence: ${h.confidence}%) [${bar}]`);
    console.log(`  ${h.description}`);
    if (h.evidence.length) {
      console.log(`  Evidence:`);
      h.evidence.forEach((e) => console.log(`    • ${e}`));
    }
    if (h.suggestedActions.length) {
      console.log(`  Action: ${h.suggestedActions[0]}`);
    }
    console.log();
  });
}

// ── Run ────────────────────────────────────────────────────────────────────

if (!values.json) {
  printHeader();
}

const t0 = Date.now();

try {
  const result = await investigate(alert, {
    scenario,
    serviceGraphUrl: values["service-graph-url"] as string | undefined,
  });

  const durationMs = Date.now() - t0;

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResult(result, durationMs);
  }

  process.exit(result.status === "failed" ? 1 : 0);
} catch (err) {
  console.error(`\n❌ Fatal error: ${(err as Error).message}`);
  process.exit(1);
}
