import { describe, it, expect } from "bun:test";
import {
  formatDuration,
  formatInvestigationResult,
  formatPlainText,
} from "../formatters/investigation";
import type { FullInvestigationResult } from "@oncall/hypothesis-validator";
import type { Alert, InvestigationResult } from "@shared/types";
import type { ValidationResult } from "@oncall/hypothesis-validator";

// ── Fixtures ───────────────────────────────────────────────────────────────

const alert: Alert = {
  id: "alert-1",
  service: "payment-service",
  severity: "critical",
  title: "High error rate",
  timestamp: new Date("2024-01-15T14:30:00Z"),
  labels: {},
};

const investigation: InvestigationResult = {
  id: "inv-1",
  alertId: "alert-1",
  startedAt: new Date("2024-01-15T14:30:00Z"),
  completedAt: new Date("2024-01-15T14:30:30Z"),
  status: "completed",
  hypotheses: [
    {
      id: "hyp-1",
      description: "Deploy abc123 introduced NPE in PaymentProcessor.java:247",
      confidence: 87,
      evidence: ["Deploy abc123 at 14:28", "Error rate spike at 14:30", "NPE in logs"],
      relatedServices: [],
      suggestedActions: ["Roll back payment-service to v2.4.0", "https://wiki.example.com/rollback"],
    },
    {
      id: "hyp-2",
      description: "Database connection pool exhausted",
      confidence: 30,
      evidence: ["High DB latency"],
      relatedServices: [],
      suggestedActions: ["Increase connection pool size"],
    },
  ],
  summary: "Deploy abc123 introduced NPE — recommend rollback",
};

const validationSuccess: ValidationResult = {
  incident_id: "inv-1",
  validated_hypotheses: [
    {
      original_rank: 1,
      original_confidence: 87,
      challenge_score: 10,
      key_objections: ["Minor config ambiguity"],
      missing_evidence: ["Full stack trace"],
      revised_confidence: 78,
    },
    {
      original_rank: 2,
      original_confidence: 30,
      challenge_score: 20,
      key_objections: [],
      missing_evidence: [],
      revised_confidence: 24,
    },
  ],
  escalate: false,
  escalation_reason: undefined,
  validator_notes: "Evidence chain is solid. Deploy timing is clear.",
};

const validationEscalate: ValidationResult = {
  incident_id: "inv-1",
  validated_hypotheses: [
    {
      original_rank: 1,
      original_confidence: 87,
      challenge_score: 80,
      key_objections: ["o1", "o2", "o3", "o4"],
      missing_evidence: ["many things"],
      revised_confidence: 17,
    },
  ],
  escalate: true,
  escalation_reason: "All hypotheses heavily challenged, confidence too low",
  validator_notes: "Unable to confirm root cause. Human review required.",
};

function makeResult(validation: ValidationResult): FullInvestigationResult {
  const { rerankHypotheses } = require("@oncall/hypothesis-validator") as typeof import("@oncall/hypothesis-validator");
  const final_hypotheses = rerankHypotheses(validation.validated_hypotheses);
  return {
    alert,
    investigation,
    validation,
    final_hypotheses,
    escalate: validation.escalate,
    investigation_duration_ms: 28_000,
    validation_duration_ms: 4_500,
    total_duration_ms: 32_500,
  };
}

// ── formatDuration ─────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("shows ms for sub-second durations", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("shows seconds with one decimal for ≥1000ms", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(32_500)).toBe("32.5s");
    expect(formatDuration(60_000)).toBe("60.0s");
  });
});

// ── formatInvestigationResult — success path ───────────────────────────────

