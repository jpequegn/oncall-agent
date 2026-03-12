// Main entry point — re-export the full pipeline for Slack Bot and other consumers
export { runFullInvestigation } from "./pipeline";
export type { FullInvestigationResult, PipelineOptions } from "./pipeline";
export { validate } from "./validator";
export type { ValidationResult, ValidatedHypothesis } from "./types";
export { recalibrateConfidence, shouldEscalate, rerankHypotheses } from "./scoring";
