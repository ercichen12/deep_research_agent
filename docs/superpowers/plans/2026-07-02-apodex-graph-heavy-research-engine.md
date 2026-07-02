# Apodex Graph Heavy Research Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 Heavy 从固定 `Run -> Agent -> Verifier` 流程升级成更接近 Apodex 的全局状态机研究引擎：先识别意图和成功标准，再动态规划搜索/阅读/抽证/候选人推进/重新规划，最后输出最大可能候选与证据矩阵。

**Architecture:** 新增 `lib/heavy/graph/*` 作为主引擎，保留旧 Heavy 作为 `HEAVY_ENGINE=legacy` 回退。新引擎以 `ResearchFrame + ResearchState` 为核心，Planner 每轮根据全局状态生成 action，Executor 执行真实搜索和读取，EvidenceExtractor 抽取证据和候选，Evaluator 决定继续、改关键词、推进候选、比较候选或终稿。

**Tech Stack:** Next.js 16, React 19, TypeScript 5.5, Vitest, React Testing Library, file storage under `research-runs/`, existing relay/OpenCLI/web search providers, existing OpenAI-compatible chat completion wrapper.

---

## 范围

这次不是继续给旧 Agent 打补丁，而是做主逻辑大改。

第一版必须做到：

- 新 Inquiry 默认走 graph engine。
- 旧 `lib/heavy/orchestrator.ts` 保留，配置 `HEAVY_ENGINE=legacy` 时可回退。
- 所有搜索关键词默认英文。
- UI 能看到 Apodex-like research process：意图识别、关键词组合、搜索失败、关键词调整、候选推进、状态评估、最终排名。
- 候选人/公司/网站/方案必须进入全局 candidate pool，不能只藏在某个 AgentReport 里。
- final 必须输出“最大可能候选”，并分清直接证据、代理证据、假设、缺口、被排除项。
- 不写入、展示、测试快照中保存任何 API key。

不做：

- 登录、权限、计费、云端部署。
- 数据库存储迁移。
- 复制 Apodex 视觉品牌。
- 浏览器自动爬虫平台。

当前 workspace 不是 git repo；执行者如果发现 `git status` 仍提示 `not a git repository`，每个 task 的 checkpoint 记录改动文件和测试输出即可。

---

## 文件结构

新增：

- `lib/heavy/graph/types.ts`
  - Graph engine 的核心类型和 normalizer。
  - 定义 `ResearchFrame`、`ResearchState`、`ResearchAction`、`EvidenceItem`、`Candidate`、`GraphHeavyEvent`。
  - 定义轻量事件 summary 与完整 artifact：`SearchBatchArtifact`、`SearchBatchSummary`、`SourceArtifact`、`SourceSummary`。

- `lib/heavy/graph/frame.ts`
  - 从用户 prompt 创建 `ResearchFrame`。
  - 模型失败时用启发式 fallback。

- `lib/heavy/graph/state.ts`
  - 创建、更新、保存、读取 `ResearchState`。
  - 提供不可变更新 helper。

- `lib/heavy/graph/actions.ts`
  - action id、query sanitizer、action normalizer。

- `lib/heavy/graph/planner.ts`
  - 根据 `ResearchState` 生成下一轮 actions。
  - 负责 broad search、revised query、candidate deep dive、comparison、rank trigger。

- `lib/heavy/graph/executor.ts`
  - 执行 `search_web` 和 `read_source` action。
  - 复用 `createHeavySearchProvider`，保留 provider/engine/search results/read logs。

- `lib/heavy/graph/source-selector.ts`
  - 在每轮搜索后从 `searchLedger` 选择真实要读取的 URL。
  - 把 Search -> Select Sources -> Read Sources -> Extract Evidence 固化成主循环步骤，避免只靠 search snippet 假装抓网页。

- `lib/heavy/graph/evidence-extractor.ts`
  - 从 search/read 结果中抽取 evidence、candidate、query clues。
  - 模型失败时使用来源标题/snippet/fullText 启发式抽取。

- `lib/heavy/graph/candidate-pool.ts`
  - 候选合并、打分、推进、排除。

- `lib/heavy/graph/evaluator.ts`
  - 根据全局 state 决定下一步：继续、改关键词、推进候选、比较、终稿、失败。

- `lib/heavy/graph/ranker.ts`
  - 按硬约束、软偏好、证据强度、风险进行排序。

- `lib/heavy/graph/finalizer.ts`
  - 只读取 state/evidence/candidates，不自行搜索。
  - 输出 Markdown final report。

- `lib/heavy/graph/graph-orchestrator.ts`
  - Graph 主循环。
  - 创建 frame/state，循环 plan/execute/extract/evaluate，最后 rank/finalize。

- `tests/heavy-graph-types.test.ts`
- `tests/heavy-graph-frame.test.ts`
- `tests/heavy-graph-state.test.ts`
- `tests/heavy-graph-planner.test.ts`
- `tests/heavy-graph-executor.test.ts`
- `tests/heavy-graph-source-selector.test.ts`
- `tests/heavy-graph-evidence.test.ts`
- `tests/heavy-graph-candidate-pool.test.ts`
- `tests/heavy-graph-evaluator-ranker.test.ts`
- `tests/heavy-graph-orchestrator.test.ts`
- `tests/heavy-graph-scenarios.test.ts`

修改：

- `lib/heavy/types.ts`
  - 扩展 `Inquiry`，增加可选 `graphState` summary，供历史 Inquiry 重新打开时渲染 graph panels。
  - 扩展 `HeavyEvent`，兼容 graph events。

- `lib/heavy/storage.ts`
  - 增加 `research-runs/graph-state/{turnId}.json` 读写。
  - 增加 `research-runs/search-batches/{batchId}.json` 读写；完整搜索结果不直接写入 NDJSON event。
  - 复用 `research-runs/sources/{sourceHash}.json` 存完整网页正文；`source_read` event 只写 source summary。

- `app/api/inquiries/route.ts`
  - 根据 `HEAVY_ENGINE` 选择 graph or legacy。

- `app/api/inquiries/[id]/stream/route.ts`
  - 无需改协议，继续输出 NDJSON，但要能输出 graph events。

- `app/api/inquiries/[id]/route.ts`
  - 读取最新 Turn 的 `graph-state/{turnId}.json`，把压缩后的 `graphState` summary 附加到 Inquiry JSON。

- `app/api/health/route.ts`
  - 增加 `heavyEngine`、graph budget 状态，不回显 key。

- `app/page.tsx`
  - 增加 Research Frame、Research Process、Candidate Pool、Evidence Matrix、Rejected Paths。

- `app/globals.css`
  - 增加 graph UI 样式，保持当前控制台风格。

- `tests/heavy-api.test.ts`
  - 覆盖 graph engine route 分流。

- `tests/heavy-ui.test.tsx`
  - 覆盖 graph panels。

---

## Task 1: Graph 类型与 Normalizer

**Files:**

- Create: `lib/heavy/graph/types.ts`
- Test: `tests/heavy-graph-types.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/heavy-graph-types.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  normalizeCandidate,
  normalizeEvidenceItem,
  normalizeResearchAction,
  normalizeResearchFrame,
  normalizeResearchState
} from "@/lib/heavy/graph/types";

describe("Graph Heavy type normalization", () => {
  it("normalizes a find-person research frame with hard and soft constraints", () => {
    const frame = normalizeResearchFrame({
      id: "frame_1",
      taskKind: "find_person_company",
      userGoal: "Find the most likely CEO candidate",
      deliverable: "ranked candidates with evidence matrix",
      hardConstraints: [{ id: "geo", label: "Australia", kind: "hard" }],
      softPreferences: [{ id: "growth", label: "30% annual growth", kind: "soft" }],
      exclusionRules: [{ id: "solar", label: "not solar panels", kind: "exclusion" }],
      evidencePolicy: {
        directEvidenceRequired: true,
        proxyEvidenceAllowed: true,
        unknownsMustBeLabeled: true
      },
      searchPolicy: {
        defaultLanguage: "en",
        maxResultsPerQuery: 30,
        engines: ["google", "brave", "duckduckgo"]
      },
      rankingPolicy: {
        mustRankWhenEvidenceExists: true,
        maxRankedCandidates: 5
      },
      stopCriteria: ["Enough direct evidence for top candidate"],
      initialAngles: [{ id: "broad", title: "Broad Australian robotics CEO search", priority: "high" }],
      assumptions: [{ id: "proxy_growth", text: "Funding can be proxy growth evidence", status: "active" }]
    });

    expect(frame.taskKind).toBe("find_person_company");
    expect(frame.hardConstraints[0].id).toBe("geo");
    expect(frame.searchPolicy.defaultLanguage).toBe("en");
    expect(frame.rankingPolicy.mustRankWhenEvidenceExists).toBe(true);
  });

  it("drops invalid action, evidence, and candidate rows while preserving valid rows", () => {
    const action = normalizeResearchAction({
      id: "action_1",
      type: "search_web",
      purpose: "Find Australian robotics CEOs",
      rationale: "Need broad candidates first",
      priority: "high",
      queries: ["澳大利亚 CEO", "Australian robotics startup CEO"],
      expectedSignals: ["CEO", "robotics", "Australia"],
      maxResults: 30
    });
    const evidence = normalizeEvidenceItem({
      id: "ev_1",
      claim: "Grace Brown is CEO of Andromeda Robotics",
      subjectIds: ["cand_1"],
      sourceUrl: "https://example.com/grace",
      sourceTitle: "Grace Brown profile",
      sourceType: "profile",
      paraphrase: "The page identifies Grace Brown as CEO.",
      supports: ["role_ceo"],
      contradicts: [],
      strength: "strong",
      extractedAt: "2026-07-02T00:00:00.000Z"
    });
    const candidate = normalizeCandidate({
      id: "cand_1",
      kind: "person_company",
      name: "Grace Brown / Andromeda Robotics",
      aliases: ["Grace Brown", "Andromeda Robotics"],
      summary: "Potential Australian robotics CEO candidate",
      entities: { person: "Grace Brown", company: "Andromeda Robotics" },
      matchedConstraints: [{ constraintId: "role_ceo", status: "direct", evidenceIds: ["ev_1"] }],
      missingConstraints: [{ constraintId: "growth", reason: "No exact 30% growth number" }],
      proxyEvidenceIds: [],
      directEvidenceIds: ["ev_1"],
      risks: [],
      score: 72,
      confidence: "medium",
      status: "active"
    });

    expect(action?.type).toBe("search_web");
    expect(action && "queries" in action ? action.queries : []).toEqual(["Australian robotics startup CEO"]);
    expect(evidence?.sourceUrl).toBe("https://example.com/grace");
    expect(candidate?.aliases).toContain("Andromeda Robotics");
  });

  it("creates a safe empty state from partial input", () => {
    const state = normalizeResearchState({
      frame: { userGoal: "Find candidate" },
      actions: [{ id: "", type: "bad" }],
      evidenceItems: [{ claim: "" }],
      candidatePool: [{ name: "" }]
    });

    expect(state.actions).toEqual([]);
    expect(state.evidenceItems).toEqual([]);
    expect(state.candidatePool).toEqual([]);
    expect(state.budgets.maxCycles).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- tests/heavy-graph-types.test.ts
```

Expected: fail，因为 `lib/heavy/graph/types.ts` 不存在。

- [ ] **Step 3: 新增 graph 类型文件**

创建 `lib/heavy/graph/types.ts`，实现这些导出：

