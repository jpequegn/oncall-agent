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

// ── Adaptive Card structure ─────────────────────────────────────────────

describe("renderAdaptiveCard — structure", () => {
  it("returns valid Adaptive Card v1.5 structure", () => {
    const card = renderAdaptiveCard(makeBlocks());
    expect(card.type).toBe("AdaptiveCard");
    expect(card.version).toBe("1.5");
    expect(card.$schema).toBe("http://adaptivecards.io/schemas/adaptive-card.json");
    expect(Array.isArray(card.body)).toBe(true);
  });

  it("includes header with service name", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const body = card.body as Array<{ text?: string; type?: string }>;
    const header = body.find((b) => b.type === "TextBlock" && b.text?.includes("payment-service"));
    expect(header).toBeDefined();
  });
});

// ── FactSet meta ────────────────────────────────────────────────────────

describe("renderAdaptiveCard — FactSet meta", () => {
  it("uses FactSet for duration, severity, status, and tool calls", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const body = card.body as Array<{ type?: string; facts?: Array<{ title: string; value: string }> }>;
    const factSet = body.find((b) => b.type === "FactSet");
    expect(factSet).toBeDefined();
    const facts = factSet!.facts!;
    expect(facts.find((f) => f.title === "Duration")?.value).toBe("5.0s");
    expect(facts.find((f) => f.title === "Severity")?.value).toBe("CRITICAL");
    expect(facts.find((f) => f.title === "Status")?.value).toBe("completed");
    expect(facts.find((f) => f.title === "Tool calls")?.value).toBe("4");
  });
});

// ── Hypotheses ──────────────────────────────────────────────────────────

describe("renderAdaptiveCard — hypotheses", () => {
  it("includes hypothesis with confidence", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const body = card.body as Array<{ text?: string }>;
    const hyp = body.find((b) => b.text?.includes("85%") && b.text?.includes("80%"));
    expect(hyp).toBeDefined();
  });

  it("includes suggested action and runbook link", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const body = card.body as Array<{ text?: string }>;
    const runbook = body.find((b) => b.text?.includes("Runbook") && b.text?.includes("wiki.example.com"));
    expect(runbook).toBeDefined();
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
});

// ── Evidence truncation ─────────────────────────────────────────────────

describe("renderAdaptiveCard — evidence truncation", () => {
  it("truncates evidence at 5 items with overflow note", () => {
    const blocks = makeBlocks();
    blocks.originalHypotheses[0]!.evidence = [
      "e1", "e2", "e3", "e4", "e5", "e6", "e7",
    ];
    const card = renderAdaptiveCard(blocks);
    const body = card.body as Array<{ text?: string }>;
    const evidenceBlock = body.find((b) => b.text?.includes("Evidence:"));
    expect(evidenceBlock).toBeDefined();
    expect(evidenceBlock!.text).toContain("…and 2 more");
    const bulletCount = (evidenceBlock!.text!.match(/^• /gm) ?? []).length;
    expect(bulletCount).toBe(5);
  });

  it("shows all evidence when 5 or fewer", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const body = card.body as Array<{ text?: string }>;
    const evidenceBlock = body.find((b) => b.text?.includes("Evidence:"));
    expect(evidenceBlock).toBeDefined();
    expect(evidenceBlock!.text).not.toContain("…and");
  });
});

// ── Action buttons ──────────────────────────────────────────────────────

describe("renderAdaptiveCard — action buttons", () => {
  it("includes 3 action buttons when not escalating", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const actions = card.actions as Array<{ type: string; data?: { actionId?: string } }>;
    const submitActions = actions.filter((a) => a.type === "Action.Submit");
    expect(submitActions.length).toBe(3);
    const actionIds = submitActions.map((a) => a.data?.actionId);
    expect(actionIds).toContain(ACTIONS.CONFIRM);
    expect(actionIds).toContain(ACTIONS.REJECT);
    expect(actionIds).toContain(ACTIONS.INVESTIGATE_MORE);
  });

  it("omits action buttons when escalating", () => {
    const card = renderAdaptiveCard(makeBlocks({ escalate: true }));
    expect(card.actions).toBeUndefined();
  });
});

