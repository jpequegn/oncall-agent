export interface Alert {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  service: string;
  timestamp: Date;
  labels: Record<string, string>;
  description?: string;
}

export interface Service {
  id: string;
  name: string;
  team: string;
  dependencies: string[];
  healthStatus: "healthy" | "degraded" | "down" | "unknown";
  metadata?: Record<string, string>;
}

export interface Team {
  id: string;
  name: string;
  slackChannel: string;
  oncallSchedule?: string;
  members: string[];
}

export interface Hypothesis {
  id: string;
  description: string;
  confidence: number;
  evidence: string[];
  relatedServices: string[];
  suggestedActions: string[];
}

export interface InvestigationResult {
  id: string;
  alertId: string;
  startedAt: Date;
  completedAt?: Date;
  status: "in_progress" | "completed" | "failed";
  hypotheses: Hypothesis[];
  rootCause?: string;
  resolution?: string;
  summary?: string;
}
