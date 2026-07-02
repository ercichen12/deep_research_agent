import { createHash } from "node:crypto";
import type { FinalReport, HeavySearchEngine, HeavySearchProviderName, HeavySearchResult, ReadAttemptLog } from "@/lib/heavy/types";

export type TaskKind =
  | "find_person_company"
  | "find_website"
  | "technical_verification"
  | "data_workflow_design"
  | "market_list_building"
  | "sales_strategy"
  | "general_research";

export type ConstraintKind = "hard" | "soft" | "exclusion";

export type Constraint = {
  id: string;
  label: string;
  kind: ConstraintKind;
  description?: string;
  core?: boolean;
};

export type ResearchAngle = {
  id: string;
  title: string;
  priority: "low" | "medium" | "high";
  querySeeds: string[];
};

export type Assumption = {
  id: string;
  text: string;
  status: "active" | "confirmed" | "rejected";
  evidenceIds: string[];
};

export type ConstraintMatch = {
  constraintId: string;
  status: "direct" | "proxy" | "contradicted";
  evidenceIds: string[];
};

export type MissingConstraint = {
  constraintId: string;
  reason: string;
  neededEvidence: string[];
};

export type QueryClue = {
  id: string;
  text: string;
  source: "prompt" | "search_result" | "source" | "candidate" | "evaluator";
  relatedCandidateId?: string;
  weight: number;
};

export type RejectedPath = {
  id: string;
  title: string;
  reason: string;
  evidenceIds: string[];
  rejectedAt: string;
};

export type SourceSummary = {
  sourceHash: string;
  title: string;
  url: string;
  provider: HeavySearchProviderName;
  engine?: string;
  status: "selected" | "read" | "snippet_only" | "error";
  readCharCount?: number;
  evidenceIds: string[];
};

export type SearchBatchArtifact = {
  id: string;
  inquiryId: string;
  turnId: string;
  actionId: string;
  cycle: number;
  queries: string[];
  providerCalls: Array<{
    provider: "relay" | "opencli" | "web";
    engine?: "google" | "brave" | "duckduckgo" | "bing" | "relay" | string;
    query: string;
    status: "done" | "empty" | "error" | "timeout";
    durationMs: number;
    results: HeavySearchResult[];
    message?: string;
  }>;
  dedupedResults: HeavySearchResult[];
  createdAt: string;
};

export type SourceArtifact = {
  sourceHash: string;
  inquiryId: string;
  turnId: string;
  title: string;
  url: string;
  provider: HeavySearchProviderName;
  engine?: string;
  status: "selected" | "read" | "snippet_only" | "error";
  readCharCount?: number;
  fullText?: string;
  excerpt?: string;
  readLogs?: ReadAttemptLog[];
  createdAt: string;
};

export type GraphBudgetState = {
  maxCycles: number;
  maxActionsPerCycle: number;
  maxSearchActionsPerCycle: number;
  maxQueriesPerSearchAction: number;
  maxResultsPerQuery: number;
  maxSourcesToReadPerCycle: number;
  maxTotalSourcesToRead: number;
  maxPromotedCandidates: number;
  cyclesUsed: number;
  actionsUsed: number;
  searchActionsUsed: number;
  queriesUsed: number;
  sourcesRead: number;
};

export const DEFAULT_GRAPH_BUDGET: GraphBudgetState = {
  maxCycles: 8,
  maxActionsPerCycle: 6,
  maxSearchActionsPerCycle: 4,
  maxQueriesPerSearchAction: 4,
  maxResultsPerQuery: 30,
  maxSourcesToReadPerCycle: 12,
  maxTotalSourcesToRead: 80,
  maxPromotedCandidates: 8,
  cyclesUsed: 0,
  actionsUsed: 0,
  searchActionsUsed: 0,
  queriesUsed: 0,
  sourcesRead: 0
};