describe("formatInvestigationResult — success path", () => {
  const result = makeResult(validationSuccess);
  const blocks = formatInvestigationResult(result);

  it("first block is a header containing the service name", () => {
    const header = blocks[0];
    expect(header.type).toBe("header");
    if (header.type === "header") {
      expect(header.text.text).toContain("payment-service");
    }
  });

  it("contains a meta line with duration, severity, and status", () => {
    const metaBlock = blocks.find(
      (b) => b.type === "section" && "text" in b && b.text.text.includes("Duration:")
    );
    expect(metaBlock).toBeDefined();
    if (metaBlock && metaBlock.type === "section") {
      expect(metaBlock.text.text).toContain("CRITICAL");
      expect(metaBlock.text.text).toContain("32.5s");
    }
  });

  it("does NOT include an escalation banner", () => {
    const escalationBlock = blocks.find(
      (b) => b.type === "section" && "text" in b && b.text.text.includes("Escalation required")
    );
    expect(escalationBlock).toBeUndefined();
  });

  it("contains the investigation summary", () => {
    const summaryBlock = blocks.find(
      (b) => b.type === "section" && "text" in b && b.text.text.includes("Deploy abc123")
    );
    expect(summaryBlock).toBeDefined();
  });

  it("includes hypothesis confidence original→revised", () => {
    const hypBlock = blocks.find(
      (b) => b.type === "section" && "text" in b && b.text.text.includes("87%") && b.text.text.includes("78%")
    );
    expect(hypBlock).toBeDefined();
  });

  it("includes action buttons with correct action_ids", () => {
    const actionsBlock = blocks.find((b) => b.type === "actions");
    expect(actionsBlock).toBeDefined();
    if (actionsBlock && actionsBlock.type === "actions") {
      const ids = actionsBlock.elements.map((e) => e.action_id);
      expect(ids).toContain("hypothesis_confirm");
      expect(ids).toContain("hypothesis_reject");
      expect(ids).toContain("investigate_more");
    }
  });

  it("includes validator notes in a context block", () => {
    const contextBlock = blocks.find(
      (b) => b.type === "context" && "elements" in b &&
        b.elements.some((e) => "text" in e && e.text.includes("Evidence chain is solid"))
    );
    expect(contextBlock).toBeDefined();
  });
});

// ── formatInvestigationResult — evidence truncation ────────────────────────

describe("formatInvestigationResult — evidence truncation", () => {
  it("shows at most 5 evidence items with overflow note", () => {
    const longEvidence = ["e1", "e2", "e3", "e4", "e5", "e6", "e7"];
    const richInvestigation: InvestigationResult = {
      ...investigation,
      hypotheses: [{
        ...investigation.hypotheses[0]!,
        evidence: longEvidence,
      }, ...investigation.hypotheses.slice(1)],
    };
    const result: FullInvestigationResult = {
      ...makeResult(validationSuccess),
      investigation: richInvestigation,
    };
    const blocks = formatInvestigationResult(result);

    const evidenceBlock = blocks.find(
      (b) => b.type === "section" && "text" in b && b.text.text.includes("Evidence:")
    );
    expect(evidenceBlock).toBeDefined();
    if (evidenceBlock && evidenceBlock.type === "section") {
      // 5 bullets + overflow note
      expect(evidenceBlock.text.text).toContain("…and 2 more");
      // Exactly 5 bullets
      const bulletCount = (evidenceBlock.text.text.match(/^• /gm) ?? []).length;
      expect(bulletCount).toBe(5);
    }
  });
});

// ── formatInvestigationResult — escalation path ────────────────────────────

describe("formatInvestigationResult — escalation path", () => {
  const result = makeResult(validationEscalate);
  const blocks = formatInvestigationResult(result);

  it("includes an escalation banner with the reason", () => {
    const banner = blocks.find(
      (b) => b.type === "section" && "text" in b && b.text.text.includes("Escalation required")
    );
    expect(banner).toBeDefined();
    if (banner && banner.type === "section") {
      expect(banner.text.text).toContain("All hypotheses heavily challenged");
    }
  });

  it("does NOT include action buttons when escalating", () => {
    const actionsBlock = blocks.find((b) => b.type === "actions");
    expect(actionsBlock).toBeUndefined();
  });
});

// ── formatPlainText ────────────────────────────────────────────────────────

describe("formatPlainText", () => {
  it("returns plain text summary for success path", () => {
    const result = makeResult(validationSuccess);
    const text = formatPlainText(result);
    expect(text).toContain("Deploy abc123");
    expect(text).toContain("78%");
  });

  it("returns escalation message when escalating", () => {
    const result = makeResult(validationEscalate);
    const text = formatPlainText(result);
    expect(text).toContain("⚠️");
    expect(text).toContain("All hypotheses heavily challenged");
  });
});
