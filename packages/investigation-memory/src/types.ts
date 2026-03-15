// ── Investigation Memory Types ─────────────────────────────────────────────

export interface StoredInvestigation {
  id: string;
  alertId: string;
  alertTitle: string;
  service: string;
  severity: "P1" | "P2" | "P3" | "P4";
  scenario?: string;
  rootCause?: string;
  resolution?: string;
  summary?: string;
  hypotheses: StoredHypothesis[];
  evidence: string[];
  topConfidence?: number;
  escalated: boolean;
  validatorNotes?: string;
  feedback?: "confirmed" | "rejected" | "corrected";
  correctionText?: string;
  feedbackUser?: string;
  embedding?: number[];
  investigatedAt: Date;
  feedbackAt?: Date;
}

export interface StoredHypothesis {
  description: string;
  confidence: number;
  revisedConfidence?: number;
  evidence: string[];
  suggestedAction?: string;
}

export interface SimilarIncident {
  id: string;
  alertTitle: string;
  service: string;
  severity: string;
  rootCause?: string;
  resolution?: string;
  summary?: string;
  feedback?: string;
  correctionText?: string;
  topConfidence?: number;
  investigatedAt: Date;
  similarity: number;
}

export interface RecurrencePattern {
  service: string;
  count: number;
  incidents: Array<{
    id: string;
    alertTitle: string;
    rootCause?: string;
    investigatedAt: Date;
  }>;
  commonRootCauses: string[];
}

export interface CalibrationStats {
  service: string;
  totalInvestigations: number;
  confirmedCount: number;
  rejectedCount: number;
  correctedCount: number;
  averageConfidence: number;
  accuracyRate: number;
}

export interface StoreOptions {
  databaseUrl?: string;
}