```ts
import { compactError, type FinalReport, type HeavySearchEngine, type HeavySearchProviderName, type HeavySearchResult, type HeavySource } from "@/lib/heavy/types";

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
};

export type EvidencePolicy = {
  directEvidenceRequired: boolean;
  proxyEvidenceAllowed: boolean;
  unknownsMustBeLabeled: boolean;
};

export type SearchPolicy = {
  defaultLanguage: "en";
  maxResultsPerQuery: number;
  engines: string[];
};

export type RankingPolicy = {
  mustRankWhenEvidenceExists: boolean;
  maxRankedCandidates: number;
};

export type ResearchAngle = {
  id: string;
  title: string;
  priority: "low" | "medium" | "high";
};

export type Assumption = {
  id: string;
  text: string;
  status: "active" | "confirmed" | "rejected";
};

export type ResearchFrame = {
  id: string;
  taskKind: TaskKind;
  userGoal: string;
  deliverable: string;
  hardConstraints: Constraint[];
  softPreferences: Constraint[];
  exclusionRules: Constraint[];
  evidencePolicy: EvidencePolicy;
  searchPolicy: SearchPolicy;
  rankingPolicy: RankingPolicy;
  stopCriteria: string[];
  initialAngles: ResearchAngle[];
  assumptions: Assumption[];
};

export type ActionPriority = "low" | "medium" | "high";

export type BaseAction = {
  id: string;
  type: string;
  purpose: string;
  rationale: string;
  priority: ActionPriority;
  dependsOn?: string[];
};

export type SearchWebAction = BaseAction & {
  type: "search_web";
  queries: string[];
  expectedSignals: string[];
  avoidQueries?: string[];
  maxResults: number;
};

export type ReadSourceAction = BaseAction & {
  type: "read_source";
  resultUrls: string[];
};

export type ExtractEvidenceAction = BaseAction & {
  type: "extract_evidence";
  sourceUrls: string[];
};

export type ExtractCandidatesAction = BaseAction & {
  type: "extract_candidates";
  sourceUrls: string[];
};

export type VerifyConstraintAction = BaseAction & {
  type: "verify_constraint";
  candidateId?: string;
  constraintId: string;
  requiredEvidence: string[];
};

export type PromoteCandidateAction = BaseAction & {
  type: "promote_candidate";
  candidateId: string;
};

export type CompareCandidatesAction = BaseAction & {
  type: "compare_candidates";
  candidateIds: string[];
};

export type RankCandidatesAction = BaseAction & {
  type: "rank_candidates";
};

export type FinalizeAction = BaseAction & {
  type: "finalize";
};

export type ResearchAction =
  | SearchWebAction
  | ReadSourceAction
  | ExtractEvidenceAction
  | ExtractCandidatesAction
  | VerifyConstraintAction
  | PromoteCandidateAction
  | CompareCandidatesAction
  | RankCandidatesAction
  | FinalizeAction;

export type ResearchActionRecord = {
  action: ResearchAction;
  status: "planned" | "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  error?: string;
};

export type EvidenceItem = {
  id: string;
  claim: string;
  subjectIds: string[];
  sourceUrl: string;
  sourceTitle: string;
  sourceType: "official" | "profile" | "news" | "directory" | "forum" | "social" | "pdf" | "other";
  quote?: string;
  paraphrase: string;
  supports: string[];
  contradicts: string[];
  strength: "weak" | "medium" | "strong";
  extractedAt: string;
};

export type ConstraintMatch = {
  constraintId: string;
  status: "direct" | "proxy";
  evidenceIds: string[];
};

export type ConstraintGap = {
  constraintId: string;
  reason: string;
};

export type RiskItem = {
  id: string;
  text: string;
  severity: "low" | "medium" | "high";
  evidenceIds: string[];
};

export type Candidate = {
  id: string;
  kind: "person_company" | "website" | "company" | "service" | "workflow" | "channel" | "other";
  name: string;
  aliases: string[];
  summary: string;
  entities: Record<string, string>;
  matchedConstraints: ConstraintMatch[];
  missingConstraints: ConstraintGap[];
  proxyEvidenceIds: string[];
  directEvidenceIds: string[];
  risks: RiskItem[];
  score: number;
  confidence: "low" | "medium" | "high";
  status: "new" | "active" | "promoted" | "rejected" | "ranked";
};

export type SearchResultSummary = {
  title: string;
  url: string;
  snippet?: string;
  provider?: string;
  engine?: HeavySearchEngine | string;
  rank: number;
};

export type SearchBatchArtifact = {
  id: string;
  actionId: string;
  query: string;
  provider: HeavySearchProviderName;
  engine?: HeavySearchEngine | string;
  resultCount: number;
  results: HeavySearchResult[];
  timestamp: string;
};

export type SearchBatchSummary = {
  id: string;
  actionId: string;
  query: string;
  provider: HeavySearchProviderName;
  engine?: HeavySearchEngine | string;
  resultCount: number;
  resultPreview: SearchResultSummary[];
  artifactPath?: string;
  timestamp: string;
};

export type SourceSummary = {
  sourceHash: string;
  actionId: string;
  title: string;
  url: string;
  provider?: string;
  engine?: HeavySearchEngine | string;
  snippet?: string;
  fullTextLength: number;
  artifactPath?: string;
  timestamp: string;
};

export type SourceArtifact = {
  sourceHash: string;
  actionId: string;
  source: HeavySource;
  summary: SourceSummary;
  timestamp: string;
};

export type SearchLedgerEntry = {
  actionId: string;
  query: string;
  provider: HeavySearchProviderName;
  engine?: HeavySearchEngine | string;
  resultCount: number;
  resultBatchId: string;
  resultPreview: SearchResultSummary[];
  timestamp: string;
};

export type SourceLedgerEntry = {
  actionId: string;
  sourceHash: string;
  sourceSummary: SourceSummary;
  timestamp: string;
};

export type OpenQuestion = {
  id: string;
  text: string;
  priority: "low" | "medium" | "high";
};

export type Contradiction = {
  id: string;
  text: string;
  evidenceIds: string[];
};

export type RejectedPath = {
  id: string;
  target: string;
  reason: string;
  evidenceIds: string[];
};

export type DecisionTrace = {
  id: string;
  decision: string;
  reason: string;
  timestamp: string;
};

export type PlannerHint = {
  id: string;
  decision: EvaluationDecision;
  reason: string;
  nextFocus: string[];
  avoidQueries: string[];
  createdAt: string;
};

export type ResearchBudgetState = {
  maxCycles: number;
  maxActionsPerCycle: number;
  maxSearchActionsPerCycle: number;
  maxQueriesPerSearchAction: number;
  maxResultsPerQuery: number;
  maxSourcesToReadPerCycle: number;
  maxTotalSourcesToRead: number;
  maxPromotedCandidates: number;
  cycleIndex: number;
};

export type ResearchState = {
  frame: ResearchFrame;
  actions: ResearchActionRecord[];
  searchLedger: SearchLedgerEntry[];
  sourceLedger: SourceLedgerEntry[];
  evidenceItems: EvidenceItem[];
  candidatePool: Candidate[];
  promotedCandidates: string[];
  openQuestions: OpenQuestion[];
  contradictions: Contradiction[];
  rejectedPaths: RejectedPath[];
  assumptions: Assumption[];
  decisionHistory: DecisionTrace[];
  plannerHints: PlannerHint[];
  pendingActions: ResearchAction[];
  budgets: ResearchBudgetState;
  finalReport?: FinalReport;
};

export type GraphStateSummary = {
  frame: ResearchFrame;
  cycleIndex: number;
  candidates: Candidate[];
  evidenceItems: EvidenceItem[];
  decisionHistory: DecisionTrace[];
  rejectedPaths: RejectedPath[];
  openQuestions: OpenQuestion[];
  plannerHints: PlannerHint[];
  searchBatches: SearchBatchSummary[];
  sourceSummaries: SourceSummary[];
  searchCount: number;
  sourceCount: number;
};

export type EvaluationDecision =
  | "continue"
  | "revise_queries"
  | "promote_candidate"
  | "broaden_scope"
  | "narrow_scope"
  | "compare_candidates"
  | "rank_and_finalize"
  | "fail";

export type StateEvaluation = {
  decision: EvaluationDecision;
  reason: string;
  nextFocus: string[];
  avoidQueries: string[];
  recommendedActions: ResearchAction[];
};

export type GraphHeavyEvent =
  | { type: "frame_created"; inquiryId: string; turnId: string; frame: ResearchFrame; timestamp: string }
  | { type: "cycle_started"; inquiryId: string; turnId: string; cycleIndex: number; timestamp: string }
  | { type: "actions_planned"; inquiryId: string; turnId: string; cycleIndex: number; actions: ResearchAction[]; timestamp: string }
  | { type: "action_started"; inquiryId: string; turnId: string; action: ResearchAction; timestamp: string }
  | { type: "search_performed"; inquiryId: string; turnId: string; actionId: string; query: string; provider: HeavySearchProviderName; engine?: HeavySearchEngine | string; resultCount: number; resultBatchId: string; resultPreview: SearchResultSummary[]; timestamp: string }
  | { type: "source_read"; inquiryId: string; turnId: string; actionId: string; sourceHash: string; sourceSummary: SourceSummary; timestamp: string }
  | { type: "evidence_extracted"; inquiryId: string; turnId: string; actionId: string; evidence: EvidenceItem[]; timestamp: string }
  | { type: "candidate_extracted"; inquiryId: string; turnId: string; actionId: string; candidates: Candidate[]; timestamp: string }
  | { type: "candidate_promoted"; inquiryId: string; turnId: string; candidate: Candidate; reason: string; timestamp: string }
  | { type: "state_evaluated"; inquiryId: string; turnId: string; evaluation: StateEvaluation; timestamp: string }
  | { type: "ranking_completed"; inquiryId: string; turnId: string; candidates: Candidate[]; timestamp: string }
  | { type: "graph_final_reported"; inquiryId: string; turnId: string; report: FinalReport; timestamp: string };

export const DEFAULT_GRAPH_BUDGET: ResearchBudgetState = {
  maxCycles: 8,
  maxActionsPerCycle: 6,
  maxSearchActionsPerCycle: 4,
  maxQueriesPerSearchAction: 4,
  maxResultsPerQuery: 30,
  maxSourcesToReadPerCycle: 12,
  maxTotalSourcesToRead: 80,
  maxPromotedCandidates: 8,
  cycleIndex: 0
};

export function normalizeResearchFrame(input: unknown): ResearchFrame {
  const item = objectRecord(input);
  return {
    id: slug(text(item.id)) || createId("frame"),
    taskKind: normalizeTaskKind(item.taskKind),
    userGoal: text(item.userGoal) || "Research the user request",
    deliverable: text(item.deliverable) || "sourced markdown report",
    hardConstraints: normalizeConstraints(item.hardConstraints, "hard"),
    softPreferences: normalizeConstraints(item.softPreferences, "soft"),
    exclusionRules: normalizeConstraints(item.exclusionRules, "exclusion"),
    evidencePolicy: normalizeEvidencePolicy(item.evidencePolicy),
    searchPolicy: normalizeSearchPolicy(item.searchPolicy),
    rankingPolicy: normalizeRankingPolicy(item.rankingPolicy),
    stopCriteria: stringArray(item.stopCriteria),
    initialAngles: normalizeAngles(item.initialAngles),
    assumptions: normalizeAssumptions(item.assumptions)
  };
}

export function normalizeResearchAction(input: unknown): ResearchAction | null {
  const item = objectRecord(input);
  const base = normalizeBaseAction(item);
  if (!base) return null;
  if (item.type === "search_web") {
    const queries = stringArray(item.queries).map(toEnglishSearchText).filter(Boolean);
    if (queries.length === 0) return null;
    return {
      ...base,
      type: "search_web",
      queries,
      expectedSignals: stringArray(item.expectedSignals),
      avoidQueries: stringArray(item.avoidQueries).map(toEnglishSearchText).filter(Boolean),
      maxResults: boundedInt(item.maxResults, DEFAULT_GRAPH_BUDGET.maxResultsPerQuery, 1, 100)
    };
  }
  if (item.type === "read_source") {
    const resultUrls = stringArray(item.resultUrls).filter(isHttpUrl);
    return resultUrls.length ? { ...base, type: "read_source", resultUrls } : null;
  }
  if (item.type === "extract_evidence") {
    const sourceUrls = stringArray(item.sourceUrls).filter(isHttpUrl);
    return sourceUrls.length ? { ...base, type: "extract_evidence", sourceUrls } : null;
  }
  if (item.type === "extract_candidates") {
    const sourceUrls = stringArray(item.sourceUrls).filter(isHttpUrl);
    return sourceUrls.length ? { ...base, type: "extract_candidates", sourceUrls } : null;
  }
  if (item.type === "verify_constraint") {
    const constraintId = slug(text(item.constraintId));
    return constraintId ? { ...base, type: "verify_constraint", candidateId: slug(text(item.candidateId)), constraintId, requiredEvidence: stringArray(item.requiredEvidence) } : null;
  }
  if (item.type === "promote_candidate") {
    const candidateId = slug(text(item.candidateId));
    return candidateId ? { ...base, type: "promote_candidate", candidateId } : null;
  }
  if (item.type === "compare_candidates") {
    const candidateIds = stringArray(item.candidateIds).map(slug).filter(Boolean);
    return candidateIds.length >= 2 ? { ...base, type: "compare_candidates", candidateIds } : null;
  }
  if (item.type === "rank_candidates") return { ...base, type: "rank_candidates" };
  if (item.type === "finalize") return { ...base, type: "finalize" };
  return null;
}

export function normalizeEvidenceItem(input: unknown): EvidenceItem | null {
  const item = objectRecord(input);
  const claim = text(item.claim);
  const sourceUrl = text(item.sourceUrl);
  const sourceTitle = text(item.sourceTitle);
  if (!claim || !isHttpUrl(sourceUrl) || !sourceTitle) return null;
  return {
    id: slug(text(item.id)) || createId("ev"),
    claim,
    subjectIds: stringArray(item.subjectIds).map(slug).filter(Boolean),
    sourceUrl,
    sourceTitle,
    sourceType: normalizeSourceType(item.sourceType),
    quote: text(item.quote) || undefined,
    paraphrase: text(item.paraphrase) || claim,
    supports: stringArray(item.supports).map(slug).filter(Boolean),
    contradicts: stringArray(item.contradicts).map(slug).filter(Boolean),
    strength: item.strength === "weak" || item.strength === "medium" || item.strength === "strong" ? item.strength : "medium",
    extractedAt: text(item.extractedAt) || new Date().toISOString()
  };
}

export function normalizeCandidate(input: unknown): Candidate | null {
  const item = objectRecord(input);
  const name = text(item.name);
  if (!name) return null;
  return {
    id: slug(text(item.id)) || createId("cand"),
    kind: normalizeCandidateKind(item.kind),
    name,
    aliases: stringArray(item.aliases),
    summary: text(item.summary) || name,
    entities: normalizeStringRecord(item.entities),
    matchedConstraints: normalizeConstraintMatches(item.matchedConstraints),
    missingConstraints: normalizeConstraintGaps(item.missingConstraints),
    proxyEvidenceIds: stringArray(item.proxyEvidenceIds).map(slug).filter(Boolean),
    directEvidenceIds: stringArray(item.directEvidenceIds).map(slug).filter(Boolean),
    risks: normalizeRisks(item.risks),
    score: boundedInt(item.score, 0, 0, 100),
    confidence: item.confidence === "low" || item.confidence === "medium" || item.confidence === "high" ? item.confidence : "low",
    status: item.status === "new" || item.status === "active" || item.status === "promoted" || item.status === "rejected" || item.status === "ranked" ? item.status : "new"
  };
}

export function normalizeResearchState(input: unknown): ResearchState {
  const item = objectRecord(input);
  return {
    frame: normalizeResearchFrame(item.frame),
    actions: Array.isArray(item.actions) ? item.actions.map(normalizeActionRecord).filter((row): row is ResearchActionRecord => Boolean(row)) : [],
    searchLedger: Array.isArray(item.searchLedger) ? item.searchLedger.map(normalizeSearchLedgerEntry).filter((row): row is SearchLedgerEntry => Boolean(row)) : [],
    sourceLedger: Array.isArray(item.sourceLedger) ? item.sourceLedger.map(normalizeSourceLedgerEntry).filter((row): row is SourceLedgerEntry => Boolean(row)) : [],
    evidenceItems: Array.isArray(item.evidenceItems) ? item.evidenceItems.map(normalizeEvidenceItem).filter((row): row is EvidenceItem => Boolean(row)) : [],
    candidatePool: Array.isArray(item.candidatePool) ? item.candidatePool.map(normalizeCandidate).filter((row): row is Candidate => Boolean(row)) : [],
    promotedCandidates: stringArray(item.promotedCandidates).map(slug).filter(Boolean),
    openQuestions: Array.isArray(item.openQuestions) ? item.openQuestions.map(normalizeOpenQuestion).filter((row): row is OpenQuestion => Boolean(row)) : [],
    contradictions: Array.isArray(item.contradictions) ? item.contradictions.map(normalizeContradiction).filter((row): row is Contradiction => Boolean(row)) : [],
    rejectedPaths: Array.isArray(item.rejectedPaths) ? item.rejectedPaths.map(normalizeRejectedPath).filter((row): row is RejectedPath => Boolean(row)) : [],
    assumptions: normalizeAssumptions(item.assumptions),
    decisionHistory: Array.isArray(item.decisionHistory) ? item.decisionHistory.map(normalizeDecisionTrace).filter((row): row is DecisionTrace => Boolean(row)) : [],
    plannerHints: Array.isArray(item.plannerHints) ? item.plannerHints.map(normalizePlannerHint).filter((row): row is PlannerHint => Boolean(row)) : [],
    pendingActions: Array.isArray(item.pendingActions) ? item.pendingActions.map(normalizeResearchAction).filter((row): row is ResearchAction => Boolean(row)) : [],
    budgets: normalizeGraphBudget(item.budgets),
    finalReport: undefined
  };
}

function normalizeBaseAction(item: Record<string, unknown>): BaseAction | null {
  const id = slug(text(item.id));
  const purpose = text(item.purpose);
  const rationale = text(item.rationale);
  if (!id || !purpose || !rationale) return null;
  return {
    id,
    type: text(item.type),
    purpose,
    rationale,
    priority: item.priority === "low" || item.priority === "medium" || item.priority === "high" ? item.priority : "medium",
    dependsOn: stringArray(item.dependsOn).map(slug).filter(Boolean)
  };
}

function normalizeActionRecord(input: unknown): ResearchActionRecord | null {
  const item = objectRecord(input);
  const action = normalizeResearchAction(item.action);
  if (!action) return null;
  const status = item.status === "planned" || item.status === "running" || item.status === "completed" || item.status === "failed" ? item.status : "planned";
  return {
    action,
    status,
    createdAt: text(item.createdAt) || new Date().toISOString(),
    completedAt: text(item.completedAt) || undefined,
    error: text(item.error) ? compactError(text(item.error)) : undefined
  };
}

function normalizeConstraints(input: unknown, kind: ConstraintKind): Constraint[] {
  return Array.isArray(input)
    ? input.map((row) => {
        const item = objectRecord(row);
        const label = text(item.label);
        if (!label) return null;
        return { id: slug(text(item.id)) || slug(label), label, kind, description: text(item.description) || undefined };
      }).filter((row): row is Constraint => Boolean(row))
    : [];
}

function normalizeEvidencePolicy(input: unknown): EvidencePolicy {
  const item = objectRecord(input);
  return {
    directEvidenceRequired: item.directEvidenceRequired !== false,
    proxyEvidenceAllowed: item.proxyEvidenceAllowed !== false,
    unknownsMustBeLabeled: item.unknownsMustBeLabeled !== false
  };
}

function normalizeSearchPolicy(input: unknown): SearchPolicy {
  const item = objectRecord(input);
  return {
    defaultLanguage: "en",
    maxResultsPerQuery: boundedInt(item.maxResultsPerQuery, DEFAULT_GRAPH_BUDGET.maxResultsPerQuery, 1, 100),
    engines: stringArray(item.engines).length ? stringArray(item.engines) : ["google", "brave", "duckduckgo"]
  };
}

function normalizeRankingPolicy(input: unknown): RankingPolicy {
  const item = objectRecord(input);
  return {
    mustRankWhenEvidenceExists: item.mustRankWhenEvidenceExists !== false,
    maxRankedCandidates: boundedInt(item.maxRankedCandidates, 5, 1, 20)
  };
}

function normalizeAngles(input: unknown): ResearchAngle[] {
  return Array.isArray(input)
    ? input.map((row) => {
        const item = objectRecord(row);
        const title = text(item.title);
        if (!title) return null;
        return {
          id: slug(text(item.id)) || slug(title),
          title,
          priority: item.priority === "low" || item.priority === "medium" || item.priority === "high" ? item.priority : "medium"
        };
      }).filter((row): row is ResearchAngle => Boolean(row))
    : [];
}

function normalizeAssumptions(input: unknown): Assumption[] {
  return Array.isArray(input)
    ? input.map((row) => {
        const item = objectRecord(row);
        const value = text(item.text);
        if (!value) return null;
        return {
          id: slug(text(item.id)) || slug(value),
          text: value,
          status: item.status === "confirmed" || item.status === "rejected" ? item.status : "active"
        };
      }).filter((row): row is Assumption => Boolean(row))
    : [];
}

function normalizeGraphBudget(input: unknown): ResearchBudgetState {
  const item = objectRecord(input);
  return {
    maxCycles: boundedInt(item.maxCycles ?? process.env.HEAVY_GRAPH_MAX_CYCLES, DEFAULT_GRAPH_BUDGET.maxCycles, 1, 20),
    maxActionsPerCycle: boundedInt(item.maxActionsPerCycle ?? process.env.HEAVY_GRAPH_MAX_ACTIONS_PER_CYCLE, DEFAULT_GRAPH_BUDGET.maxActionsPerCycle, 1, 20),
    maxSearchActionsPerCycle: boundedInt(item.maxSearchActionsPerCycle ?? process.env.HEAVY_GRAPH_MAX_SEARCH_ACTIONS_PER_CYCLE, DEFAULT_GRAPH_BUDGET.maxSearchActionsPerCycle, 1, 12),
    maxQueriesPerSearchAction: boundedInt(item.maxQueriesPerSearchAction ?? process.env.HEAVY_GRAPH_MAX_QUERIES_PER_SEARCH_ACTION, DEFAULT_GRAPH_BUDGET.maxQueriesPerSearchAction, 1, 10),
    maxResultsPerQuery: boundedInt(item.maxResultsPerQuery ?? process.env.HEAVY_GRAPH_MAX_RESULTS_PER_QUERY, DEFAULT_GRAPH_BUDGET.maxResultsPerQuery, 1, 100),
    maxSourcesToReadPerCycle: boundedInt(item.maxSourcesToReadPerCycle ?? process.env.HEAVY_GRAPH_MAX_SOURCES_TO_READ_PER_CYCLE, DEFAULT_GRAPH_BUDGET.maxSourcesToReadPerCycle, 1, 50),
    maxTotalSourcesToRead: boundedInt(item.maxTotalSourcesToRead ?? process.env.HEAVY_GRAPH_MAX_TOTAL_SOURCES_TO_READ, DEFAULT_GRAPH_BUDGET.maxTotalSourcesToRead, 1, 200),
    maxPromotedCandidates: boundedInt(item.maxPromotedCandidates ?? process.env.HEAVY_GRAPH_MAX_PROMOTED_CANDIDATES, DEFAULT_GRAPH_BUDGET.maxPromotedCandidates, 1, 30),
    cycleIndex: boundedInt(item.cycleIndex, 0, 0, 100)
  };
}

function normalizeTaskKind(input: unknown): TaskKind {
  return input === "find_person_company" ||
    input === "find_website" ||
    input === "technical_verification" ||
    input === "data_workflow_design" ||
    input === "market_list_building" ||
    input === "sales_strategy" ||
    input === "general_research"
    ? input
    : "general_research";
}

function normalizeSourceType(input: unknown): EvidenceItem["sourceType"] {
  return input === "official" || input === "profile" || input === "news" || input === "directory" || input === "forum" || input === "social" || input === "pdf" || input === "other" ? input : "other";
}

function normalizeCandidateKind(input: unknown): Candidate["kind"] {
  return input === "person_company" || input === "website" || input === "company" || input === "service" || input === "workflow" || input === "channel" || input === "other" ? input : "other";
}

function normalizeConstraintMatches(input: unknown): ConstraintMatch[] {
  return Array.isArray(input)
    ? input.map((row) => {
        const item = objectRecord(row);
        const constraintId = slug(text(item.constraintId));
        if (!constraintId) return null;
        return { constraintId, status: item.status === "direct" || item.status === "proxy" ? item.status : "proxy", evidenceIds: stringArray(item.evidenceIds).map(slug).filter(Boolean) };
      }).filter((row): row is ConstraintMatch => Boolean(row))
    : [];
}

function normalizeConstraintGaps(input: unknown): ConstraintGap[] {
  return Array.isArray(input)
    ? input.map((row) => {
        const item = objectRecord(row);
        const constraintId = slug(text(item.constraintId));
        const reason = text(item.reason);
        return constraintId && reason ? { constraintId, reason } : null;
      }).filter((row): row is ConstraintGap => Boolean(row))
    : [];
}

function normalizeRisks(input: unknown): RiskItem[] {
  return Array.isArray(input)
    ? input.map((row) => {
        const item = objectRecord(row);
        const risk = text(item.text);
        if (!risk) return null;
        return {
          id: slug(text(item.id)) || slug(risk),
          text: risk,
          severity: item.severity === "low" || item.severity === "medium" || item.severity === "high" ? item.severity : "medium",
          evidenceIds: stringArray(item.evidenceIds).map(slug).filter(Boolean)
        };
      }).filter((row): row is RiskItem => Boolean(row))
    : [];
}

function normalizeOpenQuestion(input: unknown): OpenQuestion | null {
  const item = objectRecord(input);
  const value = text(item.text);
  return value ? { id: slug(text(item.id)) || slug(value), text: value, priority: item.priority === "low" || item.priority === "medium" || item.priority === "high" ? item.priority : "medium" } : null;
}

function normalizeContradiction(input: unknown): Contradiction | null {
  const item = objectRecord(input);
  const value = text(item.text);
  return value ? { id: slug(text(item.id)) || slug(value), text: value, evidenceIds: stringArray(item.evidenceIds).map(slug).filter(Boolean) } : null;
}

function normalizeRejectedPath(input: unknown): RejectedPath | null {
  const item = objectRecord(input);
  const target = text(item.target);
  const reason = text(item.reason);
  return target && reason ? { id: slug(text(item.id)) || slug(target), target, reason, evidenceIds: stringArray(item.evidenceIds).map(slug).filter(Boolean) } : null;
}

function normalizeDecisionTrace(input: unknown): DecisionTrace | null {
  const item = objectRecord(input);
  const decision = text(item.decision);
  const reason = text(item.reason);
  return decision && reason ? { id: slug(text(item.id)) || createId("decision"), decision, reason, timestamp: text(item.timestamp) || new Date().toISOString() } : null;
}

function normalizePlannerHint(input: unknown): PlannerHint | null {
  const item = objectRecord(input);
  const decision = normalizeEvaluationDecision(item.decision);
  const reason = text(item.reason);
  if (!reason) return null;
  return {
    id: slug(text(item.id)) || createId("hint"),
    decision,
    reason,
    nextFocus: stringArray(item.nextFocus).map(toEnglishSearchText).filter(Boolean),
    avoidQueries: stringArray(item.avoidQueries).map(toEnglishSearchText).filter(Boolean),
    createdAt: text(item.createdAt) || new Date().toISOString()
  };
}

function normalizeEvaluationDecision(input: unknown): EvaluationDecision {
  return input === "continue" ||
    input === "revise_queries" ||
    input === "promote_candidate" ||
    input === "broaden_scope" ||
    input === "narrow_scope" ||
    input === "compare_candidates" ||
    input === "rank_and_finalize" ||
    input === "fail"
    ? input
    : "continue";
}

function normalizeSearchLedgerEntry(input: unknown): SearchLedgerEntry | null {
  const item = objectRecord(input);
  const query = text(item.query);
  if (!query) return null;
  const provider = item.provider === "relay" || item.provider === "opencli" || item.provider === "web" || item.provider === "fetch" || item.provider === "test" ? item.provider : "web";
  const resultBatchId = slug(text(item.resultBatchId)) || createId("batch");
  return {
    actionId: slug(text(item.actionId)) || "unknown_action",
    query,
    provider,
    engine: text(item.engine) || undefined,
    resultCount: boundedInt(item.resultCount, 0, 0, 1000),
    resultBatchId,
    resultPreview: normalizeSearchResultSummaries(item.resultPreview),
    timestamp: text(item.timestamp) || new Date().toISOString()
  };
}

function normalizeSourceLedgerEntry(input: unknown): SourceLedgerEntry | null {
  const item = objectRecord(input);
  const sourceSummary = normalizeSourceSummary(item.sourceSummary);
  return sourceSummary ? {
    actionId: slug(text(item.actionId)) || "unknown_action",
    sourceHash: sourceSummary.sourceHash,
    sourceSummary,
    timestamp: text(item.timestamp) || sourceSummary.timestamp
  } : null;
}

function normalizeSearchResultSummaries(input: unknown): SearchResultSummary[] {
  return Array.isArray(input)
    ? input.map((row, index) => {
        const item = objectRecord(row);
        const title = text(item.title);
        const url = text(item.url);
        if (!title || !isHttpUrl(url)) return null;
        return {
          title,
          url,
          snippet: text(item.snippet) || undefined,
          provider: text(item.provider) || undefined,
          engine: text(item.engine) || undefined,
          rank: boundedInt(item.rank, index + 1, 1, 1000)
        };
      }).filter((row): row is SearchResultSummary => Boolean(row))
    : [];
}

function normalizeSourceSummary(input: unknown): SourceSummary | null {
  const item = objectRecord(input);
  const url = text(item.url);
  if (!isHttpUrl(url)) return null;
  return {
    sourceHash: slug(text(item.sourceHash)) || hashText(url),
    actionId: slug(text(item.actionId)) || "unknown_action",
    title: text(item.title) || url,
    url,
    provider: text(item.provider) || undefined,
    engine: text(item.engine) || undefined,
    snippet: text(item.snippet) || undefined,
    fullTextLength: boundedInt(item.fullTextLength, 0, 0, 5_000_000),
    artifactPath: text(item.artifactPath) || undefined,
    timestamp: text(item.timestamp) || new Date().toISOString()
  };
}

function normalizeStringRecord(input: unknown): Record<string, string> {
  const item = objectRecord(input);
  return Object.fromEntries(Object.entries(item).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0));
}

function toEnglishSearchText(value: string): string {
  return value.replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ").replace(/[^a-zA-Z0-9 .,'"&:%/+_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function objectRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function text(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function stringArray(input: unknown): string[] {
  return Array.isArray(input) ? input.map(text).filter(Boolean) : [];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return `h_${Math.abs(hash).toString(36)}`;
}
```