// ── Escalation ──────────────────────────────────────────────────────────

describe("renderAdaptiveCard — escalation", () => {
  it("shows escalation banner with Attention color and Bolder weight", () => {
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
    const body = card.body as Array<{ text?: string; color?: string; weight?: string }>;
    const banner = body.find((b) => b.text?.includes("Escalation required"));
    expect(banner).toBeDefined();
    expect(banner?.color).toBe("Attention");
    expect(banner?.weight).toBe("Bolder");
  });
});

// ── Secondary hypotheses (Action.ShowCard) ──────────────────────────────

describe("renderAdaptiveCard — secondary hypotheses", () => {
  function makeMultiHypBlocks(): InvestigationBlocks {
    return makeBlocks({
      hypotheses: [
        {
          original_rank: 1,
          original_confidence: 85,
          challenge_score: 20,
          key_objections: ["Could be upstream timeout"],
          missing_evidence: [],
          revised_confidence: 80,
        },
        {
          original_rank: 2,
          original_confidence: 40,
          challenge_score: 50,
          key_objections: [],
          missing_evidence: [],
          revised_confidence: 30,
        },
      ],
      originalHypotheses: [
        {
          id: "h-1",
          description: "Bad deploy at 14:28 introduced regression",
          confidence: 85,
          evidence: ["Error spike correlates with deploy v2.3.1"],
          relatedServices: ["payment-service"],
          suggestedActions: ["Rollback to v2.3.0"],
        },
        {
          id: "h-2",
          description: "Database connection pool exhausted",
          confidence: 40,
          evidence: ["High DB latency"],
          relatedServices: ["payment-service"],
          suggestedActions: ["Increase pool size"],
        },
      ],
    });
  }

  it("renders secondary hypotheses in Action.ShowCard", () => {
    const card = renderAdaptiveCard(makeMultiHypBlocks());
    const actions = card.actions as Array<{ type: string; title?: string; card?: Record<string, unknown> }>;
    const showCard = actions.find((a) => a.type === "Action.ShowCard");
    expect(showCard).toBeDefined();
    expect(showCard!.title).toContain("1 more hypothesis");
  });

  it("Action.ShowCard contains hypothesis #2 details", () => {
    const card = renderAdaptiveCard(makeMultiHypBlocks());
    const actions = card.actions as Array<{ type: string; card?: { body?: Array<{ text?: string }> } }>;
    const showCard = actions.find((a) => a.type === "Action.ShowCard");
    const innerBody = showCard!.card!.body!;
    const hypBlock = innerBody.find((b) => b.text?.includes("40%") && b.text?.includes("30%"));
    expect(hypBlock).toBeDefined();
    const descBlock = innerBody.find((b) => b.text?.includes("Database connection pool"));
    expect(descBlock).toBeDefined();
  });

  it("does not render Action.ShowCard for single hypothesis", () => {
    const card = renderAdaptiveCard(makeBlocks());
    const actions = card.actions as Array<{ type: string }>;
    const showCard = actions.find((a) => a.type === "Action.ShowCard");
    expect(showCard).toBeUndefined();
  });

  it("pluralizes when 3+ hypotheses", () => {
    const blocks = makeMultiHypBlocks();
    blocks.hypotheses.push({
      original_rank: 3,
      original_confidence: 20,
      challenge_score: 70,
      key_objections: [],
      missing_evidence: [],
      revised_confidence: 10,
    });
    blocks.originalHypotheses.push({
      id: "h-3",
      description: "Network partition",
      confidence: 20,
      evidence: [],
      relatedServices: [],
      suggestedActions: [],
    });
    const card = renderAdaptiveCard(blocks);
    const actions = card.actions as Array<{ type: string; title?: string }>;
    const showCard = actions.find((a) => a.type === "Action.ShowCard");
    expect(showCard!.title).toContain("hypotheses");
  });
});

