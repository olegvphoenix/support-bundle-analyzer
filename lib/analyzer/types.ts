// Shared domain types for the support bundle analysis pipeline.

export type Severity = "critical" | "warning" | "info" | "noise";

export type Subsystem =
  | "license"
  | "cameras"
  | "archive"
  | "detectors"
  | "network"
  | "hardware"
  | "other";

export type ProductFamily = "axxon3" | "axxon5" | "unknown";

export interface BundleProfile {
  productFamily: ProductFamily;
  productName: string;
  version: string | null;
  host: string | null;
  collectedAt: string | null;
  locale: "ru" | "en" | "mixed";
}

// A single normalized log line.
export interface LogRecord {
  file: string;
  ts: string | null;
  thread: string | null;
  level: string | null;
  component: string | null;
  address: string | null;
  message: string;
  raw: string;
}

// A group of identical/similar log lines collapsed into one signature.
export interface AggregatedSignature {
  signature: string;
  level: string | null;
  component: string | null;
  sampleMessage: string;
  files: string[];
  count: number;
  firstTs: string | null;
  lastTs: string | null;
  addresses: string[];
  // Normalized entity ids this signature touches (cameras, objects, addresses,
  // threads) — used to correlate events across subsystems into causal chains.
  entities: string[];
  // Detected as a storm (high frequency over a short window).
  storm: boolean;
  peakPerMinute: number;
}

// A rule from the YAML knowledge base.
export interface Rule {
  id: string;
  severity: Severity;
  subsystem: Subsystem;
  title: string;
  // Matching is done against component and/or message (RU/EN patterns).
  match: {
    component?: string;
    anyOf?: string[];
    allOf?: string[];
  };
  // Optional frequency condition (storm detection).
  frequency?: {
    minPerMinute?: number;
  };
  cause?: string;
  solution?: string[];
  // Optional restriction to product families.
  appliesTo?: ProductFamily[];
  // Hint to retrieval/LLM: query terms for Lexiro.
  retrievalQuery?: string;
}

// A problem after rule matching (pre-LLM), referencing evidence.
export interface DetectedProblem {
  ruleId: string | null;
  severity: Severity;
  subsystem: Subsystem;
  title: string;
  cause?: string;
  solution?: string[];
  count: number;
  storm: boolean;
  evidence: AggregatedSignature[];
  retrievalQuery: string;
}

// System facts collected from non-log files.
export interface SystemFacts {
  disks: { name: string; totalMb: number; freeMb: number }[];
  licenseDongleFound: boolean;
  modulesCount: number | null;
  openPortsCount: number | null;
  notes: string[];
}

// Retrieved context from Lexiro (past Jira solutions + docs).
export interface RetrievedSource {
  kind: "jira" | "doc";
  title: string;
  url: string | null;
  snippet: string;
  similarity?: number;
}

export interface RetrievalResult {
  problemTitle: string;
  answer: string;
  confidence: number;
  sources: RetrievedSource[];
}

// Final problem shown in the UI (merges rules + LLM + RAG).
export interface ReportProblem {
  id: string;
  severity: Severity;
  subsystem: Subsystem;
  title: string;
  rootCause: string | null;
  impact: string | null;
  solution: string[];
  count: number;
  storm: boolean;
  confidence: number;
  ruleId: string | null;
  component: string | null;
  firstTs: string | null;
  lastTs: string | null;
  sampleMessages: string[];
  affectedFiles: string[];
  sources: RetrievedSource[];
  // Entities this problem touches; basis for cross-problem correlation.
  entities?: string[];
}

export interface NoiseItem {
  title: string;
  count: number;
  ruleId: string | null;
}

// A point on the events timeline (derived from detected problems).
export interface TimelineEvent {
  ts: string | null;
  severity: Severity;
  subsystem: Subsystem;
  title: string;
  count: number;
  storm: boolean;
}

// One ordered step within a correlated chain of events.
export interface CorrelationStep {
  problemId: string;
  ts: string | null;
  title: string;
  subsystem: Subsystem;
  severity: Severity;
}

// A set of problems that share a real-world entity (camera, object, address,
// thread), ordered in time — i.e. a candidate causal chain around that entity.
export interface CorrelationGroup {
  entity: string;
  entityKind: "camera" | "object" | "address" | "thread";
  label: string;
  severity: Severity;
  firstTs: string | null;
  lastTs: string | null;
  steps: CorrelationStep[];
}

export interface AnalysisReport {
  profile: BundleProfile;
  facts: SystemFacts;
  healthScore: number;
  summary: string;
  analyzedBy: "llm" | "rules";
  problems: ReportProblem[];
  noise: NoiseItem[];
  timeline: TimelineEvent[];
  // Cross-problem correlations grouped by shared entity (optional; older
  // reports created before this feature won't have it).
  correlations?: CorrelationGroup[];
  stats: {
    totalSignatures: number;
    errorCount: number;
    warnCount: number;
    noiseLineCount: number;
    logFiles: number;
  };
  createdAt: string;
}