export type ResearchFrame = {
  id: string;
  taskKind: TaskKind;
  userGoal: string;
  deliverable: string;
  hardConstraints: Constraint[];
  softPreferences: Constraint[];
  exclusionRules: Constraint[];
  evidencePolicy: {
    directEvidenceRequired: boolean;
    proxyEvidenceAllowed: boolean;
    unknownsMustBeLabeled: boolean;
  };
  searchPolicy: {
    defaultLanguage: "en";
    engines: Array<"google" | "brave" | "duckduckgo" | "relay" | "web">;
    maxResultsPerQuery: number;
  };
  rankingPolicy: {
    mustRankWhenEvidenceExists: boolean;
    maxRankedCandidates: number;
  };
  stopCriteria: string[];
  initialAngles: ResearchAngle[];
  assumptions: Assumption[];
};

export type SearchQuality = "empty" | "weak" | "mixed" | "strong";

export type SearchBatchSummary = {
  id: string;
  actionId: string;
  cycle: number;
  queries?: string[];
  queryCount: number;
  providerCalls: Array<{
    provider: "relay" | "opencli" | "web";
    engine?: "google" | "brave" | "duckduckgo" | "bing" | "relay";
    query: string;
    status: "done" | "empty" | "error" | "timeout";
    resultCount: number;
    durationMs: number;
    artifactId: string;
    message?: string;
  }>;
  dedupedResultCount: number;
  uniqueDomainCount: number;
  expectedSignalHits: string[];
  officialOrPrimaryCount: number;
  candidateMentions: string[];
  quality: SearchQuality;
};

export type SearchWebAction = {
  id: string;
  type: "search_web";
  purpose: string;
  rationale: string;
  priority: "low" | "medium" | "high";
  queries: string[];
  expectedSignals: string[];
  targetCandidateId?: string;
  maxResults: number;
};

export type ReadSourceAction = {
  id: string;
  type: "read_source";
  purpose: string;
  rationale: string;
  urls: string[];
  targetCandidateId?: string;
};

export type AnalysisAction = {
  id: string;
  type: "extract_evidence" | "verify_candidate" | "compare_candidates" | "rank_candidates";
  purpose: string;
  rationale: string;
  targetCandidateIds?: string[];
};

export type ResearchAction = SearchWebAction | ReadSourceAction | AnalysisAction;

export type EvidenceStrength = "direct" | "proxy" | "weak" | "contradictory";
export type EvidenceSourceType = "official" | "profile" | "news" | "directory" | "database" | "social" | "forum" | "snippet" | "other";

export type EvidenceItem = {
  id: string;
  claim: string;
  subjectIds: string[];
  constraintIds: string[];
  sourceHash?: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceType: EvidenceSourceType;
  provider: HeavySearchProviderName;
  engine?: HeavySearchEngine | string;
  quote?: string;
  paraphrase: string;
  strength: EvidenceStrength;
  confidence: "low" | "medium" | "high";
  extractedAt: string;
};

export type EvidenceMatrixCell = {
  candidateId: string;
  constraintId: string;
  status: "direct" | "proxy" | "missing" | "contradicted" | "excluded" | "unknown";
  evidenceIds: string[];
  bestSourceUrls: string[];
  rationale: string;
  updatedAt: string;
};

export type EvidenceMatrix = {
  constraintIds: string[];
  candidateIds: string[];
  cells: EvidenceMatrixCell[];
};

export type Candidate = {
  id: string;
  kind: "person_company" | "website" | "company" | "service" | "workflow" | "channel" | "other";
  name: string;
  aliases: string[];
  summary: string;
  entities: Record<string, string>;
  matchedConstraints: ConstraintMatch[];
  missingConstraints: MissingConstraint[];
  directEvidenceIds: string[];
  proxyEvidenceIds: string[];
  risks: string[];
  score: number;
  confidence: "low" | "medium" | "high";
  status: "active" | "promoted" | "ranked" | "rejected";
};

export type EvidenceExtractionOutput = {
  evidenceItems: EvidenceItem[];
  candidates: Candidate[];
  queryClues: QueryClue[];
  rejectedPaths: RejectedPath[];
};

export type EvaluatorDecision = {
  id: string;
  cycle: number;
  action: "continue" | "revise_query" | "promote_candidate" | "compare_candidates" | "rank" | "finalize" | "fail";
  reason: string;
  nextFocus: string[];
  unresolvedQuestions: string[];
  createdAt: string;
};

