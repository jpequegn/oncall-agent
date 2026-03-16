import { getCalibrationStats } from "./store";
import type { CalibrationStats, StoreOptions } from "./types";

// ── Confidence calibration using historical accuracy ──────────────────────

/**
 * Adjust a hypothesis confidence score based on historical accuracy for the
 * service being investigated. If past investigations for this service have
 * a low accuracy rate (many rejections/corrections), we attenuate confidence.
 * If accuracy is high, we leave it alone or slightly boost it.
 *
 * Returns the calibrated confidence (0-100).
 */
export function calibrateConfidence(
  originalConfidence: number,
  stats: CalibrationStats | null
): number {
  if (!stats || stats.totalInvestigations < 3) {
    // Not enough history — return original confidence unchanged
    return originalConfidence;
  }

  const accuracy = stats.accuracyRate / 100; // 0.0 to 1.0

  // Apply a Bayesian-inspired adjustment:
  // - accuracy = 1.0 → multiply by 1.0 (no change)
  // - accuracy = 0.5 → multiply by 0.85 (slight reduction)
  // - accuracy = 0.0 → multiply by 0.7 (significant reduction)
  const adjustmentFactor = 0.7 + 0.3 * accuracy;

  return Math.round(
    Math.min(100, Math.max(0, originalConfidence * adjustmentFactor))
  );
}

/**
 * Build a context hint for the investigation agent based on historical patterns.
 * This string is prepended to the agent's prompt to inform it of known patterns.
 */
export async function buildHistoricalContext(
  service: string,
  opts: StoreOptions = {}
): Promise<string | null> {
  const allStats = await getCalibrationStats(service, opts);
  const stats = allStats[0];

  if (!stats || stats.totalInvestigations === 0) {
    return null;
  }

  const lines: string[] = [
    `Historical context for ${service}:`,
    `- ${stats.totalInvestigations} past investigation(s)`,
  ];

  if (stats.confirmedCount > 0) {
    lines.push(`- ${stats.confirmedCount} confirmed correct`);
  }
  if (stats.rejectedCount > 0) {
    lines.push(`- ${stats.rejectedCount} rejected (wrong diagnosis)`);
  }
  if (stats.correctedCount > 0) {
    lines.push(`- ${stats.correctedCount} corrected by human`);
  }
  if (stats.averageConfidence > 0) {
    lines.push(`- Average confidence: ${stats.averageConfidence}%`);
  }
  if (stats.accuracyRate > 0) {
    lines.push(`- Historical accuracy: ${stats.accuracyRate}%`);
  }

  if (stats.accuracyRate < 50 && stats.totalInvestigations >= 3) {
    lines.push(
      `\nWARNING: Past accuracy for ${service} is low (${stats.accuracyRate}%). Consider broader investigation scope and lower initial confidence.`
    );
  }

  return lines.join("\n");
}
