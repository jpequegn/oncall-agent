import type { Alert, InvestigationResult, Hypothesis } from "@shared/types";
import type { ValidatedHypothesis, ValidationResult } from "@oncall/hypothesis-validator";

// Re-export for consumers
export type { ValidatedHypothesis };

// ── Platform-agnostic message context ────────────────────────────────────

export interface MessageContext {
  channelId: string;
  threadId: string;
  userId: string;
  platform: "slack" | "teams";
}

export interface ActionContext extends MessageContext {
  actionId: string;
  value: string;
  messageId: string;
}

// ── Investigation result blocks ──────────────────────────────────────────

export interface InvestigationBlocks {
  type: "investigation_result";
  alert: Alert;
  hypotheses: ValidatedHypothesis[];
  /** Original hypotheses from the investigation (for descriptions, evidence). */
  originalHypotheses: Hypothesis[];
  investigation: InvestigationResult;
  validation: ValidationResult;
  timeline: TimelineEvent[];
  duration_ms: number;
  tool_call_count: number;
  escalate: boolean;
}

export interface TimelineEvent {
  timestamp: Date;
  label: string;
  detail?: string;
}

// ── Bot message ──────────────────────────────────────────────────────────

export interface BotMessage {
  /** Plain-text fallback (required for all platforms). */
  text: string;
  /** Structured investigation blocks (rendered per-platform). */
  blocks?: InvestigationBlocks;
}

// ── Action ID constants ──────────────────────────────────────────────────

export const ACTIONS = {
  CONFIRM: "hypothesis_confirm",
  REJECT: "hypothesis_reject",
  INVESTIGATE_MORE: "investigate_more",
} as const;

export type ActionId = (typeof ACTIONS)[keyof typeof ACTIONS];
