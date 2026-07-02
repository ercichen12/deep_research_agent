import type { ResearchSource, SearchResult } from "@/lib/types";
import type { GraphHeavyEvent, GraphStateSummary } from "@/lib/heavy/graph/types";

export type HeavyStatus = "queued" | "running" | "completed" | "failed";

export type HeavyBudget = {
  maxRuns: number;
  maxAgentsPerRun: number;
  maxTotalAgents: number;
  maxSourcesPerAgent: number;
  agentConcurrency: number;
};

export const DEFAULT_HEAVY_BUDGET: HeavyBudget = {
  maxRuns: 3,
  maxAgentsPerRun: 6,
  maxTotalAgents: 14,
  maxSourcesPerAgent: 30,
  agentConcurrency: 3
};

export type HeavySearchProviderName = "relay" | "opencli" | "web" | "fetch" | "test";
export type HeavySearchEngine = "google" | "brave" | "duckduckgo" | "bing" | "relay" | "web" | "test";

export type HeavySearchResult = SearchResult & {
  snippet?: string;
  provider: HeavySearchProviderName;
  engine?: HeavySearchEngine | string;
};

export type HeavySource = HeavySearchResult &
  Pick<ResearchSource, "fullText" | "rawCharCount" | "readCharCount" | "evidenceCharCount" | "extractionMethod"> & {
    snippet: string;
  };

export type AgentTask = {
  id: string;
  role: string;
  title: string;
  objective: string;
  questions: string[];
  searchHints: string[];
};

export type CoordinatorPlan = {
  runIndex: number;
  objective: string;
  tasks: AgentTask[];
};

export type AgentFindingSupport = "supported" | "contradicted" | "unknown";
export type AgentFindingConfidence = "low" | "medium" | "high";

export type AgentFinding = {
  claim: string;
  support: AgentFindingSupport;
  confidence: AgentFindingConfidence;
  sourceUrls: string[];
};

export type AgentResearchStepType =
  | "intent"
  | "query_generation"
  | "search"
  | "reflection"
  | "keyword_revision"
  | "source_selection"
  | "read"
  | "finalize";

export type AgentResearchDecision = "continue" | "revise_query" | "read_sources" | "enough_evidence" | "stop";

export type AgentResearchStep = {
  id: string;
  type: AgentResearchStepType;
  title: string;
  detail: string;
  round?: number;
  queries?: string[];
  provider?: HeavySearchProviderName;
  engine?: HeavySearchEngine | string;
  resultCount?: number;
  selectedUrls?: string[];
  decision?: AgentResearchDecision;
  reason?: string;
  timestamp: string;
};

export type SearchAttemptLog = {
  provider: "relay" | "opencli" | "web" | "test";
  engine?: HeavySearchEngine | string;
  query: string;
  status: "done" | "empty" | "error";
  results: HeavySearchResult[];
  message?: string;
  timestamp: string;
  durationMs?: number;
};

export type ReadAttemptLog = {
  provider: "opencli" | "fetch" | "test";
  status: "done" | "error";
  title: string;
  url: string;
  readCharCount?: number;
  message?: string;
  timestamp: string;
  durationMs?: number;
};

export type AgentReport = {
  taskId: string;
  agentId: string;
  role: string;
  status: "completed" | "failed";
  summary: string;
  queries: string[];
  searchLogs: SearchAttemptLog[];
  readLogs: ReadAttemptLog[];
  researchSteps: AgentResearchStep[];
  sources: HeavySource[];
  findings: AgentFinding[];
  error?: string;
  startedAt: string;
  completedAt: string;
};

export type VerificationIssue = {
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
  relatedTaskId?: string;
  sourceUrl?: string;
};

export type VerificationReport = {
  status: "pass" | "needs_more_research" | "failed";
  summary: string;
  issues: VerificationIssue[];
  contradictions: VerificationIssue[];
  missingEvidence: string[];
  recommendedNextTasks: AgentTask[];
  unknowns: string[];
};

export type RunDecision = {
  action: "continue" | "finalize" | "finalize_with_uncertainty" | "fail";
  reason: string;
};