export type GraphHeavyEvent =
  | { type: "frame_created"; inquiryId: string; turnId: string; frame: ResearchFrame; timestamp: string }
  | { type: "cycle_started"; inquiryId: string; turnId: string; cycle: number; timestamp: string }
  | { type: "actions_planned"; inquiryId: string; turnId: string; cycle: number; actions: ResearchAction[]; timestamp: string }
  | { type: "action_started"; inquiryId: string; turnId: string; cycle: number; action: ResearchAction; timestamp: string }
  | { type: "search_batch_reported"; inquiryId: string; turnId: string; cycle: number; actionId: string; batch: SearchBatchSummary; timestamp: string }
  | { type: "source_selected"; inquiryId: string; turnId: string; cycle: number; actionId: string; urls: string[]; timestamp: string }
  | { type: "source_read"; inquiryId: string; turnId: string; cycle: number; source: SourceSummary; timestamp: string }
  | { type: "evidence_extracted"; inquiryId: string; turnId: string; cycle: number; evidence: EvidenceItem[]; timestamp: string }
  | { type: "candidate_extracted"; inquiryId: string; turnId: string; cycle: number; candidates: Candidate[]; timestamp: string }
  | { type: "candidate_promoted"; inquiryId: string; turnId: string; cycle: number; candidate: Candidate; reason: string; timestamp: string }
  | { type: "candidate_rejected"; inquiryId: string; turnId: string; cycle: number; candidateId: string; reason: string; timestamp: string }
  | { type: "state_evaluated"; inquiryId: string; turnId: string; cycle: number; decision: EvaluatorDecision; timestamp: string }
  | { type: "ranking_completed"; inquiryId: string; turnId: string; candidates: Candidate[]; timestamp: string }
  | { type: "graph_final_reported"; inquiryId: string; turnId: string; report: FinalReport; timestamp: string };

export type ResearchState = {
  id: string;
  inquiryId: string;
  turnId: string;
  frame: ResearchFrame;
  cycleIndex: number;
  actions: ResearchAction[];
  searchLedger: SearchBatchSummary[];
  sourceLedger: SourceSummary[];
  evidenceItems: EvidenceItem[];
  candidatePool: Candidate[];
  evidenceMatrix: EvidenceMatrix;
  rejectedPaths: RejectedPath[];
  queryClues: QueryClue[];
  evaluatorDecisions: EvaluatorDecision[];
  budgets: GraphBudgetState;
  status: "running" | "completed" | "failed";
  finalReport?: FinalReport;
  updatedAt: string;
};

export type GraphStateSummary = {
  frame: Pick<ResearchFrame, "taskKind" | "userGoal" | "deliverable" | "hardConstraints" | "softPreferences" | "exclusionRules">;
  status: "running" | "completed" | "failed";
  cycleIndex: number;
  actionCount: number;
  searchBatchCount: number;
  sourceCount: number;
  evidenceCount: number;
  candidates: Array<
    Pick<
      Candidate,
      "id" | "kind" | "name" | "aliases" | "summary" | "matchedConstraints" | "missingConstraints" | "score" | "confidence" | "status"
    >
  >;
  evidenceMatrix: EvidenceMatrix;
  rejectedPaths: RejectedPath[];
  evaluatorDecisions: EvaluatorDecision[];
  recentSearchBatches: SearchBatchSummary[];
  recentSources: SourceSummary[];
  stale?: boolean;
  staleReason?: string;
  lastHeartbeatAt?: string;
  updatedAt: string;
};

