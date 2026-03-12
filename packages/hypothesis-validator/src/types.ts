import type { Alert, InvestigationResult } from "@shared/types";
export type { Alert, InvestigationResult };

// ── Shared types for hypothesis-validator ─────────────────────────────────

export interface ValidatedHypothesis {
  original_rank: number;
  original_confidence: number;
  challenge_score: number;
  key_objections: string[];
  missing_evidence: string[];
  alternative_explanation?: string;
  revised_confidence: number;
}

export interface ValidationResult {
  incident_id: string;
  validated_hypotheses: ValidatedHypothesis[];
  escalate: boolean;
  escalation_reason?: string;
  validator_notes: string;
}

export interface FullInvestigationResult {
  alert: Alert;
  investigation: InvestigationResult;
  validation: ValidationResult;
  /** Hypotheses re-ranked by revised_confidence descending */
  final_hypotheses: ValidatedHypothesis[];
  escalate: boolean;
  investigation_duration_ms: number;
  validation_duration_ms: number;
  total_duration_ms: number;
}
