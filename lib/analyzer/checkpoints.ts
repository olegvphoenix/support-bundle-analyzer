import type {
  AggregatedSignature,
  BundleProfile,
  DetectedProblem,
  RetrievalResult,
  SystemFacts,
} from "./types";

// Serializable artifacts persisted between pipeline stages so a later stage can
// resume without re-running the earlier (expensive) ones.

export interface ParseCheckpoint {
  profile: BundleProfile;
  facts: SystemFacts;
  signatures: AggregatedSignature[];
  errorCount: number;
  warnCount: number;
  logFiles: number;
}

export interface RulesCheckpoint {
  detected: DetectedProblem[];
  noiseLineCount: number;
}

export interface RetrievalCheckpoint {
  // Map serialized as entries (query -> retrieval result).
  retrievals: [string, RetrievalResult][];
}