export function normalizeGraphBudget(input: Record<string, unknown> = {}, env: Record<string, string | undefined> = process.env): GraphBudgetState {
  return {
    maxCycles: boundedInt(input.maxCycles ?? env.GRAPH_MAX_CYCLES, DEFAULT_GRAPH_BUDGET.maxCycles, 1, 32),
    maxActionsPerCycle: boundedInt(input.maxActionsPerCycle ?? env.GRAPH_MAX_ACTIONS_PER_CYCLE, DEFAULT_GRAPH_BUDGET.maxActionsPerCycle, 1, 24),
    maxSearchActionsPerCycle: boundedInt(
      input.maxSearchActionsPerCycle ?? env.GRAPH_MAX_SEARCH_ACTIONS_PER_CYCLE,
      DEFAULT_GRAPH_BUDGET.maxSearchActionsPerCycle,
      1,
      16
    ),
    maxQueriesPerSearchAction: boundedInt(
      input.maxQueriesPerSearchAction ?? env.GRAPH_MAX_QUERIES_PER_SEARCH_ACTION,
      DEFAULT_GRAPH_BUDGET.maxQueriesPerSearchAction,
      1,
      12
    ),
    maxResultsPerQuery: boundedInt(input.maxResultsPerQuery ?? env.GRAPH_MAX_RESULTS_PER_QUERY, DEFAULT_GRAPH_BUDGET.maxResultsPerQuery, 1, 100),
    maxSourcesToReadPerCycle: boundedInt(
      input.maxSourcesToReadPerCycle ?? env.GRAPH_MAX_SOURCES_TO_READ_PER_CYCLE,
      DEFAULT_GRAPH_BUDGET.maxSourcesToReadPerCycle,
      1,
      40
    ),
    maxTotalSourcesToRead: boundedInt(
      input.maxTotalSourcesToRead ?? env.GRAPH_MAX_TOTAL_SOURCES_TO_READ,
      DEFAULT_GRAPH_BUDGET.maxTotalSourcesToRead,
      1,
      200
    ),
    maxPromotedCandidates: boundedInt(
      input.maxPromotedCandidates ?? env.GRAPH_MAX_PROMOTED_CANDIDATES,
      DEFAULT_GRAPH_BUDGET.maxPromotedCandidates,
      1,
      30
    ),
    cyclesUsed: boundedInt(input.cyclesUsed, 0, 0, 1000),
    actionsUsed: boundedInt(input.actionsUsed, 0, 0, 10000),
    searchActionsUsed: boundedInt(input.searchActionsUsed, 0, 0, 10000),
    queriesUsed: boundedInt(input.queriesUsed, 0, 0, 100000),
    sourcesRead: boundedInt(input.sourcesRead, 0, 0, 100000)
  };
}

export function normalizeResearchFrame(input: unknown, budget: GraphBudgetState = DEFAULT_GRAPH_BUDGET): ResearchFrame {
  const item = objectRecord(input);
  const taskKindText = text(item.taskKind);
  const taskKind = taskKinds.has(taskKindText as TaskKind) ? (taskKindText as TaskKind) : "general_research";
  const userGoal = text(item.userGoal) || text(item.prompt) || "Research the user's question.";
  const deliverable = text(item.deliverable) || "Evidence-backed markdown report";
  const hardConstraints = normalizeConstraints(item.hardConstraints, "hard");
  const softPreferences = normalizeConstraints(item.softPreferences, "soft");
  const exclusionRules = normalizeConstraints(item.exclusionRules, "exclusion");
  const initialAngles = normalizeResearchAngles(item.initialAngles);
  const assumptions = normalizeAssumptions(item.assumptions);

  return {
    id: text(item.id) || `frame_${shortHash(`${taskKind}:${userGoal}:${deliverable}`)}`,
    taskKind,
    userGoal,
    deliverable,
    hardConstraints,
    softPreferences,
    exclusionRules,
    evidencePolicy: {
      directEvidenceRequired: booleanValue(objectRecord(item.evidencePolicy).directEvidenceRequired, true),
      proxyEvidenceAllowed: booleanValue(objectRecord(item.evidencePolicy).proxyEvidenceAllowed, true),
      unknownsMustBeLabeled: booleanValue(objectRecord(item.evidencePolicy).unknownsMustBeLabeled, true)
    },
    searchPolicy: {
      defaultLanguage: "en",
      engines: normalizeSearchEngines(objectRecord(item.searchPolicy).engines),
      maxResultsPerQuery: boundedInt(objectRecord(item.searchPolicy).maxResultsPerQuery, budget.maxResultsPerQuery, 1, 100)
    },
    rankingPolicy: {
      mustRankWhenEvidenceExists: booleanValue(objectRecord(item.rankingPolicy).mustRankWhenEvidenceExists, true),
      maxRankedCandidates: boundedInt(objectRecord(item.rankingPolicy).maxRankedCandidates, 5, 1, 20)
    },
    stopCriteria: stringArray(item.stopCriteria),
    initialAngles,
    assumptions
  };
}