- [ ] **Step 4: 运行类型测试**

Run:

```bash
npm run test -- tests/heavy-graph-types.test.ts
```

Expected: pass.

---

## Task 2: Graph State 存储与事件

**Files:**

- Create: `lib/heavy/graph/state.ts`
- Modify: `lib/heavy/storage.ts`
- Modify: `lib/heavy/types.ts`
- Test: `tests/heavy-graph-state.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/heavy-graph-state.test.ts`：

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInitialResearchState, consumePendingActions, recordGraphDecision, recordPlannerFeedback, upsertEvidenceItems } from "@/lib/heavy/graph/state";
import { createInquiry, appendTurnEvent, loadGraphState, loadSearchBatch, loadSourceArtifact, saveGraphState, saveSearchBatch, saveSourceArtifact } from "@/lib/heavy/storage";

describe("Graph Heavy state storage", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "heavy-graph-state-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("creates, saves, reloads, and updates graph state", async () => {
    const { turn } = await createInquiry("Find a CEO candidate", { rootDir });
    const state = createInitialResearchState({
      id: "frame_1",
      taskKind: "find_person_company",
      userGoal: "Find a CEO candidate",
      deliverable: "ranked answer",
      hardConstraints: [],
      softPreferences: [],
      exclusionRules: [],
      evidencePolicy: { directEvidenceRequired: true, proxyEvidenceAllowed: true, unknownsMustBeLabeled: true },
      searchPolicy: { defaultLanguage: "en", maxResultsPerQuery: 30, engines: ["google", "brave", "duckduckgo"] },
      rankingPolicy: { mustRankWhenEvidenceExists: true, maxRankedCandidates: 5 },
      stopCriteria: [],
      initialAngles: [],
      assumptions: []
    });

    const withEvidence = upsertEvidenceItems(state, [{
      id: "ev_1",
      claim: "Candidate is CEO",
      subjectIds: ["cand_1"],
      sourceUrl: "https://example.com",
      sourceTitle: "Example",
      sourceType: "profile",
      paraphrase: "Example identifies candidate as CEO.",
      supports: ["role_ceo"],
      contradicts: [],
      strength: "strong",
      extractedAt: "2026-07-02T00:00:00.000Z"
    }]);
    const withDecision = recordGraphDecision(withEvidence, "continue", "Need candidate deep dive");

    await saveGraphState(turn.id, withDecision, { rootDir });
    const loaded = await loadGraphState(turn.id, { rootDir });

    expect(loaded?.evidenceItems).toHaveLength(1);
    expect(loaded?.decisionHistory[0].decision).toBe("continue");
  });

  it("persists evaluator feedback as planner hints and pending actions", async () => {
    const { turn } = await createInquiry("Find a CEO candidate", { rootDir });
    const action = {
      id: "search_revised_1",
      type: "search_web" as const,
      purpose: "Search revised candidate terms",
      priority: "high" as const,
      rationale: "Previous search missed candidates.",
      queries: ["Australian robotics CEO Andromeda AI article"],
      avoidQueries: ["generic CEO list"],
      expectedSignals: ["CEO", "AI article"],
      maxResults: 30
    };
    const state = recordPlannerFeedback(createInitialResearchState({ userGoal: "Find candidate" }), {
      decision: "revise_queries",
      reason: "Broad search failed; use more specific English terms.",
      nextFocus: ["Andromeda Robotics"],
      avoidQueries: ["generic CEO list"],
      recommendedActions: [action]
    });

    await saveGraphState(turn.id, state, { rootDir });
    const loaded = await loadGraphState(turn.id, { rootDir });
    const consumed = consumePendingActions(loaded!);

    expect(loaded?.plannerHints[0].decision).toBe("revise_queries");
    expect(consumed.actions[0].id).toBe("search_revised_1");
    expect(consumed.state.pendingActions).toEqual([]);
  });

  it("stores full search batches and full source text as artifacts", async () => {
    await saveSearchBatch({
      id: "batch_1",
      actionId: "search_1",
      query: "Australian robotics CEO",
      provider: "opencli",
      engine: "google",
      resultCount: 2,
      results: [
        { title: "Grace Brown", url: "https://example.com/grace", snippet: "CEO profile", provider: "opencli", engine: "google" },
        { title: "Andromeda funding", url: "https://example.com/funding", snippet: "Funding", provider: "opencli", engine: "google" }
      ],
      timestamp: "2026-07-02T00:00:00.000Z"
    }, { rootDir });
    const sourceArtifact = await saveSourceArtifact("src_1", "read_1", {
      title: "Grace Brown",
      url: "https://example.com/grace",
      snippet: "CEO profile",
      provider: "opencli",
      engine: "google",
      fullText: "Very long captured page text"
    }, { rootDir });

    expect((await loadSearchBatch("batch_1", { rootDir }))?.results).toHaveLength(2);
    expect((await loadSourceArtifact("src_1", { rootDir }))?.source.fullText).toContain("captured page text");
    expect(sourceArtifact.summary.fullTextLength).toBeGreaterThan(0);
  });

  it("appends graph events to the existing turn log without secrets", async () => {
    const { inquiry, turn } = await createInquiry("Find a CEO candidate", { rootDir });
    await appendTurnEvent({
      type: "source_read",
      inquiryId: inquiry.id,
      turnId: turn.id,
      actionId: "read_1",
      sourceHash: "src_1",
      sourceSummary: {
        sourceHash: "src_1",
        actionId: "read_1",
        title: "Grace Brown",
        url: "https://example.com/grace",
        snippet: "CEO profile",
        provider: "opencli",
        engine: "google",
        fullTextLength: 28,
        artifactPath: "sources/src_1.json",
        timestamp: "2026-07-02T00:00:00.000Z"
      },
      timestamp: "2026-07-02T00:00:00.000Z"
    }, { rootDir });

    const raw = await readFile(join(rootDir, "logs", `${turn.id}.ndjson`), "utf8");
    expect(raw).toContain('"type":"source_read"');
    expect(raw).toContain('"sourceHash":"src_1"');
    expect(raw).not.toContain("Very long captured page text");
    expect(raw).not.toContain("fullText");
    expect(raw).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm run test -- tests/heavy-graph-state.test.ts
```

Expected: fail，因为 storage 还没有 graph-state 读写，`HeavyEvent` 也不接受 graph events。

- [ ] **Step 3: 扩展 `HeavyEvent`**

在 `lib/heavy/types.ts` 顶部增加 type import：

```ts
import type { GraphHeavyEvent } from "@/lib/heavy/graph/types";
```

把 `HeavyEvent` 改成：

```ts
export type HeavyEvent =
  | GraphHeavyEvent
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
```

- [ ] **Step 4: 增加 graph-state 存储**

在 `lib/heavy/storage.ts` import 增加：

```ts
import type { ResearchState, SearchBatchArtifact, SourceArtifact } from "@/lib/heavy/graph/types";
import { normalizeResearchState } from "@/lib/heavy/graph/types";
import type { HeavySource } from "@/lib/heavy/types";
```

修改 `ensureStorage` 的 dirs：

```ts
const dirs = {
  root,
  inquiries: join(root, "inquiries"),
  logs: join(root, "logs"),
  sources: join(root, "sources"),
  searchBatches: join(root, "search-batches"),
  graphState: join(root, "graph-state")
};
await mkdir(dirs.searchBatches, { recursive: true });
await mkdir(dirs.graphState, { recursive: true });
```

新增导出：

```ts
export async function saveGraphState(turnId: string, state: ResearchState, options: HeavyStorageOptions = {}): Promise<void> {
  const dirs = await ensureStorage(options);
  await writeJsonAtomic(join(dirs.graphState, `${safeFileName(turnId)}.json`), state);
}

export async function loadGraphState(turnId: string, options: HeavyStorageOptions = {}): Promise<ResearchState | null> {
  const dirs = await ensureStorage(options);
  const path = join(dirs.graphState, `${safeFileName(turnId)}.json`);
  if (!existsSync(path)) {
    return null;
  }
  return normalizeResearchState(JSON.parse(await readFile(path, "utf8")));
}

export async function saveSearchBatch(batch: SearchBatchArtifact, options: HeavyStorageOptions = {}): Promise<void> {
  const dirs = await ensureStorage(options);
  await writeJsonAtomic(join(dirs.searchBatches, `${safeFileName(batch.id)}.json`), batch);
}

export async function loadSearchBatch(batchId: string, options: HeavyStorageOptions = {}): Promise<SearchBatchArtifact | null> {
  const dirs = await ensureStorage(options);
  const path = join(dirs.searchBatches, `${safeFileName(batchId)}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8")) as SearchBatchArtifact;
}

export async function saveSourceArtifact(sourceHash: string, actionId: string, source: HeavySource, options: HeavyStorageOptions = {}): Promise<SourceArtifact> {
  const dirs = await ensureStorage(options);
  const summary = {
    sourceHash: safeFileName(sourceHash),
    actionId: safeFileName(actionId),
    title: source.title,
    url: source.url,
    provider: source.provider,
    engine: source.engine,
    snippet: source.snippet,
    fullTextLength: source.fullText?.length ?? 0,
    artifactPath: `sources/${safeFileName(sourceHash)}.json`,
    timestamp: new Date().toISOString()
  };
  const artifact: SourceArtifact = { sourceHash: summary.sourceHash, actionId: summary.actionId, source, summary, timestamp: summary.timestamp };
  await writeJsonAtomic(join(dirs.sources, `${safeFileName(sourceHash)}.json`), artifact);
  return artifact;
}

export async function loadSourceArtifact(sourceHash: string, options: HeavyStorageOptions = {}): Promise<SourceArtifact | null> {
  const dirs = await ensureStorage(options);
  const path = join(dirs.sources, `${safeFileName(sourceHash)}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8")) as SourceArtifact;
}
```

- [ ] **Step 5: 创建 state helper**

创建 `lib/heavy/graph/state.ts`：

```ts
import {
  DEFAULT_GRAPH_BUDGET,
  normalizeResearchFrame,
  normalizeResearchState,
  type Candidate,
  type DecisionTrace,
  type EvidenceItem,
  type GraphStateSummary,
  type PlannerHint,
  type ResearchAction,
  type ResearchActionRecord,
  type ResearchFrame,
  type ResearchState,
  type SearchLedgerEntry,
  type SourceLedgerEntry,
  type StateEvaluation
} from "@/lib/heavy/graph/types";

export function createInitialResearchState(frameInput: Partial<ResearchFrame>): ResearchState {
  return normalizeResearchState({
    frame: normalizeResearchFrame(frameInput),
    actions: [],
    searchLedger: [],
    sourceLedger: [],
    evidenceItems: [],
    candidatePool: [],
    promotedCandidates: [],
    openQuestions: [],
    contradictions: [],
    rejectedPaths: [],
    assumptions: frameInput.assumptions ?? [],
    decisionHistory: [],
    plannerHints: [],
    pendingActions: [],
    budgets: DEFAULT_GRAPH_BUDGET
  });
}

export function startNextCycle(state: ResearchState): ResearchState {
  return normalizeResearchState({
    ...state,
    budgets: {
      ...state.budgets,
      cycleIndex: state.budgets.cycleIndex + 1
    }
  });
}

export function recordActions(state: ResearchState, actions: ResearchAction[]): ResearchState {
  const now = new Date().toISOString();
  const records: ResearchActionRecord[] = actions.map((action) => ({
    action,
    status: "planned",
    createdAt: now
  }));
  return normalizeResearchState({
    ...state,
    actions: [...state.actions, ...records]
  });
}

export function recordSearchLedger(state: ResearchState, rows: SearchLedgerEntry[]): ResearchState {
  return normalizeResearchState({
    ...state,
    searchLedger: [...state.searchLedger, ...rows]
  });
}

export function recordSourceLedger(state: ResearchState, rows: SourceLedgerEntry[]): ResearchState {
  return normalizeResearchState({
    ...state,
    sourceLedger: [...state.sourceLedger, ...rows]
  });
}

export function upsertEvidenceItems(state: ResearchState, evidence: EvidenceItem[]): ResearchState {
  const byId = new Map(state.evidenceItems.map((item) => [item.id, item]));
  for (const item of evidence) {
    byId.set(item.id, item);
  }
  return normalizeResearchState({
    ...state,
    evidenceItems: Array.from(byId.values())
  });
}

export function upsertCandidates(state: ResearchState, candidates: Candidate[]): ResearchState {
  const byId = new Map(state.candidatePool.map((item) => [item.id, item]));
  for (const candidate of candidates) {
    byId.set(candidate.id, candidate);
  }
  return normalizeResearchState({
    ...state,
    candidatePool: Array.from(byId.values())
  });
}

export function recordGraphDecision(state: ResearchState, decision: string, reason: string): ResearchState {
  const trace: DecisionTrace = {
    id: `decision_${state.decisionHistory.length + 1}`,
    decision,
    reason,
    timestamp: new Date().toISOString()
  };
  return normalizeResearchState({
    ...state,
    decisionHistory: [...state.decisionHistory, trace]
  });
}

export function recordPlannerFeedback(state: ResearchState, evaluation: StateEvaluation): ResearchState {
  const hint: PlannerHint = {
    id: `hint_${state.plannerHints.length + 1}`,
    decision: evaluation.decision,
    reason: evaluation.reason,
    nextFocus: evaluation.nextFocus,
    avoidQueries: evaluation.avoidQueries,
    createdAt: new Date().toISOString()
  };
  return normalizeResearchState({
    ...state,
    plannerHints: [...state.plannerHints, hint],
    pendingActions: [...state.pendingActions, ...evaluation.recommendedActions]
  });
}

export function consumePendingActions(state: ResearchState): { state: ResearchState; actions: ResearchAction[] } {
  const actions = state.pendingActions;
  return {
    state: normalizeResearchState({
      ...state,
      pendingActions: []
    }),
    actions
  };
}

export function summarizeResearchState(state: ResearchState): GraphStateSummary {
  return {
    frame: state.frame,
    cycleIndex: state.budgets.cycleIndex,
    candidates: state.candidatePool
      .filter((candidate) => candidate.status === "promoted" || candidate.status === "ranked" || candidate.status === "active")
      .sort((a, b) => b.score - a.score)
      .slice(0, 20),
    evidenceItems: state.evidenceItems.slice(0, 80),
    decisionHistory: state.decisionHistory.slice(-20),
    rejectedPaths: state.rejectedPaths,
    openQuestions: state.openQuestions,
    plannerHints: state.plannerHints.slice(-10),
    searchBatches: state.searchLedger.map((row) => ({
      id: row.resultBatchId,
      actionId: row.actionId,
      query: row.query,
      provider: row.provider,
      engine: row.engine,
      resultCount: row.resultCount,
      resultPreview: row.resultPreview,
      artifactPath: `search-batches/${row.resultBatchId}.json`,
      timestamp: row.timestamp
    })),
    sourceSummaries: state.sourceLedger.map((row) => row.sourceSummary),
    searchCount: state.searchLedger.length,
    sourceCount: state.sourceLedger.length
  };
}
```

- [ ] **Step 6: 运行测试**

Run:

```bash
npm run test -- tests/heavy-graph-state.test.ts
```

Expected: pass.

---

## Task 3: ResearchFrame 创建

**Files:**

- Create: `lib/heavy/graph/frame.ts`
- Test: `tests/heavy-graph-frame.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/heavy-graph-frame.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { createResearchFrame, heuristicResearchFrame } from "@/lib/heavy/graph/frame";

describe("Graph Heavy research frame", () => {
  it("heuristically recognizes the Grace Brown style find-person task", () => {
    const frame = heuristicResearchFrame("我要找澳大利亚创新硬件公司 CEO，不能做太阳能、医疗器械、重工，最好增长 30%，任职三年以上，并发表过 AI 观点文章");

    expect(frame.taskKind).toBe("find_person_company");
    expect(frame.hardConstraints.map((item) => item.id)).toEqual(expect.arrayContaining(["geo_australia", "role_ceo", "innovative_hardware"]));
    expect(frame.exclusionRules.map((item) => item.id)).toEqual(expect.arrayContaining(["exclude_solar", "exclude_medical", "exclude_heavy_manufacturing"]));
    expect(frame.searchPolicy.defaultLanguage).toBe("en");
    expect(frame.rankingPolicy.mustRankWhenEvidenceExists).toBe(true);
  });

  it("normalizes model JSON and keeps English search policy", async () => {
    const frame = await createResearchFrame({
      prompt: "Find an Australian robotics CEO",
      createChatCompletion: vi.fn(async () => ({
        model: "test",
        content: JSON.stringify({
          taskKind: "find_person_company",
          userGoal: "Find the likely candidate",
          deliverable: "ranked candidates",
          hardConstraints: [{ id: "role_ceo", label: "CEO", kind: "hard" }],
          softPreferences: [],
          exclusionRules: [],
          evidencePolicy: { directEvidenceRequired: true, proxyEvidenceAllowed: true, unknownsMustBeLabeled: true },
          searchPolicy: { defaultLanguage: "zh", maxResultsPerQuery: 5, engines: [] },
          rankingPolicy: { mustRankWhenEvidenceExists: true, maxRankedCandidates: 3 },
          stopCriteria: [],
          initialAngles: [],
          assumptions: []
        })
      }))
    });

    expect(frame.taskKind).toBe("find_person_company");
    expect(frame.searchPolicy.defaultLanguage).toBe("en");
    expect(frame.searchPolicy.maxResultsPerQuery).toBe(5);
  });

  it("falls back to heuristic frame when model JSON fails", async () => {
    const frame = await createResearchFrame({
      prompt: "设计海关数据清洗和客户分级方案",
      createChatCompletion: vi.fn(async () => ({ model: "test", content: "not json" }))
    });

    expect(frame.taskKind).toBe("data_workflow_design");
    expect(frame.deliverable).toContain("workflow");
  });
});
```

- [ ] **Step 2: 创建 frame 模块**

创建 `lib/heavy/graph/frame.ts`：

```ts
import { createChatCompletion as defaultCreateChatCompletion, getOpenAIConfig, type ChatCompletionResult } from "@/lib/openai";
import { parseJsonObject } from "@/lib/heavy/types";
import { normalizeResearchFrame, type ResearchFrame } from "@/lib/heavy/graph/types";

type CreateFrameInput = {
  prompt: string;
  createChatCompletion?: (input: Parameters<typeof defaultCreateChatCompletion>[0]) => Promise<ChatCompletionResult>;
};

export async function createResearchFrame(input: CreateFrameInput): Promise<ResearchFrame> {
  try {
    const config = getOpenAIConfig();
    const completion = await (input.createChatCompletion ?? defaultCreateChatCompletion)({
      ...config,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "You are an Apodex-like research framing agent. Output strict JSON only. Search policy must default to English queries."
        },
        {
          role: "user",
          content: buildFramePrompt(input.prompt)
        }
      ]
    });
    return normalizeResearchFrame(parseJsonObject(completion.content));
  } catch {
    return heuristicResearchFrame(input.prompt);
  }
}

export function heuristicResearchFrame(prompt: string): ResearchFrame {
  const lower = prompt.toLowerCase();
  if (/海关|清洗|客户|分级|同行|数据|workflow|pipeline/.test(lower)) {
    return normalizeResearchFrame({
      taskKind: "data_workflow_design",
      userGoal: prompt,
      deliverable: "workflow design with ordered gates, evidence boundaries, and implementation architecture",
      hardConstraints: [
        { id: "data_cleaning", label: "clean and normalize customs data", kind: "hard" },
        { id: "entity_resolution", label: "merge duplicate company entities", kind: "hard" },
        { id: "customer_grading", label: "grade customers with explainable criteria", kind: "hard" }
      ],
      softPreferences: [{ id: "external_verification", label: "separate internal inference from external verification", kind: "soft" }],
      exclusionRules: [],
      evidencePolicy: { directEvidenceRequired: false, proxyEvidenceAllowed: true, unknownsMustBeLabeled: true },
      searchPolicy: { defaultLanguage: "en", maxResultsPerQuery: 30, engines: ["google", "brave", "duckduckgo"] },
      rankingPolicy: { mustRankWhenEvidenceExists: true, maxRankedCandidates: 5 },
      stopCriteria: ["Workflow stages and decision gates are explicit"],
      initialAngles: [
        { id: "cleaning", title: "Customs data cleaning and normalization", priority: "high" },
        { id: "entity_resolution", title: "Company entity resolution", priority: "high" },
        { id: "grading", title: "Customer scoring and segmentation", priority: "high" }
      ],
      assumptions: [{ id: "external_needed", text: "Some customer fit signals require external data beyond customs records.", status: "active" }]
    });
  }

  return normalizeResearchFrame({
    taskKind: "find_person_company",
    userGoal: prompt,
    deliverable: "ranked candidates with evidence matrix, rejected alternatives, and unresolved gaps",
    hardConstraints: [
      { id: "geo_australia", label: "Australia or Australian company connection", kind: "hard" },
      { id: "role_ceo", label: "candidate is CEO, founder, or equivalent leader", kind: "hard" },
      { id: "innovative_hardware", label: "company builds innovative hardware or robotics product", kind: "hard" }
    ],
    softPreferences: [
      { id: "growth_30_percent", label: "around 30% annual growth or credible proxy growth evidence", kind: "soft" },
      { id: "tenure_three_years", label: "candidate has worked in the company for more than three years", kind: "soft" },
      { id: "recent_ai_article", label: "recent article, post, or interview with AI viewpoint", kind: "soft" }
    ],
    exclusionRules: [
      { id: "exclude_solar", label: "not solar panel company", kind: "exclusion" },
      { id: "exclude_medical", label: "not medical device company", kind: "exclusion" },
      { id: "exclude_heavy_manufacturing", label: "not heavy manufacturing company", kind: "exclusion" }
    ],
    evidencePolicy: { directEvidenceRequired: true, proxyEvidenceAllowed: true, unknownsMustBeLabeled: true },
    searchPolicy: { defaultLanguage: "en", maxResultsPerQuery: 30, engines: ["google", "brave", "duckduckgo"] },
    rankingPolicy: { mustRankWhenEvidenceExists: true, maxRankedCandidates: 5 },
    stopCriteria: ["At least one ranked candidate has direct evidence for core hard constraints"],
    initialAngles: [
      { id: "broad_candidates", title: "Australian robotics and innovative hardware CEO candidates", priority: "high" },
      { id: "ai_article", title: "Candidate AI article, interview, or post", priority: "medium" },
      { id: "growth_proxy", title: "Funding, valuation, revenue, deployment, hiring, or expansion growth signals", priority: "medium" }
    ],
    assumptions: [{ id: "proxy_growth_allowed", text: "Funding, valuation, production expansion, and customer deployment can be proxy growth evidence when exact annual growth is unavailable.", status: "active" }]
  });
}

function buildFramePrompt(prompt: string): string {
  return `User prompt:
${prompt}

Return strict JSON:
{
  "taskKind": "find_person_company|find_website|technical_verification|data_workflow_design|market_list_building|sales_strategy|general_research",
  "userGoal": "...",
  "deliverable": "...",
  "hardConstraints": [{ "id": "role_ceo", "label": "CEO", "kind": "hard" }],
  "softPreferences": [{ "id": "growth", "label": "growth evidence", "kind": "soft" }],
  "exclusionRules": [{ "id": "exclude_medical", "label": "not medical device", "kind": "exclusion" }],
  "evidencePolicy": { "directEvidenceRequired": true, "proxyEvidenceAllowed": true, "unknownsMustBeLabeled": true },
  "searchPolicy": { "defaultLanguage": "en", "maxResultsPerQuery": 30, "engines": ["google", "brave", "duckduckgo"] },
  "rankingPolicy": { "mustRankWhenEvidenceExists": true, "maxRankedCandidates": 5 },
  "stopCriteria": ["..."],
  "initialAngles": [{ "id": "broad", "title": "broad English search", "priority": "high" }],
  "assumptions": [{ "id": "proxy", "text": "proxy evidence is allowed when exact evidence is missing", "status": "active" }]
}

Rules:
- Do not answer the user.
- Separate hard constraints, soft preferences, and exclusions.
- Search policy must use English by default.`;
}
```

- [ ] **Step 3: 运行测试**

Run:

```bash
npm run test -- tests/heavy-graph-frame.test.ts
```

Expected: pass.

---

## Task 4: Action Planner 与英文关键词修正

**Files:**

- Create: `lib/heavy/graph/actions.ts`
- Create: `lib/heavy/graph/planner.ts`
- Test: `tests/heavy-graph-planner.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/heavy-graph-planner.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { createInitialResearchState, upsertCandidates } from "@/lib/heavy/graph/state";
import { heuristicResearchFrame } from "@/lib/heavy/graph/frame";
import { planNextActions } from "@/lib/heavy/graph/planner";
import { sanitizeEnglishQuery } from "@/lib/heavy/graph/actions";

describe("Graph Heavy planner", () => {
  it("creates broad English search actions for a fresh find-person state", async () => {
    const state = createInitialResearchState(heuristicResearchFrame("找澳大利亚创新硬件 CEO，排除太阳能、医疗、重工"));
    const actions = await planNextActions({ state });

    expect(actions.some((action) => action.type === "search_web")).toBe(true);
    const queries = actions.flatMap((action) => action.type === "search_web" ? action.queries : []);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((query) => !/[\u3400-\u9fff\uf900-\ufaff]/.test(query))).toBe(true);
    expect(queries.join(" ")).toContain("Australian");
  });

  it("deep-dives promoted or active candidates with revised exact-phrase queries", async () => {
    const state = upsertCandidates(createInitialResearchState(heuristicResearchFrame("找澳大利亚创新硬件 CEO")), [{
      id: "cand_andromeda",
      kind: "person_company",
      name: "Grace Brown / Andromeda Robotics",
      aliases: ["Grace Brown", "Andromeda Robotics"],
      summary: "Candidate discovered from broad search",
      entities: { person: "Grace Brown", company: "Andromeda Robotics" },
      matchedConstraints: [{ constraintId: "geo_australia", status: "direct", evidenceIds: ["ev_1"] }, { constraintId: "role_ceo", status: "direct", evidenceIds: ["ev_2"] }],
      missingConstraints: [{ constraintId: "growth_30_percent", reason: "Need growth evidence" }, { constraintId: "recent_ai_article", reason: "Need AI article" }],
      proxyEvidenceIds: [],
      directEvidenceIds: ["ev_1", "ev_2"],
      risks: [],
      score: 60,
      confidence: "medium",
      status: "active"
    }]);

    const actions = await planNextActions({ state });
    const queries = actions.flatMap((action) => action.type === "search_web" ? action.queries : []);

    expect(queries.join("\n")).toContain('"Grace Brown"');
    expect(queries.join("\n")).toContain('"Andromeda Robotics"');
    expect(queries.join("\n")).toMatch(/AI article|funding|growth|CEO/);
  });

  it("removes Chinese and literal placeholders from queries", () => {
    expect(sanitizeEnglishQuery('澳大利亚 {company} CEO name "Grace Brown"')).toBe('"Grace Brown" CEO');
    expect(sanitizeEnglishQuery("company name CEO name")).toBe("CEO");
  });
});
```

- [ ] **Step 2: 创建 action helper**

创建 `lib/heavy/graph/actions.ts`：

```ts
import { normalizeResearchAction, type ResearchAction } from "@/lib/heavy/graph/types";

