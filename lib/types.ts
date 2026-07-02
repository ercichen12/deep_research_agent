export type ResearchStepStatus = "pending" | "running" | "done" | "error";

export type ResearchStep = {
  id: string;
  title: string;
  detail: string;
  status: ResearchStepStatus;
  timestamp: string;
};

export type SearchResult = {
  title: string;
  url: string;
};

export type SearchQueryPlan = {
  query: string;
  keywords: string[];
  rationale: string;
};

export type SearchLogEntry = {
  engine: string;
  query: string;
  keywords: string[];
  iteration?: number;
  status: "done" | "empty" | "error";
  results: SearchResult[];
  message?: string;
  timestamp: string;
};

export type ResearchSource = SearchResult & {
  snippet: string;
  fullText?: string;
  rawCharCount?: number;
  readCharCount?: number;
  evidenceCharCount?: number;
  extractionMethod?: "opencli" | "fetch" | "mixed";
};

export type CandidateStatus = "candidate" | "rejected" | "winner" | "unknown";

export type ResearchCandidate = {
  person: string;
  company: string;
  status: CandidateStatus;
  rationale: string;
};

export type ConditionStatus = "confirmed" | "contradicted" | "unknown" | "partial";

export type ConditionMatrixEntry = {
  candidate: string;
  condition: string;
  status: ConditionStatus;
  evidence: string;
  sourceUrls: string[];
};

export type ResearchIteration = {
  iteration: number;
  queries: SearchQueryPlan[];
  searchResults: SearchResult[];
  readSources: ResearchSource[];
  summary: string;
  candidates: ResearchCandidate[];
  conditionMatrix: ConditionMatrixEntry[];
  nextQueries: SearchQueryPlan[];
  nextQueryReason?: string;
  stopReason?: string;
  startedAt: string;
  completedAt: string;
};

export type DeepResearchLoopResult = {
  iterations: ResearchIteration[];
  sources: ResearchSource[];
  candidates: ResearchCandidate[];
  conditionMatrix: ConditionMatrixEntry[];
  nextQueries: SearchQueryPlan[];
  stopReason: string;
};

export type ResearchStreamEvent =
  | { type: "run_started"; runId: string; timestamp: string }
  | { type: "heartbeat"; timestamp: string }
  | { type: "step"; step: ResearchStep; timestamp: string }
  | { type: "search_done"; iteration: number; log: SearchLogEntry; timestamp: string }
  | { type: "read_done"; iteration: number; source: ResearchSource; timestamp: string }
  | { type: "iteration_done"; iteration: ResearchIteration; timestamp: string }
  | { type: "report_done"; report: string; model: string; timestamp: string }
  | { type: "log_saved"; path: string; timestamp: string }
  | { type: "final"; result: ResearchResponse; timestamp: string }
  | { type: "error"; message: string; timestamp: string };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ResearchResponse = {
  report: string;
  steps: ResearchStep[];
  sources: ResearchSource[];
  model: string;
  queries: SearchQueryPlan[];
  searchLogs: SearchLogEntry[];
  iterations?: ResearchIteration[];
  candidates?: ResearchCandidate[];
  conditionMatrix?: ConditionMatrixEntry[];
  stopReason?: string;
  searchLogPath?: string;
};