export function normalizeResearchActions(input: unknown, cycle: number, budget: GraphBudgetState = DEFAULT_GRAPH_BUDGET): ResearchAction[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const actions: ResearchAction[] = [];
  let searchActions = 0;
  for (const raw of input) {
    if (actions.length >= budget.maxActionsPerCycle) {
      break;
    }

    const item = objectRecord(raw);
    const type = text(item.type);
    if (type === "search_web") {
      if (searchActions >= budget.maxSearchActionsPerCycle) {
        continue;
      }
      const queries = stringArray(item.queries)
        .map(toEnglishSearchText)
        .filter(isMeaningfulEnglishQuery)
        .filter(unique)
        .slice(0, budget.maxQueriesPerSearchAction);
      const purpose = text(item.purpose);
      const rationale = text(item.rationale);
      if (!purpose || !queries.length) {
        continue;
      }
      searchActions += 1;
      actions.push({
        id: text(item.id) || createActionId(cycle, "search_web", purpose, actions.length + 1),
        type: "search_web",
        purpose,
        rationale: rationale || purpose,
        priority: normalizePriority(item.priority),
        queries,
        expectedSignals: stringArray(item.expectedSignals).map(toEnglishSearchText).filter(Boolean),
        ...(text(item.targetCandidateId) ? { targetCandidateId: text(item.targetCandidateId) } : {}),
        maxResults: Math.min(boundedInt(item.maxResults, budget.maxResultsPerQuery, 1, 100), budget.maxResultsPerQuery)
      });
      continue;
    }

    if (type === "read_source") {
      const urls = stringArray(item.urls).filter(isValidUrl).filter(unique);
      const purpose = text(item.purpose);
      const rationale = text(item.rationale);
      if (!purpose || !urls.length) {
        continue;
      }
      actions.push({
        id: text(item.id) || createActionId(cycle, "read_source", purpose, actions.length + 1),
        type: "read_source",
        purpose,
        rationale: rationale || purpose,
        urls,
        ...(text(item.targetCandidateId) ? { targetCandidateId: text(item.targetCandidateId) } : {})
      });
      continue;
    }

    if (analysisActionTypes.has(type)) {
      const purpose = text(item.purpose);
      const rationale = text(item.rationale);
      if (!purpose) {
        continue;
      }
      actions.push({
        id: text(item.id) || createActionId(cycle, type as AnalysisAction["type"], purpose, actions.length + 1),
        type: type as AnalysisAction["type"],
        purpose,
        rationale: rationale || purpose,
        targetCandidateIds: stringArray(item.targetCandidateIds).map(slug).filter(Boolean)
      });
    }
  }

  return actions;
}

export function normalizeEvidenceExtractionOutput(input: unknown): EvidenceExtractionOutput {
  const item = objectRecord(input);
  return {
    evidenceItems: Array.isArray(item.evidenceItems)
      ? item.evidenceItems.map(normalizeEvidenceItem).filter((evidence): evidence is EvidenceItem => Boolean(evidence))
      : [],
    candidates: Array.isArray(item.candidates)
      ? item.candidates.map(normalizeCandidate).filter((candidate): candidate is Candidate => Boolean(candidate))
      : [],
    queryClues: Array.isArray(item.queryClues)
      ? item.queryClues.map(normalizeQueryClue).filter((clue): clue is QueryClue => Boolean(clue))
      : [],
    rejectedPaths: Array.isArray(item.rejectedPaths)
      ? item.rejectedPaths.map(normalizeRejectedPath).filter((path): path is RejectedPath => Boolean(path))
      : []
  };
}

export function createResearchState(input: {
  inquiryId: string;
  turnId: string;
  frame: ResearchFrame;
  budget?: GraphBudgetState | Record<string, unknown>;
}): ResearchState {
  const now = new Date().toISOString();
  return {
    id: `graph_${input.turnId}`,
    inquiryId: input.inquiryId,
    turnId: input.turnId,
    frame: input.frame,
    cycleIndex: 0,
    actions: [],
    searchLedger: [],
    sourceLedger: [],
    evidenceItems: [],
    candidatePool: [],
    evidenceMatrix: createEmptyEvidenceMatrix(input.frame, []),
    rejectedPaths: [],
    queryClues: [],
    evaluatorDecisions: [],
    budgets: normalizeGraphBudget(input.budget && !("maxCycles" in input.budget) ? input.budget : (input.budget as Record<string, unknown>) ?? {}),
    status: "running",
    updatedAt: now
  };
}