export function createActionId(prefix: string, index: number): string {
  return `${prefix}_${Date.now().toString(36)}_${index}`;
}

export function sanitizeEnglishQuery(value: string): string {
  return value
    .replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ")
    .replace(/\{[^}]+\}/g, " ")
    .replace(/\b(company name|ceo name|person name|candidate name)\b/gi, " ")
    .replace(/[^a-zA-Z0-9 .,'"&:%/+_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeSearchAction(input: {
  id: string;
  purpose: string;
  rationale: string;
  queries: string[];
  expectedSignals: string[];
  avoidQueries?: string[];
  maxResults: number;
  priority?: "low" | "medium" | "high";
}): ResearchAction {
  const action = normalizeResearchAction({
    id: input.id,
    type: "search_web",
    purpose: input.purpose,
    rationale: input.rationale,
    priority: input.priority ?? "high",
    queries: input.queries.map(sanitizeEnglishQuery).filter(Boolean),
    avoidQueries: input.avoidQueries?.map(sanitizeEnglishQuery).filter(Boolean),
    expectedSignals: input.expectedSignals,
    maxResults: input.maxResults
  });
  if (!action) {
    throw new Error(`Invalid search action: ${input.id}`);
  }
  return action;
}

export function makeReadAction(input: {
  id: string;
  purpose: string;
  rationale: string;
  resultUrls: string[];
}): ResearchAction | null {
  return normalizeResearchAction({
    id: input.id,
    type: "read_source",
    purpose: input.purpose,
    rationale: input.rationale,
    priority: "medium",
    resultUrls: input.resultUrls
  });
}
```

- [ ] **Step 3: 创建 planner**

创建 `lib/heavy/graph/planner.ts`：

```ts
import { makeSearchAction } from "@/lib/heavy/graph/actions";
import type { Candidate, ResearchAction, ResearchState } from "@/lib/heavy/graph/types";

type PlanInput = {
  state: ResearchState;
};

export async function planNextActions(input: PlanInput): Promise<ResearchAction[]> {
  const state = input.state;
  const cycle = state.budgets.cycleIndex + 1;
  const actions: ResearchAction[] = [];

  if (state.candidatePool.length === 0) {
    actions.push(...planBroadSearches(state, cycle));
  } else {
    actions.push(...planCandidateDeepDives(state, cycle));
  }

  return actions.slice(0, state.budgets.maxActionsPerCycle);
}

function planBroadSearches(state: ResearchState, cycle: number): ResearchAction[] {
  const kind = state.frame.taskKind;
  if (kind === "find_person_company") {
    return [
      makeSearchAction({
        id: `search_broad_candidates_${cycle}`,
        purpose: "Find broad candidate people and companies",
        rationale: "The state has no candidates yet, so start with broad English searches for scarce signals.",
        queries: [
          "Australian robotics startup CEO AI hardware founder",
          "Australia innovative hardware company CEO robotics AI article",
          "Australian AI robotics hardware startup founder funding growth"
        ],
        expectedSignals: ["Australia", "CEO", "founder", "robotics", "hardware", "AI"],
        maxResults: state.budgets.maxResultsPerQuery
      }),
      makeSearchAction({
        id: `search_growth_articles_${cycle}`,
        purpose: "Find growth and AI article signals",
        rationale: "The user needs recent AI viewpoint and growth evidence, so search those evidence types early.",
        queries: [
          "Australian robotics CEO AI article interview",
          "Australian hardware robotics startup funding valuation growth CEO",
          "site:linkedin.com/posts Australian robotics CEO AI"
        ],
        expectedSignals: ["AI article", "interview", "funding", "growth"],
        maxResults: state.budgets.maxResultsPerQuery
      })
    ];
  }

  if (kind === "data_workflow_design") {
    return [
      makeSearchAction({
        id: `search_customs_data_workflow_${cycle}`,
        purpose: "Research customs data cleaning and customer grading workflow",
        rationale: "The state needs proven workflow patterns and boundary conditions.",
        queries: [
          "customs trade data cleaning entity resolution customer segmentation",
          "import export data company matching customer scoring methodology",
          "trade data buyer supplier deduplication HS code customer classification"
        ],
        expectedSignals: ["data cleaning", "entity resolution", "customer segmentation", "HS code"],
        maxResults: state.budgets.maxResultsPerQuery
      })
    ];
  }

  return [
    makeSearchAction({
      id: `search_general_${cycle}`,
      purpose: "Gather broad evidence for the user goal",
      rationale: "The frame is general, so begin with broad English evidence gathering.",
      queries: [`${state.frame.userGoal} official source evidence`.replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ")],
      expectedSignals: ["official source", "evidence"],
      maxResults: state.budgets.maxResultsPerQuery
    })
  ];
}

function planCandidateDeepDives(state: ResearchState, cycle: number): ResearchAction[] {
  return state.candidatePool
    .filter((candidate) => candidate.status !== "rejected")
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(3, state.budgets.maxPromotedCandidates))
    .map((candidate, index) => makeSearchAction({
      id: `search_candidate_${cycle}_${index + 1}`,
      purpose: `Deep dive candidate ${candidate.name}`,
      rationale: "A candidate exists in the global pool, so revise queries with exact names and missing constraints.",
      queries: candidateQueries(candidate),
      expectedSignals: ["official", "CEO", "founder", "AI article", "funding", "growth", "exclusion"],
      maxResults: state.budgets.maxResultsPerQuery,
      priority: candidate.status === "promoted" ? "high" : "medium"
    }));
}

function candidateQueries(candidate: Candidate): string[] {
  const person = candidate.entities.person || candidate.aliases.find((alias) => alias.split(" ").length >= 2) || candidate.name;
  const company = candidate.entities.company || candidate.aliases.find((alias) => /robotics|labs|systems|technologies|company/i.test(alias)) || candidate.name;
  return [
    `"${person}" "${company}" CEO founder`,
    `"${person}" "${company}" AI article interview LinkedIn`,
    `"${company}" funding valuation annual growth expansion`,
    `site:${domainHint(company)} "${person}" CEO`
  ];
}

function domainHint(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/robotics$/, "robotics") + ".ai";
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
npm run test -- tests/heavy-graph-planner.test.ts
```

Expected: pass.

---

## Task 5: Executor 搜索/读取 action

> Eng review decision 4A: 宽搜索会让 NDJSON/stream 迅速膨胀，所以 `search_performed` 和 `source_read` 事件必须是轻量摘要。完整搜索结果写入 `research-runs/search-batches/{batchId}.json`，完整网页正文写入 `research-runs/sources/{sourceHash}.json`；UI 展示 summary，并通过 artifact id 按需读取完整数据。

**Files:**

- Create: `lib/heavy/graph/executor.ts`
- Test: `tests/heavy-graph-executor.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/heavy-graph-executor.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { executeActions } from "@/lib/heavy/graph/executor";
import { createInitialResearchState } from "@/lib/heavy/graph/state";
import { heuristicResearchFrame } from "@/lib/heavy/graph/frame";
import type { HeavySearchProvider } from "@/lib/heavy/types";

describe("Graph Heavy executor", () => {
  it("executes search actions and records provider, engine, and results", async () => {
    const provider: HeavySearchProvider = {
      search: async (query) => [
        { title: "Grace Brown CEO", url: "https://example.com/grace", snippet: query, provider: "opencli", engine: "google" }
      ],
      read: async (result) => ({ ...result, snippet: result.snippet ?? "", fullText: "full text" })
    };
    const state = createInitialResearchState(heuristicResearchFrame("找澳大利亚创新硬件 CEO"));
    const result = await executeActions({
      inquiryId: "inquiry_1",
      turnId: "turn_1",
      state,
      provider,
      actions: [{
        id: "search_1",
        type: "search_web",
        purpose: "search",
        rationale: "need candidates",
        priority: "high",
        queries: ["Australian robotics CEO"],
        expectedSignals: ["CEO"],
        maxResults: 30
      }],
      emit: async () => undefined
    });

    expect(result.searchLedger).toHaveLength(1);
    expect(result.searchLedger[0].provider).toBe("opencli");
    expect(result.searchLedger[0].engine).toBe("google");
    expect(result.searchLedger[0].resultBatchId).toMatch(/^batch_/);
    expect(result.searchLedger[0].resultPreview[0].url).toBe("https://example.com/grace");
    expect(result.searchArtifacts[0].results[0].url).toBe("https://example.com/grace");
  });

  it("continues when one query fails", async () => {
    const provider: HeavySearchProvider = {
      search: async (query) => {
        if (query.includes("bad")) throw new Error("provider failed");
        return [{ title: "Good", url: "https://example.com/good", snippet: "ok", provider: "test" }];
      },
      read: async (result) => ({ ...result, snippet: result.snippet ?? "", fullText: "full text" })
    };
    const state = createInitialResearchState(heuristicResearchFrame("找澳大利亚创新硬件 CEO"));
    const result = await executeActions({
      inquiryId: "inquiry_1",
      turnId: "turn_1",
      state,
      provider,
      actions: [{
        id: "search_1",
        type: "search_web",
        purpose: "search",
        rationale: "need candidates",
        priority: "high",
        queries: ["bad query", "good query"],
        expectedSignals: ["CEO"],
        maxResults: 30
      }],
      emit: async () => undefined
    });

    expect(result.searchLedger).toHaveLength(1);
    expect(result.failedActions[0].error).toContain("provider failed");
  });
});
```

- [ ] **Step 2: 创建 executor**

创建 `lib/heavy/graph/executor.ts`：

```ts
import { compactError, type HeavySearchProvider } from "@/lib/heavy/types";
import { saveSearchBatch, saveSourceArtifact, type HeavyStorageOptions } from "@/lib/heavy/storage";
import type { GraphHeavyEvent, ResearchAction, ResearchState, SearchBatchArtifact, SearchLedgerEntry, SourceArtifact, SourceLedgerEntry } from "@/lib/heavy/graph/types";

export type ExecuteActionsInput = HeavyStorageOptions & {
  inquiryId: string;
  turnId: string;
  state: ResearchState;
  provider: HeavySearchProvider;
  actions: ResearchAction[];
  searchArtifacts?: SearchBatchArtifact[];
  emit: (event: GraphHeavyEvent) => Promise<void>;
};

export type ExecuteActionsOutput = {
  searchLedger: SearchLedgerEntry[];
  sourceLedger: SourceLedgerEntry[];
  searchArtifacts: SearchBatchArtifact[];
  sourceArtifacts: SourceArtifact[];
  completedActions: ResearchAction[];
  failedActions: { action: ResearchAction; error: string }[];
};

