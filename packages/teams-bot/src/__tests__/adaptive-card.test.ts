import { describe, it, expect } from "bun:test";
import { renderAdaptiveCard } from "../formatters/adaptive-card";
import type { InvestigationBlocks } from "@oncall/bot-core";
import { ACTIONS } from "@oncall/bot-core";

function makeBlocks(overrides: Partial<InvestigationBlocks> = {}): InvestigationBlocks {
  return {
    type: "investigation_result",
    alert: {
      id: "alert-1",
      title: "High error rate",
      severity: "critical",
      service: "payment-service",
      timestamp: new Date("2026-01-15T14:30:00Z"),
      labels: {},
    },
    hypotheses: [
      {
        original_rank: 1,
        original_confidence: 85,
        challenge_score: 20,
        key_objections: ["Could be upstream timeout"],
        missing_evidence: [],
        revised_confidence: 80,
      },
    ],
    originalHypotheses: [
      {
        id: "h-1",
        description: "Bad deploy at 14:28 introduced regression",
        confidence: 85,
        evidence: ["Error spike correlates with deploy v2.3.1"],
        relatedServices: ["payment-service"],
        suggestedActions: ["Rollback to v2.3.0", "https://wiki.example.com/runbook"],
      },
    ],
    investigation: {
      id: "inv-1",
      alertId: "alert-1",
      startedAt: new Date("2026-01-15T14:30:00Z"),
      status: "completed",
      hypotheses: [
        {
          id: "h-1",
          description: "Bad deploy at 14:28 introduced regression",
          confidence: 85,
          evidence: ["Error spike correlates with deploy v2.3.1"],
          relatedServices: ["payment-service"],
          suggestedActions: ["Rollback to v2.3.0", "https://wiki.example.com/runbook"],
        },
      ],
      summary: "Payment-service 500s caused by deploy regression",
    },
    validation: {
      incident_id: "inv-1",
      validated_hypotheses: [
        {
          original_rank: 1,
          original_confidence: 85,
          challenge_score: 20,
          key_objections: ["Could be upstream timeout"],
          missing_evidence: [],
          revised_confidence: 80,
        },
      ],
      escalate: false,
      validator_notes: "Strong evidence for deploy regression",
    },
    timeline: [],
    duration_ms: 5000,
    tool_call_count: 4,
    escalate: false,
    ...overrides,
  };
}

describe("renderAdaptiveCard", () => {
  it("returns valid Adaptive Card structure", () => {
    const card = renderAdaptiveCard(makeBlocks());
    expect(card.type).toBe("AdaptiveCard");
    expect(card.version).toBe("1.4");
    expect(card.$schema).toBe("http://adaptivecards.io/schemas/adaptive-card.json");
    expect(Array.isArray(card.body)).toBe(true);
  });

  it("includes header with service name", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const body = card.body as Array<{ text?: string }>;
    const header = body.find((b) => b.text?.includes("payment-service"));
    expect(header).toBeDefined();
  });

  it("includes meta line with duration and severity", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const body = card.body as Array<{ text?: string }>;
    const meta = body.find((b) => b.text?.includes("Duration:") && b.text?.includes("CRITICAL"));
    expect(meta).toBeDefined();
  });

  it("includes hypothesis with confidence", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const body = card.body as Array<{ text?: string }>;
    const hyp = body.find((b) => b.text?.includes("85%") && b.text?.includes("80%"));
    expect(hyp).toBeDefined();
  });

  it("includes action buttons when not escalating", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const actions = card.actions as Array<{ data?: { actionId?: string } }>;
    expect(actions).toBeDefined();
    expect(actions.length).toBe(3);
    const actionIds = actions.map((a) => a.data?.actionId);
    expect(actionIds).toContain(ACTIONS.CONFIRM);
    expect(actionIds).toContain(ACTIONS.REJECT);
    expect(actionIds).toContain(ACTIONS.INVESTIGATE_MORE);
  });

  it("omits action buttons when escalating", () => {
    const card = renderAdaptiveCard(makeBlocks({ escalate: true }));
    expect(card.actions).toBeUndefined();
  });

  it("shows escalation banner when escalating", () => {
    const card = renderAdaptiveCard(makeBlocks({
      escalate: true,
      validation: {
        incident_id: "inv-1",
        validated_hypotheses: [],
        escalate: true,
        escalation_reason: "low confidence",
        validator_notes: "",
      },
    }));
    const body = card.body as Array<{ text?: string; color?: string }>;
    const banner = body.find((b) => b.text?.includes("Escalation required"));
    expect(banner).toBeDefined();
    expect(banner?.color).toBe("Attention");
  });

  it("includes summary text", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const body = card.body as Array<{ text?: string }>;
    const summary = body.find((b) => b.text?.includes("deploy regression"));
    expect(summary).toBeDefined();
  });

  it("includes validator notes", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const body = card.body as Array<{ text?: string }>;
    const notes = body.find((b) => b.text?.includes("Strong evidence"));
    expect(notes).toBeDefined();
  });

  it("includes runbook link", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const body = card.body as Array<{ text?: string }>;
    const runbook = body.find((b) => b.text?.includes("Runbook") && b.text?.includes("wiki.example.com"));
    expect(runbook).toBeDefined();
  });
});
