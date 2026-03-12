import type { Alert, InvestigationResult } from "@shared/types";

export class InvestigationAgent {
  async investigate(alert: Alert): Promise<InvestigationResult> {
    return {
      id: `inv-${Date.now()}`,
      alertId: alert.id,
      startedAt: new Date(),
      status: "in_progress",
      hypotheses: [],
    };
  }
}