export type FinalReport = {
  markdown: string;
  summary: string;
  sourceUrls: string[];
  unknowns: string[];
  completedAt: string;
};

export type ResearchRun = {
  id: string;
  index: number;
  status: HeavyStatus;
  createdAt: string;
  updatedAt: string;
  coordinatorPlan?: CoordinatorPlan;
  agentReports: AgentReport[];
  verificationReport?: VerificationReport;
  decision?: RunDecision;
  error?: string;
};

export type Turn = {
  id: string;
  inquiryId: string;
  mode: "heavy";
  prompt: string;
  status: HeavyStatus;
  budget: HeavyBudget;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  runs: ResearchRun[];
  finalReport?: FinalReport;
  error?: string;
};

export type Inquiry = {
  id: string;
  prompt: string;
  mode: "heavy";
  status: HeavyStatus;
  createdAt: string;
  updatedAt: string;
  turns: Turn[];
  graphState?: GraphStateSummary;
};

export type LegacyHeavyEvent =
  | { type: "turn_started"; inquiryId: string; turnId: string; timestamp: string }
  | { type: "run_planned"; inquiryId: string; turnId: string; runId: string; runIndex: number; plan: CoordinatorPlan; timestamp: string }
  | { type: "agent_started"; inquiryId: string; turnId: string; runId: string; task: AgentTask; timestamp: string }
  | { type: "agent_research_step"; inquiryId: string; turnId: string; runId: string; taskId: string; step: AgentResearchStep; timestamp: string }
  | { type: "agent_search_log"; inquiryId: string; turnId: string; runId: string; taskId: string; log: SearchAttemptLog; timestamp: string }
  | { type: "agent_read_log"; inquiryId: string; turnId: string; runId: string; taskId: string; log: ReadAttemptLog; timestamp: string }
  | { type: "agent_reported"; inquiryId: string; turnId: string; runId: string; report: AgentReport; timestamp: string }
  | { type: "verification_started"; inquiryId: string; turnId: string; runId: string; timestamp: string }
  | { type: "verification_reported"; inquiryId: string; turnId: string; runId: string; report: VerificationReport; timestamp: string }
  | { type: "run_decision"; inquiryId: string; turnId: string; runId: string; decision: RunDecision; timestamp: string }
  | { type: "final_started"; inquiryId: string; turnId: string; timestamp: string }
  | { type: "final_reported"; inquiryId: string; turnId: string; report: FinalReport; timestamp: string }
  | { type: "turn_completed"; inquiryId: string; turnId: string; timestamp: string }
  | { type: "error"; inquiryId?: string; turnId?: string; runId?: string; message: string; timestamp: string };

export type HeavyEvent = LegacyHeavyEvent | GraphHeavyEvent;

export type HeavySearchProvider = {
  search: (query: string, limit?: number) => Promise<HeavySearchResult[]>;
  read: (result: HeavySearchResult) => Promise<HeavySource>;
  drainSearchLogs?: () => SearchAttemptLog[];
  drainReadLogs?: () => ReadAttemptLog[];
  forkTrace?: () => HeavySearchProvider;
};

export function normalizeBudget(input: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = process.env): HeavyBudget {
  return {
    maxRuns: boundedInt(input.maxRuns ?? env.HEAVY_MAX_RUNS, DEFAULT_HEAVY_BUDGET.maxRuns, 1, 8),
    maxAgentsPerRun: boundedInt(input.maxAgentsPerRun ?? env.HEAVY_MAX_AGENTS_PER_RUN, DEFAULT_HEAVY_BUDGET.maxAgentsPerRun, 1, 12),
    maxTotalAgents: boundedInt(input.maxTotalAgents ?? env.HEAVY_MAX_TOTAL_AGENTS, DEFAULT_HEAVY_BUDGET.maxTotalAgents, 1, 40),
    maxSourcesPerAgent: boundedInt(input.maxSourcesPerAgent ?? env.HEAVY_MAX_SOURCES_PER_AGENT, DEFAULT_HEAVY_BUDGET.maxSourcesPerAgent, 1, 60),
    agentConcurrency: boundedInt(input.agentConcurrency ?? env.HEAVY_AGENT_CONCURRENCY, DEFAULT_HEAVY_BUDGET.agentConcurrency, 1, 8)
  };
}