export function createEmptyEvidenceMatrix(frame: ResearchFrame, candidates: Candidate[]): EvidenceMatrix {
  const constraints = [...frame.hardConstraints, ...frame.softPreferences, ...frame.exclusionRules];
  return {
    constraintIds: constraints.map((constraint) => constraint.id),
    candidateIds: candidates.map((candidate) => candidate.id),
    cells: []
  };
}

export function summarizeGraphState(state: ResearchState): GraphStateSummary {
  return {
    frame: {
      taskKind: state.frame.taskKind,
      userGoal: state.frame.userGoal,
      deliverable: state.frame.deliverable,
      hardConstraints: state.frame.hardConstraints,
      softPreferences: state.frame.softPreferences,
      exclusionRules: state.frame.exclusionRules
    },
    status: state.status,
    cycleIndex: state.cycleIndex,
    actionCount: state.actions.length,
    searchBatchCount: state.searchLedger.length,
    sourceCount: state.sourceLedger.length,
    evidenceCount: state.evidenceItems.length,
    candidates: state.candidatePool.map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      name: candidate.name,
      aliases: candidate.aliases,
      summary: candidate.summary,
      matchedConstraints: candidate.matchedConstraints,
      missingConstraints: candidate.missingConstraints,
      score: candidate.score,
      confidence: candidate.confidence,
      status: candidate.status
    })),
    evidenceMatrix: state.evidenceMatrix,
    rejectedPaths: state.rejectedPaths,
    evaluatorDecisions: state.evaluatorDecisions,
    recentSearchBatches: state.searchLedger.slice(-20),
    recentSources: state.sourceLedger.slice(-20),
    updatedAt: state.updatedAt
  };
}

function normalizeEvidenceItem(input: unknown): EvidenceItem | null {
  const item = objectRecord(input);
  const claim = text(item.claim);
  const sourceUrl = text(item.sourceUrl);
  if (!claim || !isValidUrl(sourceUrl)) {
    return null;
  }
  const sourceHash = text(item.sourceHash) || shortHash(normalizeUrl(sourceUrl), 32);
  return {
    id: text(item.id) || `ev_${sourceHash}_${shortHash(claim, 10)}`,
    claim,
    subjectIds: stringArray(item.subjectIds).map(slug).filter(Boolean),
    constraintIds: stringArray(item.constraintIds).map(slug).filter(Boolean),
    sourceHash,
    sourceUrl,
    sourceTitle: text(item.sourceTitle) || sourceUrl,
    sourceType: normalizeSourceType(item.sourceType),
    provider: normalizeProvider(item.provider),
    ...(text(item.engine) ? { engine: text(item.engine) } : {}),
    ...(text(item.quote) ? { quote: text(item.quote) } : {}),
    paraphrase: text(item.paraphrase) || claim,
    strength: normalizeEvidenceStrength(item.strength),
    confidence: normalizeConfidence(item.confidence),
    extractedAt: text(item.extractedAt) || new Date().toISOString()
  };
}

function normalizeCandidate(input: unknown): Candidate | null {
  const item = objectRecord(input);
  const name = text(item.name);
  if (!name) {
    return null;
  }
  const kind = normalizeCandidateKind(item.kind);
  return {
    id: text(item.id) || `cand_${kind}_${shortHash(normalizedName(name), 12)}`,
    kind,
    name,
    aliases: stringArray(item.aliases).filter(Boolean).filter(unique),
    summary: text(item.summary) || name,
    entities: stringRecord(item.entities),
    matchedConstraints: Array.isArray(item.matchedConstraints)
      ? item.matchedConstraints.map(normalizeConstraintMatch).filter((match): match is ConstraintMatch => Boolean(match))
      : [],
    missingConstraints: Array.isArray(item.missingConstraints)
      ? item.missingConstraints.map(normalizeMissingConstraint).filter((missing): missing is MissingConstraint => Boolean(missing))
      : [],
    directEvidenceIds: stringArray(item.directEvidenceIds).map(slug).filter(Boolean),
    proxyEvidenceIds: stringArray(item.proxyEvidenceIds).map(slug).filter(Boolean),
    risks: stringArray(item.risks),
    score: clampInt(item.score, 0, 100, 0),
    confidence: normalizeConfidence(item.confidence),
    status: normalizeCandidateStatus(item.status)
  };
}