// ── Missing runbook ─────────────────────────────────────────────────────

describe("renderAdaptiveCard — missing runbook", () => {
  it("omits runbook link when no URL in suggestedActions", () => {
    const blocks = makeBlocks();
    blocks.originalHypotheses[0]!.suggestedActions = ["Rollback to v2.3.0"];
    const card = renderAdaptiveCard(blocks);
    const body = card.body as Array<{ text?: string }>;
    const actionBlock = body.find((b) => b.text?.includes("Suggested action:"));
    expect(actionBlock).toBeDefined();
    expect(actionBlock!.text).not.toContain("Runbook");
  });

  it("omits suggested action block when suggestedActions is empty", () => {
    const blocks = makeBlocks();
    blocks.originalHypotheses[0]!.suggestedActions = [];
    const card = renderAdaptiveCard(blocks);
    const body = card.body as Array<{ text?: string }>;
    const actionBlock = body.find((b) => b.text?.includes("Suggested action:"));
    expect(actionBlock).toBeUndefined();
  });
});

// ── Snapshot: Scenario A (deploy regression) ─────────────────────────────

describe("renderAdaptiveCard — snapshot: Scenario A", () => {
  it("produces stable card structure for deploy regression scenario", () => {
    const card = renderAdaptiveCard(makeBlocks());

    // Top-level structure
    expect(card.type).toBe("AdaptiveCard");
    expect(card.version).toBe("1.5");

    const body = card.body as Array<Record<string, unknown>>;
    const actions = card.actions as Array<Record<string, unknown>>;

    // Count element types
    const textBlocks = body.filter((b) => b.type === "TextBlock");
    const factSets = body.filter((b) => b.type === "FactSet");
    const separators = body.filter((b) => b.type === "ColumnSet");

    expect(factSets).toHaveLength(1);
    expect(separators.length).toBeGreaterThanOrEqual(1);
    expect(textBlocks.length).toBeGreaterThanOrEqual(5); // header, summary, hypothesis, evidence, etc.

    // 3 submit actions, no ShowCard for single hypothesis
    expect(actions).toHaveLength(3);
    expect(actions.every((a) => a.type === "Action.Submit")).toBe(true);
  });
});

// ── Snapshot: Escalation case ───────────────────────────────────────────

describe("renderAdaptiveCard — snapshot: escalation", () => {
  it("produces stable card structure for escalation scenario", () => {
    const card = renderAdaptiveCard(makeBlocks({
      escalate: true,
      hypotheses: [{
        original_rank: 1, original_confidence: 40, challenge_score: 80,
        key_objections: ["Evidence contradicts"], missing_evidence: ["Logs"],
        revised_confidence: 15,
      }],
      validation: {
        incident_id: "inv-1",
        validated_hypotheses: [{
          original_rank: 1, original_confidence: 40, challenge_score: 80,
          key_objections: ["Evidence contradicts"], missing_evidence: ["Logs"],
          revised_confidence: 15,
        }],
        escalate: true,
        escalation_reason: "All hypotheses heavily challenged, confidence too low",
        validator_notes: "Unable to confirm root cause. Human review required.",
      },
    }));

    const body = card.body as Array<Record<string, unknown>>;

    // Escalation banner present
    const banner = body.find((b) => b.type === "TextBlock" && (b.text as string)?.includes("Escalation required"));
    expect(banner).toBeDefined();
    expect(banner!.color).toBe("Attention");
    expect(banner!.weight).toBe("Bolder");

    // Red confidence emoji for low confidence
    const hypBlock = body.find((b) => b.type === "TextBlock" && (b.text as string)?.includes("🔴"));
    expect(hypBlock).toBeDefined();

    // No action buttons when escalating
    expect(card.actions).toBeUndefined();

    // Validator notes still present
    const notes = body.find((b) => b.type === "TextBlock" && (b.text as string)?.includes("Human review required"));
    expect(notes).toBeDefined();
  });
});