export function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error("Response did not include a JSON object");
  }

  const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Response JSON was not an object");
  }

  return parsed as Record<string, unknown>;
}

export function normalizeCoordinatorPlan(input: unknown, runIndex: number, budget: HeavyBudget): CoordinatorPlan {
  const item = objectRecord(input);
  const objective = text(item.objective) || `Run ${runIndex} research plan`;
  const tasks = Array.isArray(item.tasks)
    ? item.tasks.map(normalizeAgentTask).filter((task): task is AgentTask => Boolean(task)).slice(0, budget.maxAgentsPerRun)
    : [];

  return {
    runIndex,
    objective,
    tasks
  };
}

export function normalizeAgentTask(input: unknown): AgentTask | null {
  const item = objectRecord(input);
  const id = slug(text(item.id) || text(item.role) || text(item.title));
  const title = text(item.title);
  const objective = text(item.objective);
  const role = slug(text(item.role) || id);
  const questions = stringArray(item.questions);
  const searchHints = stringArray(item.searchHints);

  if (!id || !title || !objective) {
    return null;
  }

  return {
    id,
    role: role || id,
    title,
    objective,
    questions: questions.length ? questions : [objective],
    searchHints: searchHints.length ? searchHints : [title, objective]
  };
}

export function normalizeAgentReport(input: unknown): AgentReport {
  const item = objectRecord(input);
  const taskId = slug(text(item.taskId)) || "unknown_task";
  const role = slug(text(item.role)) || taskId;
  const now = new Date().toISOString();
  const sources = Array.isArray(item.sources)
    ? item.sources.map(normalizeHeavySource).filter((source): source is HeavySource => Boolean(source))
    : [];
  const searchLogs = Array.isArray(item.searchLogs)
    ? item.searchLogs.map(normalizeSearchAttemptLog).filter((log): log is SearchAttemptLog => Boolean(log))
    : [];
  const readLogs = Array.isArray(item.readLogs)
    ? item.readLogs.map(normalizeReadAttemptLog).filter((log): log is ReadAttemptLog => Boolean(log))
    : [];
  const findings = Array.isArray(item.findings)
    ? item.findings.map(normalizeAgentFinding).filter((finding): finding is AgentFinding => Boolean(finding))
    : [];
  const researchSteps = Array.isArray(item.researchSteps)
    ? item.researchSteps.map(normalizeAgentResearchStep).filter((step): step is AgentResearchStep => Boolean(step))
    : [];
  const status = item.status === "failed" ? "failed" : "completed";

  return {
    taskId,
    agentId: slug(text(item.agentId)) || `agent_${taskId}`,
    role,
    status,
    summary: text(item.summary) || (status === "failed" ? "Agent task failed." : "Agent task completed."),
    queries: stringArray(item.queries),
    searchLogs,
    readLogs,
    researchSteps,
    sources,
    findings,
    ...(text(item.error) ? { error: compactError(text(item.error)) } : {}),
    startedAt: text(item.startedAt) || now,
    completedAt: text(item.completedAt) || now
  };
}

export function normalizeHeavySearchResult(input: unknown, provider: HeavySearchProviderName): HeavySearchResult | null {
  const item = objectRecord(input);
  const title = text(item.title);
  const url = text(item.url);
  const snippet = text(item.snippet);
  const engine = text(item.engine);

  if (!title || !isHttpUrl(url)) {
    return null;
  }

  return {
    title,
    url,
    ...(snippet ? { snippet } : {}),
    ...(engine ? { engine } : {}),
    provider
  };
}

