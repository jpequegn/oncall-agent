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