function normalizeQueryClue(input: unknown): QueryClue | null {
  const item = objectRecord(input);
  const clueText = toEnglishSearchText(text(item.text));
  if (!clueText) {
    return null;
  }
  const source = queryClueSources.has(text(item.source)) ? (text(item.source) as QueryClue["source"]) : "evaluator";
  return {
    id: text(item.id) || `clue_${shortHash(clueText, 12)}`,
    text: clueText,
    source,
    ...(text(item.relatedCandidateId) ? { relatedCandidateId: slug(text(item.relatedCandidateId)) } : {}),
    weight: clampInt(item.weight, 0, 10, 1)
  };
}

function normalizeRejectedPath(input: unknown): RejectedPath | null {
  const item = objectRecord(input);
  const title = text(item.title);
  const reason = text(item.reason);
  if (!title || !reason) {
    return null;
  }
  return {
    id: text(item.id) || `reject_${shortHash(`${title}:${reason}`, 12)}`,
    title,
    reason,
    evidenceIds: stringArray(item.evidenceIds).map(slug).filter(Boolean),
    rejectedAt: text(item.rejectedAt) || new Date().toISOString()
  };
}

function normalizeConstraintMatch(input: unknown): ConstraintMatch | null {
  const item = objectRecord(input);
  const constraintId = slug(text(item.constraintId));
  if (!constraintId) {
    return null;
  }
  const status = constraintMatchStatuses.has(text(item.status)) ? (text(item.status) as ConstraintMatch["status"]) : "proxy";
  return {
    constraintId,
    status,
    evidenceIds: stringArray(item.evidenceIds).map(slug).filter(Boolean)
  };
}

function normalizeMissingConstraint(input: unknown): MissingConstraint | null {
  const item = objectRecord(input);
  const constraintId = slug(text(item.constraintId));
  if (!constraintId) {
    return null;
  }
  return {
    constraintId,
    reason: text(item.reason) || "Evidence not found yet.",
    neededEvidence: stringArray(item.neededEvidence)
  };
}

function normalizeConstraints(input: unknown, kind: ConstraintKind): Constraint[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((raw) => {
      const item = objectRecord(raw);
      const label = text(item.label);
      const id = slug(text(item.id) || label);
      if (!id || !label) {
        return null;
      }
      return {
        id,
        label,
        kind,
        ...(text(item.description) ? { description: text(item.description) } : {}),
        ...(typeof item.core === "boolean" ? { core: item.core } : {})
      } satisfies Constraint;
    })
    .filter((constraint): constraint is Constraint => Boolean(constraint));
}

function normalizeResearchAngles(input: unknown): ResearchAngle[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((raw) => {
      const item = objectRecord(raw);
      const title = text(item.title);
      const id = slug(text(item.id) || title);
      const querySeeds = stringArray(item.querySeeds).map(toEnglishSearchText).filter(Boolean);
      if (!id || !title || !querySeeds.length) {
        return null;
      }
      return {
        id,
        title,
        priority: normalizePriority(item.priority),
        querySeeds
      } satisfies ResearchAngle;
    })
    .filter((angle): angle is ResearchAngle => Boolean(angle));
}

function normalizeAssumptions(input: unknown): Assumption[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((raw) => {
      const item = objectRecord(raw);
      const assumptionText = text(item.text);
      if (!assumptionText) {
        return null;
      }
      const status = assumptionStatuses.has(text(item.status)) ? (text(item.status) as Assumption["status"]) : "active";
      return {
        id: text(item.id) || `assumption_${shortHash(assumptionText, 12)}`,
        text: assumptionText,
        status,
        evidenceIds: stringArray(item.evidenceIds).map(slug).filter(Boolean)
      } satisfies Assumption;
    })
    .filter((assumption): assumption is Assumption => Boolean(assumption));
}