export function normalizeHeavySource(input: unknown): HeavySource | null {
  const item = objectRecord(input);
  const title = text(item.title);
  const url = text(item.url);
  const snippet = text(item.snippet) || text(item.fullText);

  if (!title || !isHttpUrl(url) || !snippet) {
    return null;
  }

  return {
    title,
    url,
    snippet,
    provider: normalizeProvider(item.provider),
    ...(text(item.engine) ? { engine: text(item.engine) } : {}),
    ...(text(item.fullText) ? { fullText: text(item.fullText) } : {}),
    ...(typeof item.rawCharCount === "number" ? { rawCharCount: item.rawCharCount } : {}),
    ...(typeof item.readCharCount === "number" ? { readCharCount: item.readCharCount } : {}),
    ...(typeof item.evidenceCharCount === "number" ? { evidenceCharCount: item.evidenceCharCount } : {}),
    ...(item.extractionMethod === "opencli" || item.extractionMethod === "fetch" || item.extractionMethod === "mixed"
      ? { extractionMethod: item.extractionMethod }
      : {})
  };
}

function normalizeSearchAttemptLog(input: unknown): SearchAttemptLog | null {
  const item = objectRecord(input);
  const query = text(item.query);
  const provider = item.provider === "relay" || item.provider === "opencli" || item.provider === "web" || item.provider === "test" ? item.provider : null;
  const status = item.status === "done" || item.status === "empty" || item.status === "error" ? item.status : null;
  if (!provider || !status || !query) {
    return null;
  }
  const results = Array.isArray(item.results)
    ? item.results.map((result) => normalizeHeavySearchResult(result, normalizeSearchResultProvider(provider))).filter((result): result is HeavySearchResult => Boolean(result))
    : [];
  return {
    provider,
    ...(text(item.engine) ? { engine: text(item.engine) } : {}),
    query,
    status,
    results,
    ...(text(item.message) ? { message: compactError(text(item.message)) } : {}),
    timestamp: text(item.timestamp) || new Date().toISOString(),
    ...(typeof item.durationMs === "number" ? { durationMs: item.durationMs } : {})
  };
}

function normalizeReadAttemptLog(input: unknown): ReadAttemptLog | null {
  const item = objectRecord(input);
  const title = text(item.title);
  const url = text(item.url);
  const provider = item.provider === "opencli" || item.provider === "fetch" || item.provider === "test" ? item.provider : null;
  const status = item.status === "done" || item.status === "error" ? item.status : null;
  if (!provider || !status || !title || !isHttpUrl(url)) {
    return null;
  }
  return {
    provider,
    status,
    title,
    url,
    ...(typeof item.readCharCount === "number" ? { readCharCount: item.readCharCount } : {}),
    ...(text(item.message) ? { message: compactError(text(item.message)) } : {}),
    timestamp: text(item.timestamp) || new Date().toISOString(),
    ...(typeof item.durationMs === "number" ? { durationMs: item.durationMs } : {})
  };
}

export function normalizeVerificationReport(input: unknown): VerificationReport {
  const item = objectRecord(input);
  const status =
    item.status === "pass" || item.status === "needs_more_research" || item.status === "failed" ? item.status : "needs_more_research";
  const issues = Array.isArray(item.issues)
    ? item.issues.map(normalizeVerificationIssue).filter((issue): issue is VerificationIssue => Boolean(issue))
    : [];
  const contradictions = Array.isArray(item.contradictions)
    ? item.contradictions.map(normalizeVerificationIssue).filter((issue): issue is VerificationIssue => Boolean(issue))
    : issues.filter((issue) => issue.type === "contradiction");
  const recommendedNextTasks = Array.isArray(item.recommendedNextTasks)
    ? item.recommendedNextTasks.map(normalizeAgentTask).filter((task): task is AgentTask => Boolean(task))
    : [];

  return {
    status,
    summary: text(item.summary) || "Verification completed.",
    issues,
    contradictions,
    missingEvidence: stringArray(item.missingEvidence),
    recommendedNextTasks,
    unknowns: stringArray(item.unknowns).length ? stringArray(item.unknowns) : stringArray(item.missingEvidence)
  };
}

export function compactError(value: string): string {
  return redactSecrets(value).split("\n").filter(Boolean).slice(0, 4).join("\n").slice(0, 500);
}

export function redactSecrets(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted-secret]");
}

