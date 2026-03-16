// Investigation Memory — persistent learning from past incidents via pgvector

export {
  storeInvestigation,
  updateFeedback,
  searchSimilar,
  searchByText,
  searchHybrid,
  detectRecurrence,
  getCalibrationStats,
  getRecentInvestigations,
} from "./store";

export {
  calibrateConfidence,
  buildHistoricalContext,
} from "./calibration";

export {
  buildEmbeddingText,
  generateLocalEmbedding,
  embedInvestigation,
  embedQuery,
} from "./embeddings";

export type {
  StoredInvestigation,
  StoredHypothesis,
  SimilarIncident,
  RecurrencePattern,
  CalibrationStats,
  StoreOptions,
} from "./types";