function normalizeSearchEngines(input: unknown): ResearchFrame["searchPolicy"]["engines"] {
  const defaults: ResearchFrame["searchPolicy"]["engines"] = ["relay", "google", "brave", "duckduckgo", "web"];
  if (!Array.isArray(input)) {
    return defaults;
  }
  const engines = input
    .map(text)
    .filter((engine): engine is ResearchFrame["searchPolicy"]["engines"][number] =>
      ["google", "brave", "duckduckgo", "relay", "web"].includes(engine)
    )
    .filter(unique);
  return engines.length ? engines : defaults;
}

function createActionId(cycle: number, type: ResearchAction["type"], purpose: string, index: number): string {
  return `act_${cycle}_${type}_${slug(purpose).slice(0, 32)}_${index}`;
}

function toEnglishSearchText(value: string): string {
  const normalized = value
    .replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ")
    .replace(/[^\w\s:./"'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return limitSearchText(normalized);
}

function isMeaningfulEnglishQuery(value: string): boolean {
  return /[a-z]/i.test(value) && (value.length >= 4 || /^site:/i.test(value));
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return value.trim();
  }
}

function normalizedName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortHash(value: string, length = 12): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function objectRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function stringRecord(input: unknown): Record<string, string> {
  const item = objectRecord(input);
  const entries = Object.entries(item)
    .map(([key, value]) => [key, text(value)] as const)
    .filter(([, value]) => value);
  return Object.fromEntries(entries);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(text).filter(Boolean);
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePriority(value: unknown): "low" | "medium" | "high" {
  const priority = text(value);
  return priority === "low" || priority === "high" ? priority : "medium";
}

function normalizeSourceType(value: unknown): EvidenceSourceType {
  const sourceType = text(value);
  return evidenceSourceTypes.has(sourceType as EvidenceSourceType) ? (sourceType as EvidenceSourceType) : "other";
}

function normalizeEvidenceStrength(value: unknown): EvidenceStrength {
  const strength = text(value);
  return evidenceStrengths.has(strength as EvidenceStrength) ? (strength as EvidenceStrength) : "weak";
}

function normalizeConfidence(value: unknown): "low" | "medium" | "high" {
  const confidence = text(value);
  return confidence === "medium" || confidence === "high" ? confidence : "low";
}

function normalizeProvider(value: unknown): HeavySearchProviderName {
  const provider = text(value);
  return heavyProviders.has(provider) ? (provider as HeavySearchProviderName) : "test";
}

function normalizeCandidateKind(value: unknown): Candidate["kind"] {
  const kind = text(value);
  return candidateKinds.has(kind) ? (kind as Candidate["kind"]) : "other";
}

function normalizeCandidateStatus(value: unknown): Candidate["status"] {
  const status = text(value);
  return candidateStatuses.has(status) ? (status as Candidate["status"]) : "active";
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}

function limitSearchText(value: string): string {
  const maxLength = 140;
  if (value.length <= maxLength) {
    return value;
  }

  const kept: string[] = [];
  for (const word of value.split(/\s+/)) {
    const next = [...kept, word].join(" ");
    if (next.length > maxLength) {
      break;
    }
    kept.push(word);
  }
  return kept.join(" ");
}

const taskKinds = new Set<TaskKind>([
  "find_person_company",
  "find_website",
  "technical_verification",
  "data_workflow_design",
  "market_list_building",
  "sales_strategy",
  "general_research"
]);
const analysisActionTypes = new Set(["extract_evidence", "verify_candidate", "compare_candidates", "rank_candidates"]);
const assumptionStatuses = new Set(["active", "confirmed", "rejected"]);
const queryClueSources = new Set(["prompt", "search_result", "source", "candidate", "evaluator"]);
const constraintMatchStatuses = new Set(["direct", "proxy", "contradicted"]);
const evidenceSourceTypes = new Set<EvidenceSourceType>(["official", "profile", "news", "directory", "database", "social", "forum", "snippet", "other"]);
const evidenceStrengths = new Set<EvidenceStrength>(["direct", "proxy", "weak", "contradictory"]);
const heavyProviders = new Set(["relay", "opencli", "web", "fetch", "test"]);
const candidateKinds = new Set(["person_company", "website", "company", "service", "workflow", "channel", "other"]);
const candidateStatuses = new Set(["active", "promoted", "ranked", "rejected"]);