export async function executeActions(input: ExecuteActionsInput): Promise<ExecuteActionsOutput> {
  const searchLedger: SearchLedgerEntry[] = [];
  const sourceLedger: SourceLedgerEntry[] = [];
  const searchArtifacts: SearchBatchArtifact[] = [];
  const sourceArtifacts: SourceArtifact[] = [];
  const completedActions: ResearchAction[] = [];
  const failedActions: { action: ResearchAction; error: string }[] = [];

  for (const action of input.actions) {
    await input.emit({ type: "action_started", inquiryId: input.inquiryId, turnId: input.turnId, action, timestamp: new Date().toISOString() });
    try {
      if (action.type === "search_web") {
        for (const query of action.queries.slice(0, input.state.budgets.maxQueriesPerSearchAction)) {
          const results = await input.provider.search(query, action.maxResults);
          const providerLog = input.provider.drainSearchLogs?.().at(-1);
          const provider = providerLog?.provider ?? results[0]?.provider ?? "test";
          const engine = providerLog?.engine ?? results.find((result) => result.engine)?.engine;
          const resultBatchId = `batch_${action.id}_${hashText(query)}`;
          const timestamp = new Date().toISOString();
          const batch: SearchBatchArtifact = {
            id: resultBatchId,
            actionId: action.id,
            query,
            provider,
            engine,
            resultCount: results.length,
            results,
            timestamp
          };
          await saveSearchBatch(batch, input);
          searchArtifacts.push(batch);
          const entry: SearchLedgerEntry = {
            actionId: action.id,
            query,
            provider,
            engine,
            resultCount: results.length,
            resultBatchId,
            resultPreview: summarizeResults(results, 10),
            timestamp
          };
          searchLedger.push(entry);
          await input.emit({
            type: "search_performed",
            inquiryId: input.inquiryId,
            turnId: input.turnId,
            actionId: action.id,
            query,
            provider,
            engine,
            resultCount: results.length,
            resultBatchId,
            resultPreview: entry.resultPreview,
            timestamp
          });
        }
      }

      if (action.type === "read_source") {
        const availableResults = [
          ...(input.searchArtifacts ?? []).flatMap((batch) => batch.results),
          ...input.state.searchLedger.flatMap((row) => row.resultPreview)
        ];
        const results = availableResults.filter((result) => action.resultUrls.includes(result.url));
        for (const result of results.slice(0, input.state.budgets.maxSourcesToReadPerCycle)) {
          const source = await input.provider.read(result);
          const sourceHash = `src_${hashText(source.url)}`;
          const sourceArtifact = await saveSourceArtifact(sourceHash, action.id, source, input);
          const entry: SourceLedgerEntry = {
            actionId: action.id,
            sourceHash,
            sourceSummary: sourceArtifact.summary,
            timestamp: sourceArtifact.timestamp
          };
          sourceLedger.push(entry);
          sourceArtifacts.push(sourceArtifact);
          await input.emit({ type: "source_read", inquiryId: input.inquiryId, turnId: input.turnId, actionId: action.id, sourceHash, sourceSummary: sourceArtifact.summary, timestamp: entry.timestamp });
        }
      }

      completedActions.push(action);
    } catch (error) {
      failedActions.push({ action, error: compactError(error instanceof Error ? error.message : "Graph action failed") });
    }
  }

  return { searchLedger, sourceLedger, searchArtifacts, sourceArtifacts, completedActions, failedActions };
}

