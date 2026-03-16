import { describe, expect, test } from "bun:test";
import { calibrateConfidence } from "../calibration";
import type { CalibrationStats } from "../types";

function makeStats(overrides: Partial<CalibrationStats> = {}): CalibrationStats {
  return {
    service: "payment-service",
    totalInvestigations: 10,
    confirmedCount: 7,
    rejectedCount: 2,
    correctedCount: 1,
    averageConfidence: 75,
    accuracyRate: 70,
    ...overrides,
  };
}

describe("calibrateConfidence", () => {
  test("returns original confidence when no stats", () => {
    expect(calibrateConfidence(85, null)).toBe(85);
  });

  test("returns original confidence with too few investigations", () => {
    const stats = makeStats({ totalInvestigations: 2 });
    expect(calibrateConfidence(85, stats)).toBe(85);
  });

  test("perfect accuracy leaves confidence unchanged", () => {
    const stats = makeStats({ accuracyRate: 100 });
    const result = calibrateConfidence(80, stats);
    expect(result).toBe(80);
  });

  test("zero accuracy applies maximum reduction", () => {
    const stats = makeStats({ accuracyRate: 0 });
    const result = calibrateConfidence(100, stats);
    // 0.7 * 100 = 70
    expect(result).toBe(70);
  });

  test("50% accuracy applies moderate reduction", () => {
    const stats = makeStats({ accuracyRate: 50 });
    const result = calibrateConfidence(80, stats);
    // factor = 0.7 + 0.3 * 0.5 = 0.85, 80 * 0.85 = 68
    expect(result).toBe(68);
  });

  test("70% accuracy applies slight reduction", () => {
    const stats = makeStats({ accuracyRate: 70 });
    const result = calibrateConfidence(90, stats);
    // factor = 0.7 + 0.3 * 0.7 = 0.91, 90 * 0.91 = 81.9 → 82
    expect(result).toBe(82);
  });

  test("never exceeds 100", () => {
    const stats = makeStats({ accuracyRate: 100 });
    const result = calibrateConfidence(100, stats);
    expect(result).toBeLessThanOrEqual(100);
  });

  test("never goes below 0", () => {
    const stats = makeStats({ accuracyRate: 0 });
    const result = calibrateConfidence(0, stats);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  test("rounds to integer", () => {
    const stats = makeStats({ accuracyRate: 33 });
    const result = calibrateConfidence(77, stats);
    expect(Number.isInteger(result)).toBe(true);
  });
});