function normalizeAgentFinding(input: unknown): AgentFinding | null {
  const item = objectRecord(input);
  const claim = text(item.claim);
  const sourceUrls = stringArray(item.sourceUrls).filter(isHttpUrl);

  if (!claim) {
    return null;
  }

  return {
    claim,
    support: item.support === "supported" || item.support === "contradicted" || item.support === "unknown" ? item.support : "unknown",
    confidence: item.confidence === "low" || item.confidence === "medium" || item.confidence === "high" ? item.confidence : "medium",
    sourceUrls
  };
}

function normalizeAgentResearchStep(input: unknown): AgentResearchStep | null {
  const item = objectRecord(input);
  const id = slug(text(item.id));
  const type = normalizeAgentResearchStepType(item.type);
  const title = text(item.title);
  const detail = text(item.detail);

  if (!id || !type || !title || !detail) {
    return null;
  }

  const provider = normalizeOptionalSearchProvider(item.provider);
  const queries = stringArray(item.queries).map(toEnglishStepText).filter(Boolean);
  const selectedUrls = stringArray(item.selectedUrls).filter(isHttpUrl);
  const decision = normalizeAgentResearchDecision(item.decision);

  return {
    id,
    type,
    title,
    detail,
    ...(typeof item.round === "number" && Number.isFinite(item.round) && item.round > 0 ? { round: Math.floor(item.round) } : {}),
    ...(queries.length ? { queries } : {}),
    ...(provider ? { provider } : {}),
    ...(text(item.engine) ? { engine: text(item.engine) } : {}),
    ...(typeof item.resultCount === "number" && Number.isFinite(item.resultCount) ? { resultCount: Math.max(0, Math.floor(item.resultCount)) } : {}),
    ...(selectedUrls.length ? { selectedUrls } : {}),
    ...(decision ? { decision } : {}),
    ...(text(item.reason) ? { reason: text(item.reason) } : {}),
    timestamp: text(item.timestamp) || new Date().toISOString()
  };
}

function normalizeAgentResearchStepType(input: unknown): AgentResearchStepType | null {
  return input === "intent" ||
    input === "query_generation" ||
    input === "search" ||
    input === "reflection" ||
    input === "keyword_revision" ||
    input === "source_selection" ||
    input === "read" ||
    input === "finalize"
    ? input
    : null;
}

function normalizeAgentResearchDecision(input: unknown): AgentResearchDecision | null {
  return input === "continue" ||
    input === "revise_query" ||
    input === "read_sources" ||
    input === "enough_evidence" ||
    input === "stop"
    ? input
    : null;
}

function normalizeOptionalSearchProvider(input: unknown): HeavySearchProviderName | null {
  return input === "relay" || input === "opencli" || input === "web" || input === "fetch" || input === "test" ? input : null;
}

function toEnglishStepText(value: string): string {
  return value
    .replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ")
    .replace(/[^a-zA-Z0-9 .,'"&:%/+_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVerificationIssue(input: unknown): VerificationIssue | null {
  const item = objectRecord(input);
  const message = text(item.message);
  if (!message) {
    return null;
  }

  return {
    type: slug(text(item.type)) || "issue",
    severity: item.severity === "low" || item.severity === "medium" || item.severity === "high" ? item.severity : "medium",
    message,
    ...(text(item.relatedTaskId) ? { relatedTaskId: slug(text(item.relatedTaskId)) } : {}),
    ...(isHttpUrl(text(item.sourceUrl)) ? { sourceUrl: text(item.sourceUrl) } : {})
  };
}

function normalizeProvider(value: unknown): HeavySearchProviderName {
  return value === "relay" || value === "opencli" || value === "web" || value === "fetch" || value === "test" ? value : "web";
}

function normalizeSearchResultProvider(provider: SearchAttemptLog["provider"]): HeavySearchProviderName {
  return provider === "relay" || provider === "opencli" || provider === "web" || provider === "test" ? provider : "web";
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function objectRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function text(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function stringArray(input: unknown): string[] {
  return Array.isArray(input) ? input.map(text).filter(Boolean) : [];
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