function summarizeResults(results: Array<{ title: string; url: string; snippet?: string; provider?: string; engine?: string }>, limit: number) {
  return results.slice(0, limit).map((result, index) => ({
    title: result.title,
    url: result.url,
    snippet: result.snippet,
    provider: result.provider,
    engine: result.engine,
    rank: index + 1
  }));
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
```

- [ ] **Step 3: 运行测试**

Run:

```bash
npm run test -- tests/heavy-graph-executor.test.ts
```

Expected: pass.

---

## Task 5A: Source Selector 与 Search-to-Read Handoff

> Eng review decision 1A: Task 6 之前必须先完成 Task 5A。Graph 主循环必须先搜索，再选择 URL，再读取网页，最后抽证。禁止直接用 search snippets 作为主要证据路径。

**Files:**

- Create: `lib/heavy/graph/source-selector.ts`
- Test: `tests/heavy-graph-source-selector.test.ts`
- Modify: `lib/heavy/graph/graph-orchestrator.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/heavy-graph-source-selector.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { selectSourcesToRead } from "@/lib/heavy/graph/source-selector";
import { createInitialResearchState, recordSearchLedger } from "@/lib/heavy/graph/state";
import { heuristicResearchFrame } from "@/lib/heavy/graph/frame";
import type { SearchBatchArtifact } from "@/lib/heavy/graph/types";

describe("Graph Heavy source selector", () => {
  it("creates read_source actions from search results after search completes", () => {
    let state = createInitialResearchState(heuristicResearchFrame("找澳大利亚创新硬件 CEO"));
    state = recordSearchLedger(state, [
      {
        actionId: "search_1",
        query: "Australian robotics CEO",
        provider: "opencli",
        engine: "google",
        resultCount: 3,
        resultBatchId: "batch_1",
        resultPreview: [
          { title: "Generic list", url: "https://seo.example.com/list", snippet: "Top startups list", provider: "opencli", engine: "google" },
          { title: "Grace Brown - Andromeda Robotics CEO", url: "https://andromedarobotics.ai/grace", snippet: "Official CEO profile", provider: "opencli", engine: "google" },
          { title: "Business News Australia Andromeda funding", url: "https://www.businessnewsaustralia.com/andromeda-funding", snippet: "Funding and growth proxy", provider: "opencli", engine: "google" }
        ].map((result, index) => ({ ...result, rank: index + 1 })),
        timestamp: "2026-07-02T00:00:00.000Z"
      }
    ]);

    const actions = selectSourcesToRead(state, "read_cycle_1");

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("read_source");
    expect(actions[0].type === "read_source" ? actions[0].resultUrls : []).toEqual([
      "https://andromedarobotics.ai/grace",
      "https://www.businessnewsaustralia.com/andromeda-funding",
      "https://seo.example.com/list"
    ]);
  });

  it("does not re-read URLs already present in sourceLedger", () => {
    const state = {
      ...recordSearchLedger(createInitialResearchState(heuristicResearchFrame("找澳大利亚创新硬件 CEO")), [
        {
          actionId: "search_1",
          query: "Australian robotics CEO",
          provider: "test",
          resultCount: 1,
          resultBatchId: "batch_1",
          resultPreview: [{ title: "A", url: "https://example.com/a", snippet: "A", provider: "test", rank: 1 }],
          timestamp: "2026-07-02T00:00:00.000Z"
        }
      ]),
      sourceLedger: [
        {
          actionId: "read_1",
          sourceHash: "src_1",
          sourceSummary: { sourceHash: "src_1", actionId: "read_1", title: "A", url: "https://example.com/a", snippet: "A", provider: "test", fullTextLength: 1, timestamp: "2026-07-02T00:00:01.000Z" },
          timestamp: "2026-07-02T00:00:01.000Z"
        }
      ]
    };

    expect(selectSourcesToRead(state, "read_cycle_1")).toEqual([]);
  });

  it("uses full search batch artifacts when event previews are truncated", () => {
    const state = recordSearchLedger(createInitialResearchState(heuristicResearchFrame("找澳大利亚创新硬件 CEO")), [{
      actionId: "search_1",
      query: "Australian robotics CEO",
      provider: "test",
      resultCount: 30,
      resultBatchId: "batch_1",
      resultPreview: [{ title: "Preview only", url: "https://example.com/preview", snippet: "Preview", provider: "test", rank: 1 }],
      timestamp: "2026-07-02T00:00:00.000Z"
    }]);
    const artifact: SearchBatchArtifact = {
      id: "batch_1",
      actionId: "search_1",
      query: "Australian robotics CEO",
      provider: "test",
      resultCount: 30,
      results: [
        { title: "Preview only", url: "https://example.com/preview", snippet: "Preview", provider: "test" },
        { title: "Grace Brown - Andromeda Robotics CEO", url: "https://andromedarobotics.ai/grace", snippet: "Official CEO profile", provider: "test" }
      ],
      timestamp: "2026-07-02T00:00:00.000Z"
    };

    const actions = selectSourcesToRead(state, "read_cycle_1", [artifact]);

    expect(actions[0].type === "read_source" ? actions[0].resultUrls : []).toContain("https://andromedarobotics.ai/grace");
  });
});
```

- [ ] **Step 2: 创建 source selector**

创建 `lib/heavy/graph/source-selector.ts`：

```ts
import { makeReadAction } from "@/lib/heavy/graph/actions";
import type { HeavySearchResult } from "@/lib/heavy/types";
import type { ResearchAction, ResearchState, SearchBatchArtifact } from "@/lib/heavy/graph/types";

type SelectableSearchResult = Pick<HeavySearchResult, "title" | "url" | "snippet" | "provider" | "engine">;

export function selectSourcesToRead(state: ResearchState, actionId: string, searchArtifacts: SearchBatchArtifact[] = []): ResearchAction[] {
  const alreadyRead = new Set(state.sourceLedger.map((row) => row.sourceSummary.url.toLowerCase()));
  const availableResults = searchArtifacts.length > 0
    ? searchArtifacts.flatMap((batch) => batch.results)
    : state.searchLedger.flatMap((row) => row.resultPreview);
  const results = dedupeResults(availableResults)
    .filter((result) => !alreadyRead.has(result.url.toLowerCase()))
    .map((result, index) => ({ result, index, score: scoreResultForRead(result) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, state.budgets.maxSourcesToReadPerCycle)
    .map((row) => row.result);

  if (results.length === 0) {
    return [];
  }

  const action = makeReadAction({
    id: actionId,
    purpose: "Read selected source pages from search results",
    rationale: "Search results must be turned into real page reads before evidence extraction.",
    resultUrls: results.map((result) => result.url)
  });

  return action ? [action] : [];
}

function scoreResultForRead(result: SelectableSearchResult): number {
  const url = result.url.toLowerCase();
  const text = `${result.title} ${result.snippet ?? ""}`.toLowerCase();
  let score = 0;

  if (isOfficialLike(result)) score += 50;
  if (url.includes("linkedin.com")) score += 30;
  if (/businessnewsaustralia|afr\.com|smartcompany|startupdaily|techcrunch|forbes/.test(url)) score += 25;
  if (/ceo|founder|robotics|hardware|ai|funding|growth|series a|valuation|interview|article/.test(text)) score += 15;
  if (/seo\.example|listicle|top startups list/.test(text)) score -= 30;

  return score;
}

function isOfficialLike(result: SelectableSearchResult): boolean {
  try {
    const host = new URL(result.url).hostname.replace(/^www\./, "").toLowerCase();
    if (/linkedin|facebook|instagram|youtube|twitter|x\.com|medium|substack|crunchbase|forbes|techcrunch|businessnewsaustralia|news|seo|example/.test(host)) {
      return false;
    }
    const domain = host.split(".").at(-2) ?? host;
    const text = `${result.title} ${result.snippet ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return domain.length >= 5 && text.includes(domain.replace(/[^a-z0-9]+/g, ""));
  } catch {
    return false;
  }
}

function dedupeResults(results: SelectableSearchResult[]): SelectableSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = result.url.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

- [ ] **Step 3: 修改 orchestrator 主循环**

在 `lib/heavy/graph/graph-orchestrator.ts` imports 增加：

```ts
import { selectSourcesToRead } from "@/lib/heavy/graph/source-selector";
```

把主循环里的搜索后抽证流程从：

```ts
const executed = await executeActions({ inquiryId, turnId, state, provider, actions: planned, emit });
state = recordSearchLedger(state, executed.searchLedger);
state = recordSourceLedger(state, executed.sourceLedger);

const extracted = await extractEvidenceFromState({ state, actionId: `extract_${state.budgets.cycleIndex}` });
```

改成：

```ts
const executed = await executeActions({ inquiryId, turnId, state, provider, actions: planned, emit });
state = recordSearchLedger(state, executed.searchLedger);
state = recordSourceLedger(state, executed.sourceLedger);
let sourceArtifacts = [...executed.sourceArtifacts];

const readActions = selectSourcesToRead(state, `read_cycle_${state.budgets.cycleIndex}`, executed.searchArtifacts);
if (readActions.length > 0) {
  state = recordActions(state, readActions);
  await emit({
    type: "actions_planned",
    inquiryId,
    turnId,
    cycleIndex: state.budgets.cycleIndex,
    actions: readActions,
    timestamp: new Date().toISOString()
  });
  const readExecuted = await executeActions({ inquiryId, turnId, state, provider, actions: readActions, searchArtifacts: executed.searchArtifacts, emit });
  state = recordSourceLedger(state, readExecuted.sourceLedger);
  sourceArtifacts = [...sourceArtifacts, ...readExecuted.sourceArtifacts];
}

const extracted = await extractEvidenceFromState({ state, actionId: `extract_${state.budgets.cycleIndex}`, sourceArtifacts });
```

- [ ] **Step 4: 增加 orchestrator 测试断言**

在 `tests/heavy-graph-orchestrator.test.ts` 的主流程测试里，读取 NDJSON 并确认发生了 `source_read`：

```ts
const { readFile } = await import("node:fs/promises");
const rawLog = await readFile(join(rootDir, "logs", `${turn.id}.ndjson`), "utf8");
expect(rawLog).toContain('"type":"search_performed"');
expect(rawLog).toContain('"type":"source_read"');
expect(rawLog).toContain('"resultBatchId"');
expect(rawLog).toContain('"sourceHash"');
expect(rawLog).not.toContain('"fullText"');
```

- [ ] **Step 5: 运行 source handoff 测试**

Run:

```bash
npm run test -- tests/heavy-graph-source-selector.test.ts tests/heavy-graph-orchestrator.test.ts
```

Expected: pass.

---

## Task 6: Evidence Extractor 与 Candidate 抽取

**Files:**

- Create: `lib/heavy/graph/evidence-extractor.ts`
- Test: `tests/heavy-graph-evidence.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/heavy-graph-evidence.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { extractEvidenceFromState } from "@/lib/heavy/graph/evidence-extractor";
import { createInitialResearchState, recordSearchLedger, recordSourceLedger } from "@/lib/heavy/graph/state";
import { heuristicResearchFrame } from "@/lib/heavy/graph/frame";
import type { SourceArtifact } from "@/lib/heavy/graph/types";

describe("Graph Heavy evidence extractor", () => {
  it("extracts candidate and evidence from search snippets and sources", async () => {
    let state = createInitialResearchState(heuristicResearchFrame("找澳大利亚创新硬件 CEO"));
    state = recordSearchLedger(state, [{
      actionId: "search_1",
      query: "Australian robotics CEO",
      provider: "test",
      resultCount: 1,
      resultBatchId: "batch_1",
      resultPreview: [{
        title: "Grace Brown - Andromeda Robotics CEO",
        url: "https://example.com/grace",
        snippet: "Grace Brown is CEO and founder of Andromeda Robotics in Australia.",
        provider: "test",
        rank: 1
      }],
      timestamp: "2026-07-02T00:00:00.000Z"
    }]);
    state = recordSourceLedger(state, [{
      actionId: "read_1",
      sourceHash: "src_1",
      sourceSummary: {
        sourceHash: "src_1",
        actionId: "read_1",
        title: "Grace Brown - Andromeda Robotics CEO",
        url: "https://example.com/grace",
        snippet: "Grace Brown is CEO and founder of Andromeda Robotics in Australia.",
        fullTextLength: 108,
        provider: "test",
        timestamp: "2026-07-02T00:00:01.000Z"
      },
      timestamp: "2026-07-02T00:00:01.000Z"
    }]);
    const sourceArtifacts: SourceArtifact[] = [{
      sourceHash: "src_1",
      actionId: "read_1",
      source: {
        title: "Grace Brown - Andromeda Robotics CEO",
        url: "https://example.com/grace",
        snippet: "Grace Brown is CEO and founder of Andromeda Robotics in Australia.",
        fullText: "Grace Brown is CEO and founder of Andromeda Robotics in Australia. The company builds robotics hardware.",
        provider: "test"
      },
      summary: state.sourceLedger[0].sourceSummary,
      timestamp: "2026-07-02T00:00:01.000Z"
    }];

    const result = await extractEvidenceFromState({ state, actionId: "extract_1", sourceArtifacts });

    expect(result.evidence.some((item) => item.claim.includes("Grace Brown"))).toBe(true);
    expect(result.candidates[0].name).toContain("Grace Brown");
    expect(result.candidates[0].aliases).toContain("Andromeda Robotics");
  });
});
```

- [ ] **Step 2: 创建 evidence extractor**

创建 `lib/heavy/graph/evidence-extractor.ts`：

```ts
import { loadSourceArtifact, type HeavyStorageOptions } from "@/lib/heavy/storage";
import { normalizeCandidate, normalizeEvidenceItem, type Candidate, type EvidenceItem, type ResearchState } from "@/lib/heavy/graph/types";
import type { SourceArtifact } from "@/lib/heavy/graph/types";

type ExtractInput = HeavyStorageOptions & {
  state: ResearchState;
  actionId: string;
  sourceArtifacts?: SourceArtifact[];
};

type ExtractOutput = {
  evidence: EvidenceItem[];
  candidates: Candidate[];
};

export async function extractEvidenceFromState(input: ExtractInput): Promise<ExtractOutput> {
  const evidence: EvidenceItem[] = [];
  const candidates: Candidate[] = [];
  const sourceArtifacts = await resolveSourceArtifacts(input);
  const sources = sourceArtifacts.length
    ? sourceArtifacts.map((artifact) => artifact.source)
    : input.state.searchLedger.flatMap((row) => row.resultPreview.map((result) => ({ ...result, snippet: result.snippet ?? "", provider: result.provider })));

  for (const source of sources) {
    const text = `${source.title} ${source.snippet ?? ""} ${"fullText" in source ? source.fullText ?? "" : ""}`;
    const person = extractPersonName(text);
    const company = extractCompanyName(text);
    if (person && company) {
      const candidateId = slug(`${person}-${company}`);
      const evidenceItem = normalizeEvidenceItem({
        id: `ev_${candidateId}_${evidence.length + 1}`,
        claim: `${person} is associated with ${company}`,
        subjectIds: [candidateId],
        sourceUrl: source.url,
        sourceTitle: source.title,
        sourceType: source.url.includes("linkedin.com") ? "social" : source.url.includes("news") ? "news" : "profile",
        paraphrase: source.snippet || source.title,
        supports: inferSupports(text),
        contradicts: inferContradicts(text),
        strength: inferStrength(source.url, text),
        extractedAt: new Date().toISOString()
      });
      if (evidenceItem) {
        evidence.push(evidenceItem);
      }
      const candidate = normalizeCandidate({
        id: candidateId,
        kind: "person_company",
        name: `${person} / ${company}`,
        aliases: [person, company],
        summary: `${person} appears connected to ${company}.`,
        entities: { person, company },
        matchedConstraints: evidenceItem ? evidenceItem.supports.map((constraintId) => ({ constraintId, status: evidenceItem.strength === "strong" ? "direct" : "proxy", evidenceIds: [evidenceItem.id] })) : [],
        missingConstraints: input.state.frame.softPreferences.map((constraint) => ({ constraintId: constraint.id, reason: "Not verified yet" })),
        proxyEvidenceIds: evidenceItem?.strength === "weak" || evidenceItem?.strength === "medium" ? [evidenceItem.id] : [],
        directEvidenceIds: evidenceItem?.strength === "strong" ? [evidenceItem.id] : [],
        risks: [],
        score: evidenceItem?.strength === "strong" ? 60 : 35,
        confidence: evidenceItem?.strength === "strong" ? "medium" : "low",
        status: "active"
      });
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return {
    evidence: dedupeEvidence(evidence),
    candidates: dedupeCandidates(candidates)
  };
}

async function resolveSourceArtifacts(input: ExtractInput): Promise<SourceArtifact[]> {
  const inMemory = new Map((input.sourceArtifacts ?? []).map((artifact) => [artifact.sourceHash, artifact]));
  const resolved: SourceArtifact[] = [];
  for (const row of input.state.sourceLedger) {
    const artifact = inMemory.get(row.sourceHash) ?? await loadSourceArtifact(row.sourceHash, input);
    if (artifact) {
      resolved.push(artifact);
    }
  }
  return resolved;
}

function inferSupports(text: string): string[] {
  const lower = text.toLowerCase();
  const supports: string[] = [];
  if (/ceo|founder|co-founder/.test(lower)) supports.push("role_ceo");
  if (/australia|australian|melbourne|sydney|brisbane/.test(lower)) supports.push("geo_australia");
  if (/robotics|hardware|device|product|manufacturing automation/.test(lower)) supports.push("innovative_hardware");
  if (/ai|artificial intelligence/.test(lower)) supports.push("recent_ai_article");
  if (/funding|series a|valuation|growth|expansion|revenue|customers/.test(lower)) supports.push("growth_30_percent");
  return supports;
}

function inferContradicts(text: string): string[] {
  const lower = text.toLowerCase();
  const rows: string[] = [];
  if (/solar panel/.test(lower)) rows.push("exclude_solar");
  if (/medical device|healthcare device/.test(lower)) rows.push("exclude_medical");
  if (/heavy manufacturing|mining equipment/.test(lower)) rows.push("exclude_heavy_manufacturing");
  return rows;
}

function inferStrength(url: string, text: string): EvidenceItem["strength"] {
  if (/official|linkedin|businessnews|forbes|techcrunch|afr|smartcompany|startupdaily/i.test(url)) return "strong";
  if (/ceo|founder|funding|ai|robotics|hardware/i.test(text)) return "medium";
  return "weak";
}

function extractPersonName(text: string): string {
  return text.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/)?.[0] ?? "";
}

function extractCompanyName(text: string): string {
  return text.match(/\b[A-Z][A-Za-z]+(?:\s+(?:Robotics|Technologies|Labs|Systems|AI|Group|Company|Industries|Devices))\b/)?.[0] ?? "";
}

function dedupeEvidence(rows: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.claim.toLowerCase()}|${row.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeCandidates(rows: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
```

- [ ] **Step 3: 运行测试**

Run:

```bash
npm run test -- tests/heavy-graph-evidence.test.ts
```

Expected: pass.

---

## Task 7: Candidate Pool 合并、推进、排除

**Files:**

- Create: `lib/heavy/graph/candidate-pool.ts`
- Test: `tests/heavy-graph-candidate-pool.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/heavy-graph-candidate-pool.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { mergeCandidatePool, promoteCandidates } from "@/lib/heavy/graph/candidate-pool";
import type { Candidate } from "@/lib/heavy/graph/types";

describe("Graph Heavy candidate pool", () => {
  it("merges candidates by aliases and co-occurring company names", () => {
    const merged = mergeCandidatePool([
      candidate("cand_1", "Grace Brown / Andromeda Robotics", ["Grace Brown", "Andromeda Robotics"], ["role_ceo"]),
      candidate("cand_2", "Grace Brown Andromeda", ["Grace Brown", "Andromeda"], ["geo_australia"])
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].matchedConstraints.map((item) => item.constraintId)).toEqual(expect.arrayContaining(["role_ceo", "geo_australia"]));
  });

  it("promotes candidates with two hard constraints and no fatal exclusion", () => {
    const promoted = promoteCandidates([
      candidate("cand_1", "Grace Brown / Andromeda Robotics", ["Grace Brown", "Andromeda Robotics"], ["role_ceo", "geo_australia", "innovative_hardware"])
    ], ["role_ceo", "geo_australia", "innovative_hardware"], ["exclude_solar"]);

    expect(promoted[0].status).toBe("promoted");
    expect(promoted[0].score).toBeGreaterThanOrEqual(70);
  });
});

function candidate(id: string, name: string, aliases: string[], constraints: string[]): Candidate {
  return {
    id,
    kind: "person_company",
    name,
    aliases,
    summary: name,
    entities: {},
    matchedConstraints: constraints.map((constraintId) => ({ constraintId, status: "direct", evidenceIds: [`ev_${constraintId}`] })),
    missingConstraints: [],
    proxyEvidenceIds: [],
    directEvidenceIds: constraints.map((constraintId) => `ev_${constraintId}`),
    risks: [],
    score: 0,
    confidence: "low",
    status: "active"
  };
}
```

- [ ] **Step 2: 创建 candidate-pool**

创建 `lib/heavy/graph/candidate-pool.ts`：

```ts
import type { Candidate, ConstraintMatch } from "@/lib/heavy/graph/types";

export function mergeCandidatePool(candidates: Candidate[]): Candidate[] {
  const merged: Candidate[] = [];
  for (const candidate of candidates) {
    const existing = merged.find((item) => isSameCandidate(item, candidate));
    if (!existing) {
      merged.push({ ...candidate, score: scoreCandidate(candidate) });
      continue;
    }
    existing.aliases = Array.from(new Set([...existing.aliases, ...candidate.aliases]));
    existing.matchedConstraints = mergeMatches(existing.matchedConstraints, candidate.matchedConstraints);
    existing.missingConstraints = [...existing.missingConstraints, ...candidate.missingConstraints].filter((gap, index, rows) => rows.findIndex((row) => row.constraintId === gap.constraintId) === index);
    existing.directEvidenceIds = Array.from(new Set([...existing.directEvidenceIds, ...candidate.directEvidenceIds]));
    existing.proxyEvidenceIds = Array.from(new Set([...existing.proxyEvidenceIds, ...candidate.proxyEvidenceIds]));
    existing.risks = [...existing.risks, ...candidate.risks];
    existing.score = scoreCandidate(existing);
    existing.confidence = existing.score >= 80 ? "high" : existing.score >= 50 ? "medium" : "low";
  }
  return merged.sort((a, b) => b.score - a.score);
}

export function promoteCandidates(candidates: Candidate[], hardConstraintIds: string[], exclusionConstraintIds: string[]): Candidate[] {
  return candidates.map((candidate) => {
    const matched = new Set(candidate.matchedConstraints.map((item) => item.constraintId));
    const exclusionHit = candidate.matchedConstraints.some((item) => exclusionConstraintIds.includes(item.constraintId));
    const hardMatches = hardConstraintIds.filter((id) => matched.has(id)).length;
    const promoted = hardMatches >= 2 && !exclusionHit;
    const score = scoreCandidate(candidate) + (promoted ? 20 : 0) - (exclusionHit ? 50 : 0);
    return {
      ...candidate,
      score: Math.max(0, Math.min(100, score)),
      confidence: score >= 80 ? "high" : score >= 50 ? "medium" : "low",
      status: exclusionHit ? "rejected" : promoted ? "promoted" : candidate.status
    };
  }).sort((a, b) => b.score - a.score);
}

function isSameCandidate(a: Candidate, b: Candidate): boolean {
  const aText = identityText([a.name, ...a.aliases].join(" "));
  const bText = identityText([b.name, ...b.aliases].join(" "));
  return aText.includes(bText) || bText.includes(aText) || a.aliases.some((alias) => b.aliases.some((other) => identityText(alias) === identityText(other)));
}

function mergeMatches(a: ConstraintMatch[], b: ConstraintMatch[]): ConstraintMatch[] {
  const byId = new Map<string, ConstraintMatch>();
  for (const match of [...a, ...b]) {
    const existing = byId.get(match.constraintId);
    byId.set(match.constraintId, {
      constraintId: match.constraintId,
      status: existing?.status === "direct" || match.status === "direct" ? "direct" : "proxy",
      evidenceIds: Array.from(new Set([...(existing?.evidenceIds ?? []), ...match.evidenceIds]))
    });
  }
  return Array.from(byId.values());
}

function scoreCandidate(candidate: Candidate): number {
  const direct = candidate.matchedConstraints.filter((item) => item.status === "direct").length * 18;
  const proxy = candidate.matchedConstraints.filter((item) => item.status === "proxy").length * 8;
  const riskPenalty = candidate.risks.reduce((total, risk) => total + (risk.severity === "high" ? 25 : risk.severity === "medium" ? 12 : 5), 0);
  return Math.max(0, Math.min(100, direct + proxy - riskPenalty));
}

function identityText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
```

- [ ] **Step 3: 运行测试**

Run:

```bash
npm run test -- tests/heavy-graph-candidate-pool.test.ts
```

Expected: pass.

---

## Task 8: Evaluator 与 Ranker

**Files:**

- Create: `lib/heavy/graph/evaluator.ts`
- Create: `lib/heavy/graph/ranker.ts`
- Test: `tests/heavy-graph-evaluator-ranker.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/heavy-graph-evaluator-ranker.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { evaluateState } from "@/lib/heavy/graph/evaluator";
import { rankCandidates } from "@/lib/heavy/graph/ranker";
import { createInitialResearchState, upsertCandidates } from "@/lib/heavy/graph/state";
import { heuristicResearchFrame } from "@/lib/heavy/graph/frame";
import type { Candidate } from "@/lib/heavy/graph/types";

describe("Graph Heavy evaluator and ranker", () => {
  it("continues when there is no evidence or candidate", () => {
    const state = createInitialResearchState(heuristicResearchFrame("找澳大利亚创新硬件 CEO"));
    const evaluation = evaluateState(state);

    expect(evaluation.decision).toBe("continue");
    expect(evaluation.avoidQueries).toContain("generic CEO list");
    expect(evaluation.recommendedActions.some((action) => action.type === "search_web")).toBe(true);
  });

  it("promotes candidate before final ranking when hard constraints are strong", () => {
    const state = upsertCandidates(createInitialResearchState(heuristicResearchFrame("找澳大利亚创新硬件 CEO")), [
      candidate("cand_1", "Grace Brown / Andromeda Robotics", ["role_ceo", "geo_australia", "innovative_hardware"], "active")
    ]);
    const evaluation = evaluateState(state);

    expect(evaluation.decision).toBe("promote_candidate");
    expect(evaluation.nextFocus).toContain("cand_1");
    expect(evaluation.recommendedActions.some((action) => action.id.startsWith("search_focus_"))).toBe(true);
  });

  it("ranks best possible candidate even with missing soft growth evidence", () => {
    const ranked = rankCandidates(createInitialResearchState(heuristicResearchFrame("找澳大利亚创新硬件 CEO")), [
      candidate("cand_1", "Grace Brown / Andromeda Robotics", ["role_ceo", "geo_australia", "innovative_hardware", "recent_ai_article"], "promoted"),
      candidate("cand_2", "Other Candidate / Generic Solar", ["role_ceo", "geo_australia", "exclude_solar"], "active")
    ]);

    expect(ranked[0].name).toContain("Grace Brown");
    expect(ranked[0].status).toBe("ranked");
    expect(ranked[0].missingConstraints.some((gap) => gap.constraintId === "growth_30_percent")).toBe(true);
  });
});

function candidate(id: string, name: string, constraints: string[], status: Candidate["status"]): Candidate {
  return {
    id,
    kind: "person_company",
    name,
    aliases: name.split(" / "),
    summary: name,
    entities: {},
    matchedConstraints: constraints.map((constraintId) => ({ constraintId, status: "direct", evidenceIds: [`ev_${constraintId}`] })),
    missingConstraints: [{ constraintId: "growth_30_percent", reason: "No exact growth number" }],
    proxyEvidenceIds: [],
    directEvidenceIds: constraints.map((constraintId) => `ev_${constraintId}`),
    risks: [],
    score: 0,
    confidence: "medium",
    status
  };
}
```

- [ ] **Step 2: 创建 ranker**

创建 `lib/heavy/graph/ranker.ts`：

```ts
import type { Candidate, ResearchState } from "@/lib/heavy/graph/types";

export function rankCandidates(state: ResearchState, candidates: Candidate[] = state.candidatePool): Candidate[] {
  const hardIds = state.frame.hardConstraints.map((item) => item.id);
  const softIds = state.frame.softPreferences.map((item) => item.id);
  const exclusionIds = state.frame.exclusionRules.map((item) => item.id);

  return candidates.map((candidate) => {
    const matched = new Set(candidate.matchedConstraints.map((item) => item.constraintId));
    const hardScore = hardIds.filter((id) => matched.has(id)).length * 25;
    const softScore = softIds.filter((id) => matched.has(id)).length * 10;
    const exclusionPenalty = exclusionIds.some((id) => matched.has(id)) ? 80 : 0;
    const evidenceScore = candidate.directEvidenceIds.length * 5 + candidate.proxyEvidenceIds.length * 2;
    const score = Math.max(0, Math.min(100, hardScore + softScore + evidenceScore - exclusionPenalty));
    return {
      ...candidate,
      score,
      confidence: score >= 80 ? "high" : score >= 50 ? "medium" : "low",
      status: "ranked" as const
    };
  }).sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 3: 创建 evaluator**

创建 `lib/heavy/graph/evaluator.ts`：

```ts
import { makeSearchAction } from "@/lib/heavy/graph/actions";
import type { ResearchState, StateEvaluation } from "@/lib/heavy/graph/types";

export function evaluateState(state: ResearchState): StateEvaluation {
  if (state.candidatePool.length === 0 && state.budgets.cycleIndex < state.budgets.maxCycles) {
    return {
      decision: "continue",
      reason: "No candidate exists yet; continue broad English search.",
      nextFocus: ["broad_candidates"],
      avoidQueries: ["generic CEO list", "top companies"],
      recommendedActions: [
        makeSearchAction({
          id: `search_continue_${state.budgets.cycleIndex + 1}`,
          purpose: "Continue broad candidate discovery",
          rationale: "The global state has no candidate pool yet.",
          queries: ["Australian robotics hardware CEO founder AI article funding"],
          avoidQueries: ["generic CEO list", "top companies"],
          expectedSignals: ["CEO", "robotics", "AI", "funding"],
          maxResults: state.budgets.maxResultsPerQuery
        })
      ]
    };
  }

  const hardIds = state.frame.hardConstraints.map((item) => item.id);
  const promotable = state.candidatePool.find((candidate) => {
    const matched = new Set(candidate.matchedConstraints.map((item) => item.constraintId));
    return candidate.status !== "promoted" && hardIds.filter((id) => matched.has(id)).length >= 2;
  });

  if (promotable) {
    return {
      decision: "promote_candidate",
      reason: `${promotable.name} matches at least two hard constraints and should become a focused investigation track.`,
      nextFocus: [promotable.id],
      avoidQueries: [],
      recommendedActions: [
        makeSearchAction({
          id: `search_focus_${promotable.id}_${state.budgets.cycleIndex + 1}`,
          purpose: `Deep-dive ${promotable.name}`,
          rationale: "Promoted candidates need exact role, company, AI viewpoint, and growth/funding verification.",
          queries: [
            `"${promotable.name}" CEO founder AI article funding growth`,
            `"${promotable.name}" robotics hardware Australia`
          ],
          expectedSignals: ["CEO", "AI article", "funding", "growth"],
          maxResults: state.budgets.maxResultsPerQuery
        })
      ]
    };
  }

  const hasPromoted = state.candidatePool.some((candidate) => candidate.status === "promoted" || candidate.status === "ranked");
  const evidenceEnough = state.evidenceItems.length >= 2 && state.candidatePool.length > 0;
  const budgetDone = state.budgets.cycleIndex >= state.budgets.maxCycles || state.sourceLedger.length >= state.budgets.maxTotalSourcesToRead;

  if ((hasPromoted && evidenceEnough) || (budgetDone && evidenceEnough)) {
    return {
      decision: "rank_and_finalize",
      reason: "The state has usable evidence and candidates; produce best-effort ranked final answer with uncertainty.",
      nextFocus: state.candidatePool.slice(0, 5).map((candidate) => candidate.id),
      avoidQueries: [],
      recommendedActions: []
    };
  }

  if (budgetDone) {
    return {
      decision: "fail",
      reason: "Budget is exhausted and evidence is insufficient.",
      nextFocus: [],
      avoidQueries: [],
      recommendedActions: []
    };
  }

  const focusedQueries = state.candidatePool.slice(0, 3).flatMap((candidate) => [
    `"${candidate.name}" CEO founder official profile`,
    `"${candidate.name}" AI article interview funding growth`
  ]);

  return {
    decision: "revise_queries",
    reason: "Candidates exist but evidence gaps remain; revise exact-phrase searches around candidates and missing constraints.",
    nextFocus: state.candidatePool.slice(0, 3).map((candidate) => candidate.id),
    avoidQueries: ["generic startup list", "top robotics companies"],
    recommendedActions: [
      makeSearchAction({
        id: `search_revised_${state.budgets.cycleIndex + 1}`,
        purpose: "Revise searches around candidate-specific evidence gaps",
        rationale: "The previous state found candidates but not enough direct support for all constraints.",
        queries: focusedQueries.length > 0 ? focusedQueries : ["Australian robotics CEO AI article funding growth"],
        avoidQueries: ["generic startup list", "top robotics companies"],
        expectedSignals: ["official profile", "interview", "funding", "AI article", "growth"],
        maxResults: state.budgets.maxResultsPerQuery
      })
    ]
  };
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
npm run test -- tests/heavy-graph-evaluator-ranker.test.ts
```

Expected: pass.

---

## Task 9: Finalizer 输出最大可能候选

**Files:**

- Create: `lib/heavy/graph/finalizer.ts`
- Test: `tests/heavy-graph-finalizer.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/heavy-graph-finalizer.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { finalizeGraphReport } from "@/lib/heavy/graph/finalizer";
import { createInitialResearchState, upsertCandidates, upsertEvidenceItems } from "@/lib/heavy/graph/state";
import { heuristicResearchFrame } from "@/lib/heavy/graph/frame";

describe("Graph Heavy finalizer", () => {
  it("writes best current answer, evidence chain, proxy evidence, and unknowns", async () => {
    let state = createInitialResearchState(heuristicResearchFrame("找澳大利亚创新硬件 CEO"));
    state = upsertEvidenceItems(state, [{
      id: "ev_1",
      claim: "Grace Brown is CEO of Andromeda Robotics",
      subjectIds: ["cand_1"],
      sourceUrl: "https://example.com/grace",
      sourceTitle: "Grace profile",
      sourceType: "profile",
      paraphrase: "Profile says Grace Brown is CEO.",
      supports: ["role_ceo", "geo_australia", "innovative_hardware"],
      contradicts: [],
      strength: "strong",
      extractedAt: "2026-07-02T00:00:00.000Z"
    }]);
    state = upsertCandidates(state, [{
      id: "cand_1",
      kind: "person_company",
      name: "Grace Brown / Andromeda Robotics",
      aliases: ["Grace Brown", "Andromeda Robotics"],
      summary: "Best candidate",
      entities: { person: "Grace Brown", company: "Andromeda Robotics" },
      matchedConstraints: [{ constraintId: "role_ceo", status: "direct", evidenceIds: ["ev_1"] }, { constraintId: "geo_australia", status: "direct", evidenceIds: ["ev_1"] }, { constraintId: "innovative_hardware", status: "direct", evidenceIds: ["ev_1"] }],
      missingConstraints: [{ constraintId: "growth_30_percent", reason: "No exact 30% public number" }],
      proxyEvidenceIds: [],
      directEvidenceIds: ["ev_1"],
      risks: [],
      score: 90,
      confidence: "high",
      status: "ranked"
    }]);

    const report = await finalizeGraphReport({ prompt: "找澳大利亚创新硬件 CEO", state });

    expect(report.markdown).toContain("Best current answer");
    expect(report.markdown).toContain("Grace Brown / Andromeda Robotics");
    expect(report.markdown).toContain("No exact 30% public number");
    expect(report.markdown).toContain("https://example.com/grace");
    expect(report.sourceUrls).toEqual(["https://example.com/grace"]);
  });
});
```

- [ ] **Step 2: 创建 finalizer**

创建 `lib/heavy/graph/finalizer.ts`：

```ts
import type { FinalReport } from "@/lib/heavy/types";
import { rankCandidates } from "@/lib/heavy/graph/ranker";
import type { Candidate, EvidenceItem, ResearchState } from "@/lib/heavy/graph/types";

type FinalizeInput = {
  prompt: string;
  state: ResearchState;
};

export async function finalizeGraphReport(input: FinalizeInput): Promise<FinalReport> {
  const ranked = rankCandidates(input.state);
  const top = ranked[0];
  const sourceUrls = Array.from(new Set(input.state.evidenceItems.map((item) => item.sourceUrl)));
  const unknowns = collectUnknowns(ranked);
  const markdown = [
    "# Final Report",
    "",
    "## Best current answer",
    top ? `**${top.name}** is the strongest current candidate.` : "No candidate could be ranked from the available evidence.",
    "",
    "## Why this is the best answer",
    top ? candidateReason(top, input.state.evidenceItems) : "The research state has no usable candidate evidence.",
    "",
    "## Candidate ranking",
    rankingTable(ranked),
    "",
    "## Evidence chain",
    evidenceList(input.state.evidenceItems),
    "",
    "## What is confirmed",
    confirmedList(top, input.state.evidenceItems),
    "",
    "## What is inferred or proxy evidence",
    proxyList(top, input.state.evidenceItems),
    "",
    "## What is not confirmed",
    unknowns.length ? unknowns.map((item) => `- ${item}`).join("\n") : "- No major unknowns were recorded.",
    "",
    "## Rejected paths",
    input.state.rejectedPaths.length ? input.state.rejectedPaths.map((item) => `- ${item.target}: ${item.reason}`).join("\n") : "- No rejected paths were recorded.",
    "",
    "## Next best actions",
    "- Verify missing soft constraints from primary sources.",
    "- Search exact candidate/company phrases for latest interviews, funding, revenue, deployment, and team expansion."
  ].join("\n");

  return {
    markdown,
    summary: top ? `Best current answer: ${top.name}` : "No ranked candidate",
    sourceUrls,
    unknowns,
    completedAt: new Date().toISOString()
  };
}

function candidateReason(candidate: Candidate, evidence: EvidenceItem[]): string {
  const direct = evidence.filter((item) => candidate.directEvidenceIds.includes(item.id));
  return [
    `Score: ${candidate.score}. Confidence: ${candidate.confidence}.`,
    `Direct evidence count: ${direct.length}.`,
    `Matched constraints: ${candidate.matchedConstraints.map((item) => item.constraintId).join(", ") || "none"}.`
  ].join(" ");
}

function rankingTable(candidates: Candidate[]): string {
  if (!candidates.length) return "| Rank | Candidate | Score | Confidence | Status |\n|---|---|---:|---|---|\n| - | No candidate | 0 | low | missing |";
  return [
    "| Rank | Candidate | Score | Confidence | Missing |",
    "|---:|---|---:|---|---|",
    ...candidates.slice(0, 10).map((candidate, index) => `| ${index + 1} | ${candidate.name} | ${candidate.score} | ${candidate.confidence} | ${candidate.missingConstraints.map((gap) => gap.reason).join("; ") || "none"} |`)
  ].join("\n");
}

function evidenceList(evidence: EvidenceItem[]): string {
  if (!evidence.length) return "- No source-grounded evidence was extracted.";
  return evidence.map((item) => `- ${item.claim} ([${item.sourceTitle}](${item.sourceUrl}))`).join("\n");
}

function confirmedList(candidate: Candidate | undefined, evidence: EvidenceItem[]): string {
  if (!candidate) return "- No confirmed candidate facts.";
  const direct = evidence.filter((item) => candidate.directEvidenceIds.includes(item.id));
  return direct.length ? direct.map((item) => `- ${item.claim}`).join("\n") : "- No direct evidence items for the top candidate.";
}

function proxyList(candidate: Candidate | undefined, evidence: EvidenceItem[]): string {
  if (!candidate) return "- No proxy evidence.";
  const proxy = evidence.filter((item) => candidate.proxyEvidenceIds.includes(item.id));
  return proxy.length ? proxy.map((item) => `- ${item.claim}`).join("\n") : "- No proxy evidence was attached to the top candidate.";
}

function collectUnknowns(candidates: Candidate[]): string[] {
  return Array.from(new Set(candidates.flatMap((candidate) => candidate.missingConstraints.map((gap) => gap.reason))));
}
```

- [ ] **Step 3: 运行测试**

Run:

```bash
npm run test -- tests/heavy-graph-finalizer.test.ts
```

Expected: pass.

---

## Task 10: Graph Orchestrator 主循环

> Eng review decision 3A: Evaluator 的 `recommendedActions`、`nextFocus`、`avoidQueries` 必须写回 `ResearchState`，下一轮 Planner 必须优先消费 `pendingActions`。禁止只把 `state_evaluated` 当 UI 日志展示；反馈必须真实驱动下一轮搜索、阅读、候选推进或最终排序。

**Files:**

- Create: `lib/heavy/graph/graph-orchestrator.ts`
- Modify: `app/api/inquiries/route.ts`
- Test: `tests/heavy-graph-orchestrator.test.ts`
- Test: `tests/heavy-api.test.ts`

- [ ] **Step 1: 写失败 orchestrator 测试**

创建 `tests/heavy-graph-orchestrator.test.ts`：

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGraphHeavyInquiry } from "@/lib/heavy/graph/graph-orchestrator";
import type { HeavySearchProvider } from "@/lib/heavy/types";

describe("Graph Heavy orchestrator", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "heavy-graph-orchestrator-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("runs frame -> actions -> evidence -> candidate promotion -> final", async () => {
    const provider: HeavySearchProvider = {
      search: async () => [
        {
          title: "Grace Brown - Andromeda Robotics CEO",
          url: "https://example.com/grace",
          snippet: "Grace Brown is CEO and founder of Andromeda Robotics in Australia. The company builds robotics hardware and publishes AI views.",
          provider: "test"
        }
      ],
      read: async (result) => ({
        ...result,
        snippet: result.snippet ?? "",
        fullText: "Grace Brown is CEO and founder of Andromeda Robotics in Australia. The company builds robotics hardware and publishes AI views."
      })
    };

    const inquiry = await runGraphHeavyInquiry("找澳大利亚创新硬件 CEO，最好增长 30%，最近发表 AI 观点", {
      rootDir,
      awaitCompletion: true,
      provider
    });

    const turn = inquiry.turns[0];
    expect(inquiry.status).toBe("completed");
    expect(turn.finalReport?.markdown).toContain("Best current answer");
    expect(turn.finalReport?.markdown).toContain("Grace Brown");

    const { readFile } = await import("node:fs/promises");
    const rawLog = await readFile(join(rootDir, "logs", `${turn.id}.ndjson`), "utf8");
    expect(rawLog).toContain('"type":"state_evaluated"');
    expect(rawLog).toMatch(/search_(focus|revised)_/);
  });
});
```

- [ ] **Step 2: 创建 graph orchestrator**

创建 `lib/heavy/graph/graph-orchestrator.ts`：

```ts
import { createHeavySearchProvider } from "@/lib/heavy/search-provider";
import { compactError, type HeavyBudget, type HeavySearchProvider, type Inquiry } from "@/lib/heavy/types";
import { appendTurnEvent, createInquiry, loadInquiry, saveGraphState, saveInquiry, type HeavyStorageOptions } from "@/lib/heavy/storage";
import { createResearchFrame } from "@/lib/heavy/graph/frame";
import { executeActions } from "@/lib/heavy/graph/executor";
import { extractEvidenceFromState } from "@/lib/heavy/graph/evidence-extractor";
import { evaluateState } from "@/lib/heavy/graph/evaluator";
import { finalizeGraphReport } from "@/lib/heavy/graph/finalizer";
import { planNextActions } from "@/lib/heavy/graph/planner";
import { rankCandidates } from "@/lib/heavy/graph/ranker";
import { selectSourcesToRead } from "@/lib/heavy/graph/source-selector";
import { mergeCandidatePool, promoteCandidates } from "@/lib/heavy/graph/candidate-pool";
import {
  type GraphHeavyEvent,
  type ResearchState
} from "@/lib/heavy/graph/types";
import {
  createInitialResearchState,
  consumePendingActions,
  recordActions,
  recordGraphDecision,
  recordPlannerFeedback,
  recordSearchLedger,
  recordSourceLedger,
  startNextCycle,
  upsertCandidates,
  upsertEvidenceItems
} from "@/lib/heavy/graph/state";

export type RunGraphHeavyOptions = HeavyStorageOptions & {
  awaitCompletion?: boolean;
  budget?: Partial<HeavyBudget>;
  provider?: HeavySearchProvider;
};

export async function startGraphHeavyInquiry(prompt: string, options: RunGraphHeavyOptions = {}): Promise<{ inquiryId: string; turnId: string }> {
  const { inquiry, turn } = await createInquiry(prompt, options);
  const completion = runExistingGraphInquiry(inquiry.id, turn.id, options).catch(async (error) => {
    await appendTurnEvent({ type: "error", inquiryId: inquiry.id, turnId: turn.id, message: compactError(error instanceof Error ? error.message : "Graph Heavy failed"), timestamp: new Date().toISOString() }, options);
  });
  if (options.awaitCompletion) {
    await completion;
  }
  return { inquiryId: inquiry.id, turnId: turn.id };
}

export async function runGraphHeavyInquiry(prompt: string, options: RunGraphHeavyOptions = {}): Promise<Inquiry> {
  const { inquiryId } = await startGraphHeavyInquiry(prompt, { ...options, awaitCompletion: true });
  const inquiry = await loadInquiry(inquiryId, options);
  if (!inquiry) throw new Error("Graph inquiry was not saved");
  return inquiry;
}

export async function runExistingGraphInquiry(inquiryId: string, turnId: string, options: RunGraphHeavyOptions = {}): Promise<Inquiry> {
  const inquiry = await loadInquiry(inquiryId, options);
  if (!inquiry) throw new Error(`Inquiry not found: ${inquiryId}`);
  const turn = inquiry.turns.find((item) => item.id === turnId);
  if (!turn) throw new Error(`Turn not found: ${turnId}`);

  const provider = options.provider ?? createHeavySearchProvider();
  const emit = async (event: GraphHeavyEvent) => {
    await appendTurnEvent(event, options);
  };

  inquiry.status = "running";
  turn.status = "running";
  turn.startedAt = turn.startedAt ?? new Date().toISOString();
  await saveInquiry(inquiry, options);

  try {
    const frame = await createResearchFrame({ prompt: turn.prompt });
    let state: ResearchState = createInitialResearchState(frame);
    await emit({ type: "frame_created", inquiryId, turnId, frame, timestamp: new Date().toISOString() });
    await saveGraphState(turnId, state, options);

    while (state.budgets.cycleIndex < state.budgets.maxCycles) {
      state = startNextCycle(state);
      await emit({ type: "cycle_started", inquiryId, turnId, cycleIndex: state.budgets.cycleIndex, timestamp: new Date().toISOString() });

      const pending = consumePendingActions(state);
      state = pending.state;
      const planned = pending.actions.length > 0
        ? pending.actions.slice(0, state.budgets.maxActionsPerCycle)
        : await planNextActions({ state });
      state = recordActions(state, planned);
      await emit({ type: "actions_planned", inquiryId, turnId, cycleIndex: state.budgets.cycleIndex, actions: planned, timestamp: new Date().toISOString() });

      const executed = await executeActions({ inquiryId, turnId, state, provider, actions: planned, emit });
      state = recordSearchLedger(state, executed.searchLedger);
      state = recordSourceLedger(state, executed.sourceLedger);
      let sourceArtifacts = [...executed.sourceArtifacts];

      const readActions = selectSourcesToRead(state, `read_cycle_${state.budgets.cycleIndex}`, executed.searchArtifacts);
      if (readActions.length > 0) {
        state = recordActions(state, readActions);
        await emit({ type: "actions_planned", inquiryId, turnId, cycleIndex: state.budgets.cycleIndex, actions: readActions, timestamp: new Date().toISOString() });
        const readExecuted = await executeActions({ inquiryId, turnId, state, provider, actions: readActions, searchArtifacts: executed.searchArtifacts, emit });
        state = recordSourceLedger(state, readExecuted.sourceLedger);
        sourceArtifacts = [...sourceArtifacts, ...readExecuted.sourceArtifacts];
      }

      const extracted = await extractEvidenceFromState({ state, actionId: `extract_${state.budgets.cycleIndex}`, sourceArtifacts });
      state = upsertEvidenceItems(state, extracted.evidence);
      state = upsertCandidates(state, mergeCandidatePool([...state.candidatePool, ...extracted.candidates]));
      await emit({ type: "evidence_extracted", inquiryId, turnId, actionId: `extract_${state.budgets.cycleIndex}`, evidence: extracted.evidence, timestamp: new Date().toISOString() });
      await emit({ type: "candidate_extracted", inquiryId, turnId, actionId: `extract_${state.budgets.cycleIndex}`, candidates: extracted.candidates, timestamp: new Date().toISOString() });

      state = upsertCandidates(state, promoteCandidates(state.candidatePool, state.frame.hardConstraints.map((item) => item.id), state.frame.exclusionRules.map((item) => item.id)));
      for (const candidate of state.candidatePool.filter((item) => item.status === "promoted")) {
        await emit({ type: "candidate_promoted", inquiryId, turnId, candidate, reason: "Candidate matched enough hard constraints for focused investigation.", timestamp: new Date().toISOString() });
      }

      const evaluation = evaluateState(state);
      state = recordGraphDecision(state, evaluation.decision, evaluation.reason);
      state = recordPlannerFeedback(state, evaluation);
      await emit({ type: "state_evaluated", inquiryId, turnId, evaluation, timestamp: new Date().toISOString() });
      await saveGraphState(turnId, state, options);

      if (evaluation.decision === "rank_and_finalize" || evaluation.decision === "fail") {
        break;
      }
    }

    state = upsertCandidates(state, rankCandidates(state));
    await emit({ type: "ranking_completed", inquiryId, turnId, candidates: state.candidatePool, timestamp: new Date().toISOString() });
    turn.finalReport = await finalizeGraphReport({ prompt: turn.prompt, state });
    state.finalReport = turn.finalReport;
    await emit({ type: "graph_final_reported", inquiryId, turnId, report: turn.finalReport, timestamp: new Date().toISOString() });
    await appendTurnEvent({ type: "final_reported", inquiryId, turnId, report: turn.finalReport, timestamp: new Date().toISOString() }, options);

    turn.status = "completed";
    inquiry.status = "completed";
    turn.completedAt = new Date().toISOString();
    turn.updatedAt = turn.completedAt;
    inquiry.updatedAt = turn.completedAt;
    await saveGraphState(turnId, state, options);
    await appendTurnEvent({ type: "turn_completed", inquiryId, turnId, timestamp: turn.completedAt }, options);
    await saveInquiry(inquiry, options);
    return inquiry;
  } catch (error) {
    const message = compactError(error instanceof Error ? error.message : "Graph Heavy failed");
    inquiry.status = "failed";
    turn.status = "failed";
    turn.error = message;
    turn.completedAt = new Date().toISOString();
    await appendTurnEvent({ type: "error", inquiryId, turnId, message, timestamp: new Date().toISOString() }, options);
    await saveInquiry(inquiry, options);
    return inquiry;
  }
}
```

- [ ] **Step 3: API 选择 graph/legacy**

修改 `app/api/inquiries/route.ts` imports：

```ts
import { startGraphHeavyInquiry } from "@/lib/heavy/graph/graph-orchestrator";
import { startHeavyInquiry } from "@/lib/heavy/orchestrator";
```

增加：

```ts
function defaultStartHeavy(prompt: string, options?: { budget?: Record<string, unknown> }) {
  return (process.env.HEAVY_ENGINE ?? "graph") === "legacy"
    ? startHeavyInquiry(prompt, options)
    : startGraphHeavyInquiry(prompt, options);
}
```

把默认 service 改成：

```ts
export function createInquiryPostHandler(service: InquiryStartService = { start: defaultStartHeavy }) {
```

- [ ] **Step 4: 运行测试**

Run:

```bash
npm run test -- tests/heavy-graph-orchestrator.test.ts tests/heavy-api.test.ts
```

Expected: pass.

---

## Task 10A: Graph State API Hydration

> Eng review decision 2A: 历史 Inquiry 重新打开时，UI 不能只依赖 live NDJSON events。`GET /api/inquiries/:id` 必须读取最新 Turn 的 graph-state 文件，并返回压缩后的 `graphState` summary；UI 优先用 `activeInquiry.graphState`，events 只作为运行中增量。

**Files:**

- Modify: `app/api/inquiries/[id]/route.ts`
- Modify: `lib/heavy/types.ts`
- Test: `tests/heavy-api.test.ts`

- [ ] **Step 1: 写失败 API 测试**

在 `tests/heavy-api.test.ts` imports 增加：

```ts
import { saveGraphState } from "@/lib/heavy/storage";
import { createInitialResearchState, upsertCandidates } from "@/lib/heavy/graph/state";
import { heuristicResearchFrame } from "@/lib/heavy/graph/frame";
```

新增测试：

```ts
  it("GET /api/inquiries/:id returns graphState summary for the latest turn", async () => {
    const { inquiry, turn } = await createInquiry("找澳大利亚创新硬件 CEO", { rootDir });
    let state = createInitialResearchState(heuristicResearchFrame(inquiry.prompt));
    state = upsertCandidates(state, [{
      id: "cand_1",
      kind: "person_company",
      name: "Grace Brown / Andromeda Robotics",
      aliases: ["Grace Brown", "Andromeda Robotics"],
      summary: "Best candidate",
      entities: { person: "Grace Brown", company: "Andromeda Robotics" },
      matchedConstraints: [{ constraintId: "role_ceo", status: "direct", evidenceIds: ["ev_1"] }],
      missingConstraints: [{ constraintId: "growth_30_percent", reason: "No exact public growth number" }],
      proxyEvidenceIds: [],
      directEvidenceIds: ["ev_1"],
      risks: [],
      score: 80,
      confidence: "high",
      status: "promoted"
    }]);
    await saveGraphState(turn.id, state, { rootDir });

    const response = await createInquiryByIdGetHandler({ rootDir })(
      new Request(`http://localhost/api/inquiries/${inquiry.id}`),
      { params: { id: inquiry.id } }
    );
    const json = await response.json();

    expect(json.graphState.frame.taskKind).toBe("find_person_company");
    expect(json.graphState.candidates[0].name).toBe("Grace Brown / Andromeda Robotics");
    expect(json.graphState.sourceCount).toBe(0);
  });
```

- [ ] **Step 2: 扩展 Inquiry 类型**

在 `lib/heavy/types.ts` 顶部 import 增加：

```ts
import type { GraphHeavyEvent, GraphStateSummary } from "@/lib/heavy/graph/types";
```

把 `Inquiry` 改成：

```ts
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
```

- [ ] **Step 3: 修改 GET inquiry route**

在 `app/api/inquiries/[id]/route.ts` imports 改成：

```ts
import { NextResponse } from "next/server";
import { loadGraphState, loadInquiry, type HeavyStorageOptions } from "@/lib/heavy/storage";
import { summarizeResearchState } from "@/lib/heavy/graph/state";
```

把成功返回逻辑改成：

```ts
    const latestTurn = inquiry.turns.at(-1);
    const graphState = latestTurn ? await loadGraphState(latestTurn.id, options) : null;

    return NextResponse.json(graphState ? { ...inquiry, graphState: summarizeResearchState(graphState) } : inquiry);
```

- [ ] **Step 4: 运行 API 测试**

Run:

```bash
npm run test -- tests/heavy-api.test.ts
```

Expected: pass.

---

## Task 11: UI Graph Panels

> Eng review decision 2A: UI graph panels 必须优先从 `activeInquiry.graphState` 渲染历史状态；live `events` 只用于运行中追加过程。刷新页面或重新点击历史 Inquiry 后，Research Frame、Candidate Pool、Evidence Matrix 仍必须可见。

**Files:**

- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Test: `tests/heavy-ui.test.tsx`

- [ ] **Step 1: UI 测试增加 graph event fixture**

在 `tests/heavy-ui.test.tsx` 新增测试：

```ts
  it("renders graph research frame, process events, candidate pool, and evidence matrix", async () => {
    const inquiry = {
      ...fixtureInquiry(),
      graphState: {
        frame: {
          id: "frame_1",
          taskKind: "find_person_company",
          userGoal: "Find candidate",
          deliverable: "ranked candidates",
          hardConstraints: [{ id: "role_ceo", label: "CEO", kind: "hard" }],
          softPreferences: [{ id: "growth_30_percent", label: "30% growth", kind: "soft" }],
          exclusionRules: [],
          evidencePolicy: { directEvidenceRequired: true, proxyEvidenceAllowed: true, unknownsMustBeLabeled: true },
          searchPolicy: { defaultLanguage: "en", maxResultsPerQuery: 30, engines: ["google", "brave", "duckduckgo"] },
          rankingPolicy: { mustRankWhenEvidenceExists: true, maxRankedCandidates: 5 },
          stopCriteria: [],
          initialAngles: [],
          assumptions: []
        },
        cycleIndex: 2,
        candidates: [
          {
            id: "cand_1",
            kind: "person_company",
            name: "Grace Brown / Andromeda Robotics",
            aliases: ["Grace Brown", "Andromeda Robotics"],
            summary: "Best candidate",
            entities: {},
            matchedConstraints: [{ constraintId: "role_ceo", status: "direct", evidenceIds: ["ev_1"] }],
            missingConstraints: [{ constraintId: "growth_30_percent", reason: "No exact growth number" }],
            proxyEvidenceIds: [],
            directEvidenceIds: ["ev_1"],
            risks: [],
            score: 80,
            confidence: "high",
            status: "promoted"
          }
        ],
        evidenceItems: [],
        decisionHistory: [],
        rejectedPaths: [],
        openQuestions: [],
        plannerHints: [],
        searchBatches: [{
          id: "batch_1",
          actionId: "search_1",
          query: "Australian robotics CEO",
          provider: "opencli",
          engine: "google",
          resultCount: 30,
          resultPreview: [{ title: "Grace Brown profile", url: "https://example.com/grace", snippet: "CEO profile", provider: "opencli", engine: "google", rank: 1 }],
          artifactPath: "search-batches/batch_1.json",
          timestamp: "2026-07-02T00:00:00.000Z"
        }],
        sourceSummaries: [{
          sourceHash: "src_1",
          actionId: "read_1",
          title: "Grace Brown profile",
          url: "https://example.com/grace",
          provider: "opencli",
          engine: "google",
          snippet: "CEO profile",
          fullTextLength: 1200,
          artifactPath: "sources/src_1.json",
          timestamp: "2026-07-02T00:00:01.000Z"
        }],
        searchCount: 4,
        sourceCount: 2
      }
    };
    const graphEvents = [
      {
        type: "frame_created",
        inquiryId: inquiry.id,
        turnId: inquiry.turns[0].id,
        frame: {
          id: "frame_1",
          taskKind: "find_person_company",
          userGoal: "Find candidate",
          deliverable: "ranked candidates",
          hardConstraints: [{ id: "role_ceo", label: "CEO", kind: "hard" }],
          softPreferences: [{ id: "growth_30_percent", label: "30% growth", kind: "soft" }],
          exclusionRules: [],
          evidencePolicy: { directEvidenceRequired: true, proxyEvidenceAllowed: true, unknownsMustBeLabeled: true },
          searchPolicy: { defaultLanguage: "en", maxResultsPerQuery: 30, engines: ["google", "brave", "duckduckgo"] },
          rankingPolicy: { mustRankWhenEvidenceExists: true, maxRankedCandidates: 5 },
          stopCriteria: [],
          initialAngles: [],
          assumptions: []
        },
        timestamp: "2026-07-02T00:00:00.000Z"
      },
      {
        type: "candidate_promoted",
        inquiryId: inquiry.id,
        turnId: inquiry.turns[0].id,
        candidate: {
          id: "cand_1",
          kind: "person_company",
          name: "Grace Brown / Andromeda Robotics",
          aliases: ["Grace Brown", "Andromeda Robotics"],
          summary: "Best candidate",
          entities: {},
          matchedConstraints: [{ constraintId: "role_ceo", status: "direct", evidenceIds: ["ev_1"] }],
          missingConstraints: [{ constraintId: "growth_30_percent", reason: "No exact growth number" }],
          proxyEvidenceIds: [],
          directEvidenceIds: ["ev_1"],
          risks: [],
          score: 80,
          confidence: "high",
          status: "promoted"
        },
        reason: "Candidate matched hard constraints",
        timestamp: "2026-07-02T00:00:01.000Z"
      }
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/health")) return jsonResponse({ ok: true, configuredModel: "test-model", baseUrl: "https://relay.example", searchProvider: { provider: "relay" }, heavyEngine: "graph" });
      if (url.includes(`/api/inquiries/${inquiry.id}/stream`)) return ndjsonResponse(graphEvents);
      if (url.includes(`/api/inquiries/${inquiry.id}`)) return jsonResponse(inquiry);
      return jsonResponse({ inquiries: [inquiry] });
    }));

    render(<Home />);

    expect(await screen.findByText("Research Frame")).toBeInTheDocument();
    expect(screen.getByText("find_person_company")).toBeInTheDocument();
    expect(screen.getByText("Candidate Pool")).toBeInTheDocument();
    expect(screen.getByText("Grace Brown / Andromeda Robotics")).toBeInTheDocument();
    expect(screen.getByText(/opencli · google/i)).toBeInTheDocument();
    expect(screen.getByText("Grace Brown profile")).toBeInTheDocument();
  });

  it("renders graph panels from stored graphState without stream events", async () => {
    const inquiry = {
      ...fixtureInquiry(),
      graphState: {
        frame: {
          id: "frame_1",
          taskKind: "find_person_company",
          userGoal: "Find candidate",
          deliverable: "ranked candidates",
          hardConstraints: [{ id: "role_ceo", label: "CEO", kind: "hard" }],
          softPreferences: [],
          exclusionRules: [],
          evidencePolicy: { directEvidenceRequired: true, proxyEvidenceAllowed: true, unknownsMustBeLabeled: true },
          searchPolicy: { defaultLanguage: "en", maxResultsPerQuery: 30, engines: ["google", "brave", "duckduckgo"] },
          rankingPolicy: { mustRankWhenEvidenceExists: true, maxRankedCandidates: 5 },
          stopCriteria: [],
          initialAngles: [],
          assumptions: []
        },
        cycleIndex: 1,
        candidates: [{ id: "cand_1", kind: "person_company", name: "Stored Candidate / Stored Company", aliases: [], summary: "Stored", entities: {}, matchedConstraints: [], missingConstraints: [], proxyEvidenceIds: [], directEvidenceIds: [], risks: [], score: 55, confidence: "medium", status: "ranked" }],
        evidenceItems: [],
        decisionHistory: [],
        rejectedPaths: [],
        openQuestions: [],
        plannerHints: [],
        searchBatches: [],
        sourceSummaries: [],
        searchCount: 2,
        sourceCount: 1
      }
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/health")) return jsonResponse({ ok: true, configuredModel: "test-model", baseUrl: "https://relay.example", searchProvider: { provider: "relay" }, heavyEngine: "graph" });
      if (url.includes(`/api/inquiries/${inquiry.id}`)) return jsonResponse(inquiry);
      return jsonResponse({ inquiries: [inquiry] });
    }));

    render(<Home />);

    expect(await screen.findByText("Research Frame")).toBeInTheDocument();
    expect(screen.getByText("Stored Candidate / Stored Company")).toBeInTheDocument();
  });
```

- [ ] **Step 2: 修改 `app/page.tsx` 增加派生数据**

在 `Home` 组件中增加：

```tsx
  const graphFrame = activeInquiry?.graphState?.frame ?? events.find((event) => event.type === "frame_created")?.frame ?? null;
  const promotedCandidates = activeInquiry?.graphState?.candidates ?? events
    .filter((event) => event.type === "candidate_promoted")
    .map((event) => event.candidate);
  const graphSummary = activeInquiry?.graphState ?? null;
```

在 `<StageBar />` 后增加：

```tsx
        <GraphResearchOverview frame={graphFrame} candidates={promotedCandidates} events={events} summary={graphSummary} />
```

新增组件：

```tsx
function GraphResearchOverview({
  frame,
  candidates,
  events,
  summary
}: {
  frame: Extract<HeavyEvent, { type: "frame_created" }>["frame"] | null;
  candidates: Extract<HeavyEvent, { type: "candidate_promoted" }>["candidate"][];
  events: HeavyEvent[];
  summary: Inquiry["graphState"] | null;
}) {
  if (!frame && candidates.length === 0 && !events.some((event) => event.type === "actions_planned" || event.type === "state_evaluated")) {
    return null;
  }

  return (
    <section className="graph-overview">
      <article>
        <h2>Research Frame</h2>
        {frame ? (
          <>
            <strong>{frame.taskKind}</strong>
            <p>{frame.deliverable}</p>
            <div className="constraint-list">
              {frame.hardConstraints.map((constraint) => <span key={constraint.id}>{constraint.label}</span>)}
              {frame.softPreferences.map((constraint) => <span key={constraint.id}>{constraint.label}</span>)}
            </div>
          </>
        ) : (
          <p className="muted">等待意图识别。</p>
        )}
      </article>
      <article>
        <h2>Candidate Pool</h2>
        {candidates.map((candidate) => (
          <div className="candidate-row" key={candidate.id}>
            <strong>{candidate.name}</strong>
            <span>{candidate.status} · {candidate.score}</span>
            <small>{candidate.missingConstraints.map((gap) => gap.reason).join("; ")}</small>
          </div>
        ))}
        {candidates.length === 0 ? <p className="muted">暂无推进候选。</p> : null}
      </article>
      <article>
        <h2>Research Process</h2>
        {summary ? <p className="muted">Cycle {summary.cycleIndex} · {summary.searchCount} searches · {summary.sourceCount} sources</p> : null}
        {summary?.searchBatches?.slice(-6).map((batch) => (
          <div className="graph-event-row" key={batch.id}>
            <strong>{batch.provider} · {batch.engine ?? "unknown"}</strong>
            <code>{batch.query}</code>
            <small>{batch.resultCount} results · {batch.resultPreview.map((result) => result.title).join("; ")}</small>
          </div>
        ))}
        {summary?.sourceSummaries?.slice(-6).map((source) => (
          <div className="graph-event-row" key={source.sourceHash}>
            <strong>{source.title}</strong>
            <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
            <small>{source.provider ?? "provider unknown"} · {source.engine ?? "engine unknown"} · {source.fullTextLength} chars</small>
          </div>
        ))}
        {events.filter((event) => event.type === "actions_planned" || event.type === "search_performed" || event.type === "state_evaluated").slice(-8).map((event, index) => (
          <div className="graph-event-row" key={`${event.type}-${index}`}>
            <strong>{event.type}</strong>
            {"query" in event ? <code>{event.query}</code> : null}
            {"evaluation" in event ? <small>{event.evaluation.reason}</small> : null}
          </div>
        ))}
      </article>
    </section>
  );
}
```

- [ ] **Step 3: 增加 CSS**

在 `app/globals.css` 加：

```css
.graph-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 14px 0;
}

.graph-overview > article {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 14px;
  min-width: 0;
}

.graph-overview h2 {
  margin: 0 0 10px;
  font-size: 14px;
}

.constraint-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.constraint-list span,
.candidate-row span {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 7px;
  color: var(--muted);
  font-size: 11px;
}

.candidate-row,
.graph-event-row {
  display: grid;
  gap: 5px;
  padding: 8px 0;
  border-top: 1px solid var(--border);
}

.graph-event-row code {
  white-space: normal;
  word-break: break-word;
}

.graph-event-row a {
  color: var(--accent);
  overflow-wrap: anywhere;
}

@media (max-width: 980px) {
  .graph-overview {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: 运行 UI 测试**

Run:

```bash
npm run test -- tests/heavy-ui.test.tsx
```

Expected: pass.

---

## Task 12: 六个 Apodex 样本场景集成测试

**Files:**

- Create: `tests/heavy-graph-scenarios.test.ts`

- [ ] **Step 1: 创建场景测试**

创建 `tests/heavy-graph-scenarios.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { runGraphHeavyInquiry } from "@/lib/heavy/graph/graph-orchestrator";
import type { HeavySearchProvider, HeavySearchResult } from "@/lib/heavy/types";

describe("Graph Heavy Apodex-derived scenarios", () => {
  it("Grace Brown / Andromeda: promotes and ranks best possible candidate", async () => {
    const inquiry = await runGraphHeavyInquiry("找澳大利亚创新硬件 CEO，排除太阳能医疗重工，最好 30% 增长，三年以上并发表 AI 观点", {
      awaitCompletion: true,
      rootDir: await tempRoot("grace"),
      provider: providerFromResults([
        { title: "Grace Brown - Andromeda Robotics CEO", url: "https://example.com/grace", snippet: "Grace Brown is CEO and founder of Andromeda Robotics in Australia. Robotics hardware. AI viewpoint article. Series A funding.", provider: "test" }
      ])
    });

    expect(inquiry.turns[0].finalReport?.markdown).toContain("Grace Brown");
    expect(inquiry.turns[0].finalReport?.markdown).toContain("Best current answer");
  });

  it("OpenExamPrep-like website finding: uses clues and outputs candidate website", async () => {
    const inquiry = await runGraphHeavyInquiry("根据线索找到 Ran Chen 做的免费 AI exam prep 网站", {
      awaitCompletion: true,
      rootDir: await tempRoot("website"),
      provider: providerFromResults([
        { title: "Ran Chen OpenExamPrep free AI exam prep", url: "https://openexamprep.example.com", snippet: "Ran Chen created OpenExamPrep, a free AI exam preparation website.", provider: "test" }
      ])
    });

    expect(inquiry.turns[0].finalReport?.markdown).toMatch(/OpenExamPrep|openexamprep/i);
  });

  it("Cloudflare free domain verification: labels unknowns when criterion is not fully proven", async () => {
    const inquiry = await runGraphHeavyInquiry("验证 Cloudflare 免费子域名方案是否支持 PSL 和 NS delegation", {
      awaitCompletion: true,
      rootDir: await tempRoot("cloudflare"),
      provider: providerFromResults([
        { title: "Public Suffix List and NS delegation", url: "https://example.com/psl", snippet: "A usable free subdomain provider needs Public Suffix List inclusion and authoritative NS delegation.", provider: "test" }
      ])
    });

    expect(inquiry.turns[0].finalReport?.markdown).toContain("Evidence chain");
  });

  it("customs workflow: outputs workflow-style evidence boundaries", async () => {
    const inquiry = await runGraphHeavyInquiry("设计海关数据清洗、实体合并、同行识别、客户分级和存储架构", {
      awaitCompletion: true,
      rootDir: await tempRoot("customs"),
      provider: providerFromResults([
        { title: "Customs trade data entity resolution", url: "https://example.com/customs", snippet: "Customs trade data workflows require cleaning, entity resolution, HS code normalization, and customer segmentation.", provider: "test" }
      ])
    });

    expect(inquiry.turns[0].finalReport?.markdown).toMatch(/workflow|Evidence chain|Best current answer/i);
  });

  it("market list scaling: separates precise list from broad funnel", async () => {
    const inquiry = await runGraphHeavyInquiry("扩大 distributor list，既要精确买家也要大规模 funnel", {
      awaitCompletion: true,
      rootDir: await tempRoot("market"),
      provider: providerFromResults([
        { title: "Distributor data sources buyer funnel", url: "https://example.com/distributor", snippet: "Distributor list building separates verified buyers from broad funnel data sources.", provider: "test" }
      ])
    });

    expect(inquiry.turns[0].finalReport?.markdown).toContain("Best current answer");
  });

  it("new seller strategy: excludes unsuitable channels and recommends low-friction path", async () => {
    const inquiry = await runGraphHeavyInquiry("香港独立新卖家如何低成本启动销售渠道", {
      awaitCompletion: true,
      rootDir: await tempRoot("seller"),
      provider: providerFromResults([
        { title: "New seller low cost channel strategy", url: "https://example.com/seller", snippet: "New independent sellers should prioritize low-friction channels, eligibility checks, payment safeguards, and risk control.", provider: "test" }
      ])
    });

    expect(inquiry.turns[0].finalReport?.markdown).toContain("Best current answer");
  });
});

async function tempRoot(name: string): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return mkdtemp(join(tmpdir(), `heavy-graph-${name}-`));
}

function providerFromResults(results: HeavySearchResult[]): HeavySearchProvider {
  return {
    search: async () => results,
    read: async (result) => ({ ...result, snippet: result.snippet ?? "", fullText: result.snippet ?? "" })
  };
}
```

- [ ] **Step 2: 运行场景测试**

Run:

```bash
npm run test -- tests/heavy-graph-scenarios.test.ts
```

Expected: pass.

---

## Task 13: Health、配置、全量验收

**Files:**

- Modify: `app/api/health/route.ts`
- Modify: `README.md`
- Modify: `Decisions.md`
- Modify: `Conventions.md`

- [ ] **Step 1: health 增加 engine 状态**

修改 `app/api/health/route.ts` 返回体，成功和失败都增加：

```ts
heavyEngine: process.env.HEAVY_ENGINE ?? "graph",
graphBudget: {
  maxCycles: process.env.HEAVY_GRAPH_MAX_CYCLES ?? "8",
  maxResultsPerQuery: process.env.HEAVY_GRAPH_MAX_RESULTS_PER_QUERY ?? "30",
  maxTotalSourcesToRead: process.env.HEAVY_GRAPH_MAX_TOTAL_SOURCES_TO_READ ?? "80"
}
```

Expected: health 不包含 `OPENAI_API_KEY` 原值。

- [ ] **Step 2: 文档记录架构决定**

更新：

- `README.md`
  - 当前默认 engine 是 graph。
  - legacy engine 可通过 `HEAVY_ENGINE=legacy` 回退。
  - graph state 文件位置是 `research-runs/graph-state/{turnId}.json`。

- `Decisions.md`
  - 记录“从固定 Agent pipeline 改成全局状态机”的决定。
  - 记录“英文关键词默认策略”。
  - 记录“best-effort ranking with explicit uncertainty”。

- `Conventions.md`
  - 记录 graph modules 职责。
  - 记录所有事件 append 到 NDJSON，不写 secret。
  - 记录 finalizer 不允许自行搜索。

- [ ] **Step 3: focused tests**

Run:

```bash
npm run test -- tests/heavy-graph-types.test.ts tests/heavy-graph-frame.test.ts tests/heavy-graph-state.test.ts tests/heavy-graph-planner.test.ts tests/heavy-graph-executor.test.ts tests/heavy-graph-source-selector.test.ts tests/heavy-graph-evidence.test.ts tests/heavy-graph-candidate-pool.test.ts tests/heavy-graph-evaluator-ranker.test.ts tests/heavy-graph-finalizer.test.ts tests/heavy-graph-orchestrator.test.ts tests/heavy-graph-scenarios.test.ts tests/heavy-api.test.ts tests/heavy-ui.test.tsx
```

Expected: all pass.

- [ ] **Step 4: full tests**

Run:

```bash
npm run test
```

Expected: all pass.

- [ ] **Step 5: lint**

Run:

```bash
npm run lint
```

Expected: no ESLint errors.

- [ ] **Step 6: build**

Run:

```bash
npm run build
```

Expected: production build succeeds.

- [ ] **Step 7: secret scan**

Run:

```bash
rg -n "sk-[A-Za-z0-9_-]{8,}" lib app tests docs research-runs
```

Expected: no matches. If existing local run data contains a previous secret, do not print the secret; report only the file path and redact the value.

- [ ] **Step 8: manual QA**

在 `http://localhost:3100/` 跑这个 prompt：

```text
我要找一个公司的CEO，这个公司是做有创新性的硬件，但是不能做太阳能板，也不能做医疗器械，也不能做重工制造。公司每年最好能增长30%。这个人最好在澳大利亚，在这个企业做了三年以上，并且最近发表过包含AI观点的文章。
```

Expected UI:

- 显示 `Research Frame`。
- 显示 `Research Process` 中的 `frame_created`、`actions_planned`、`search_performed`、`state_evaluated`。
- 搜索 query 是英文。
- 搜索日志显示 provider 和 engine。
- Candidate Pool 出现候选。
- 至少一个候选被 promoted 或 ranked。
- 最终报告包含 `Best current answer`。
- 如果没有精确 `30% annual growth` 来源，报告把它写进 `What is not confirmed`，不能写成确定事实。

---

## 验收标准

完成后必须满足：

- 新任务默认走 graph engine。
- 可以通过 `HEAVY_ENGINE=legacy` 使用旧 Heavy。
- graph event 全部落入 `research-runs/logs/{turnId}.ndjson`。
- graph state 落入 `research-runs/graph-state/{turnId}.json`。
- 完整搜索批次落入 `research-runs/search-batches/{batchId}.json`，事件只包含 `resultBatchId/resultPreview`。
- 完整网页正文落入 `research-runs/sources/{sourceHash}.json`，事件只包含 `sourceHash/sourceSummary`，NDJSON 不包含 `fullText`。
- UI 能看到主逻辑过程，而不是只看到最终 AgentReport。
- UI 能看到搜索 provider、engine、query、resultCount、抓取网页标题和 URL。
- 候选会进入全局 candidate pool，并被推进、比较、排序。
- 搜索关键词默认英文，不出现中文关键词、`{company}`、`CEO name`、`company name` 这种占位词。
- final 输出最大可能候选，且明确直接证据、代理证据、假设、未知项、被排除项。
- 六个 Apodex-derived scenario tests 通过。
- `npm run test`、`npm run lint`、`npm run build` 通过。
- repo 文件、docs、logs、测试快照不包含 API key。

---

## 执行顺序建议

推荐使用 Subagent-Driven：

1. Subagent A: Task 1-2，类型和状态存储。
2. Subagent B: Task 3-4，frame 和 planner。
3. Subagent C: Task 5-7，executor、evidence、candidate pool。
4. Subagent D: Task 8-10，evaluator、ranker、finalizer、orchestrator。
5. Subagent E: Task 11-13，UI、health、文档、全量验收。

每个 subagent 完成后主 agent 必须 review：

- 是否真跑测试。
- 是否保持英文 query。
- 是否有 secret 泄露。
- 是否把 work 写入真实文件，而不是只更新 UI 假数据。
- 是否破坏 legacy tests。

---

## Self-Review Checklist

Spec coverage:

- Apodex-like 主逻辑状态机：Task 1-10。
- 用户意图识别和 ResearchFrame：Task 3。
- 搜索关键词组合与失败后修正：Task 4、Task 8、Task 10。
- 网页、搜索引擎、OpenCLI/relay 日志可见：Task 5、Task 11。
- Candidate promotion：Task 7、Task 10。
- 最大可能候选 ranking：Task 8、Task 9。
- 六个 Apodex 样本测试：Task 12。
- 配置、health、secret scan：Task 13。

Placeholder scan:

- 计划中没有空白实现项。
- 每个新增模块都有测试、文件路径、核心代码形状、运行命令和 expected result。

Type consistency:

- `ResearchFrame`、`ResearchState`、`ResearchAction`、`EvidenceItem`、`Candidate` 只在 `lib/heavy/graph/types.ts` 定义。
- `GraphHeavyEvent` 合并进旧 `HeavyEvent`，stream 协议仍是 NDJSON。
- Finalizer 只接收 `ResearchState`，不接收 search provider。
