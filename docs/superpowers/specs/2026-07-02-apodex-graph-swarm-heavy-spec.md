# Apodex Graph Swarm Heavy 主逻辑复刻 Spec

## Context

当前内部版 Heavy 产品已经能真实创建 `Inquiry -> Turn -> Run`，并能让多个 Agent 独立搜索、读取网页、产出报告、核验、生成 Markdown 终稿。但它的主逻辑仍然是固定管线：先拆一批 AgentTask，Agent 各自跑完，Verifier 在 Run 结束后再判断是否补查。这和 Apodex 样本中表现出来的主逻辑不一致。

用户目标不是继续给旧流程补丁，而是最大程度复刻 Apodex 的运行主逻辑，用于内部真实研究产品。产品可以粗糙，但底层行为必须真实：动态拆任务、真实搜索、真实读取、真实日志、真实候选推进、真实证据矩阵、真实最终推理。不能用写死流程、假 Agent、假并行或静态 UI 冒充。

本 spec 将当前 Heavy 升级为 `Graph Swarm Heavy`：一个以全局研究状态为核心的动态图式研究引擎。新任务默认走 graph engine，旧 engine 仅作为回退。

## Current State

验证日期：2026-07-02。

### 本地代码现状

| 组件 | 当前实现 | 已有能力 | 缺口 |
|---|---|---|---|
| Orchestrator | `lib/heavy/orchestrator.ts:122` 到 `lib/heavy/orchestrator.ts:255` | 固定循环 `CoordinatorPlan -> AgentReports -> Verifier -> RunDecision` | 没有全局状态图、候选池、证据矩阵、跨轮动态规划 |
| Run decision | `lib/heavy/orchestrator.ts:287` 到 `lib/heavy/orchestrator.ts:309` | 按 verifier 状态和预算决定 continue/final/fail | 决策粒度太粗，只能在 Run 结束后补查 |
| Heavy 类型 | `lib/heavy/types.ts:158` 到 `lib/heavy/types.ts:169` | `ResearchRun` 只保存 plan、agentReports、verificationReport、decision | 无 `rounds`、`assignments`、`reports_history`、`candidatePool`、`evidenceMatrix` |
| Heavy 事件 | `lib/heavy/types.ts:197` 到 `lib/heavy/types.ts:211` | 有 turn/run/agent/search/read/verifier/final 事件 | 无 graph action、candidate、evidence、ranking、state evaluation 事件 |
| 单 Agent 自适应 | `lib/heavy/adaptive-research.ts:42` 到 `lib/heavy/adaptive-research.ts:215` | Agent 内部能识别意图、生成英文关键词、搜索、评估、改关键词、选择来源、读取 | 只在单个 Agent 内局部生效，主控不会基于全局发现改路线 |
| 英文 query | `lib/heavy/adaptive-research.ts:217` 到 `lib/heavy/adaptive-research.ts:231` | 已将任务 hint/question 转成英文搜索 query | 还没有全局 query clue 复用和候选驱动 query revision |
| 搜索 provider | `lib/heavy/search-provider.ts:47` 到 `lib/heavy/search-provider.ts:73` | relay、OpenCLI、web fallback 会聚合 | 主循环没有把搜索批次作为可审计 artifact 管理 |
| OpenCLI 引擎 | `lib/heavy/search-provider.ts:212` 到 `lib/heavy/search-provider.ts:249` | 逐个调用 google、brave、duckduckgo 并 trace | UI 和 graph state 需要完整显示每个 engine 返回 |
| 存储 | `lib/heavy/storage.ts:81` 到 `lib/heavy/storage.ts:100` | Turn NDJSON event 可追加和回放 | 缺 `graph-state/{turnId}.json`、`search-batches/{batchId}.json` |
| API create | `app/api/inquiries/route.ts:23` 到 `app/api/inquiries/route.ts:26` | POST 创建 inquiry 后调用 `startHeavyInquiry` | 需要按 `HEAVY_ENGINE` 分流 graph/legacy |
| Stream | `app/api/inquiries/[id]/stream/route.ts:31` 到 `app/api/inquiries/[id]/stream/route.ts:60` | 轮询 NDJSON 并实时输出 | 协议可复用，但需要支持 graph event |
| UI event panel | `app/page.tsx:203` 到 `app/page.tsx:213` | 显示事件流 | 只显示最后 40 条，无法完整审计长任务 |
| UI search result | `app/page.tsx:261` 到 `app/page.tsx:265`，`app/page.tsx:407` 到 `app/page.tsx:425` | 显示部分搜索结果 | 单条 event 截断 3 条，Agent 搜索日志截断 5 条，不够审计 |
| UI sources | `app/page.tsx:525` 到 `app/page.tsx:545` | 显示抓到的网页 | 只在 AgentReport 内显示，缺全局来源、证据矩阵和候选关联 |

### Apodex 样本审计结果

本地已审计 9 个 Apodex 分享页，样本合计：

| 指标 | 数量 |
|---|---:|
| 分享页 | 9 |
| assistant turns | 28 |
| `agent-swarm-gv` turns | 19 |
| linear `workflow` turns | 9 |
| heavy runs | 152 |
| subagents | 700 |
| tool calls | 8923 |

样本列表：

| Share ID | 样本类型 | 观察到的核心 workflow |
|---|---|---|
| `ab85d46f-81d0-4e7d-b953-999f00821877` | 电子元器件 distributor 多轮挑战 | 区域拆分、协会目录、B2B 平台、展会、Google dork、海关数据、去重、抽样核验、市场天花板判断 |
| `741e4d54-db93-4e9e-a3c0-4275f769d6ec` | distributor 重复样本 | 多 turn 纠偏，持续扩大数据源并重估名单规模 |
| `8c5cc92f-2186-48c4-9877-2d05b13d5b66` | Grace Brown / Andromeda | 意图识别、英文关键词、弱结果反思、候选推进、代理增长证据、最大可能候选 |
| `4dbe9aa3-2129-4e92-b212-cf26a8f751df` | 美国考试/许可网站定位 | 从线索中抽实体，组合搜索，验证候选网站 |
| `b5ac1c43-66ab-437c-965e-e4db1e5637f5` | 免费子域名 + Cloudflare DNS | 用户挑战后重新定义成功标准，发现 PSL + NS delegation 隐含条件 |
| `09d6e6f6-03f1-458a-bfc5-fbf05a6ca4c5` | 香港 EOL 库存销售策略 | 卖家状态识别、渠道排除、冷启动路径、支付/交易风险 |
| `90b378a3-cce4-4b25-b299-4d423d3fca69` | HS8542 海关数据流程 | 数据清洗、实体合并、同行识别、客户分级、外部验证边界 |
| `2b6988a9-797d-4712-91a1-1678d6e41822` | HS8542 workflow linear variant | 线性 workflow 下也会先定义步骤和边界，再给执行顺序 |
| `e7642659-5a96-46d9-b712-cbc30a7c2cb7` | HS8542 short variant | 短任务也保留条件、边界和后续动作 |

Apodex 的共性不是“更多 Agent”本身，而是：

```text
识别用户意图和成功标准
-> 生成英文搜索关键词组合
-> 搜索并判断结果强弱
-> 弱结果时改关键词或换角度
-> 发现候选后推进为主线
-> 围绕候选补证据和排除项
-> 合并/去重/比较
-> 核验冲突和缺口
-> 输出最大可能答案，并明确未知项
```

## Root Cause

当前 Heavy 的根因问题是外层主控太固定。

已有的 `adaptive-research.ts` 解决了“单个 Agent 如何像 Apodex 一样改关键词”的问题，但没有解决“整个 Inquiry 如何像 Apodex 一样动态改变研究方向”的问题。结果是：

1. 候选可能出现在某个 AgentReport 里，但不会成为全局候选。
2. Verifier 只能在 Run 结束后补查，不能在研究过程中实时改变下一步。
3. 搜索批次、读取网页、证据和候选没有统一 ledger，UI 只能散落展示。
4. Finalizer 没有全局 evidence matrix，只能基于 AgentReport 做总结，容易变成“证据不足”而不是“最大可能候选”。
5. 长任务没有 Apodex 的 `round -> assignment -> report -> verify -> replan` 结构。

## Proposed Change

新增 `Graph Swarm Heavy` 引擎。新引擎不是继续扩大旧 Run，而是引入全局 `ResearchState`，每个 cycle 都做小步动态规划。

主流程：

```text
POST /api/inquiries
-> create Inquiry + Turn
-> create ResearchFrame
-> create ResearchState
-> loop cycle 1..maxCycles
   -> Planner reads ResearchState
   -> emits ResearchAction[]
   -> Executor runs real search/read actions
   -> EvidenceExtractor extracts evidence/candidates/query clues
   -> CandidatePool merges/promotes/rejects candidates
   -> Evaluator decides continue/revise/deep_dive/compare/finalize
   -> persist graph-state and NDJSON events
-> Ranker ranks candidates or paths
-> Finalizer writes markdown from state only
-> Turn completed
```

配置：

```env
HEAVY_ENGINE=graph
HEAVY_LEGACY_ENGINE=legacy
GRAPH_MAX_CYCLES=8
GRAPH_MAX_ACTIONS_PER_CYCLE=6
GRAPH_MAX_SEARCH_ACTIONS_PER_CYCLE=4
GRAPH_MAX_QUERIES_PER_SEARCH_ACTION=4
GRAPH_MAX_RESULTS_PER_QUERY=30
GRAPH_MAX_SOURCES_TO_READ_PER_CYCLE=12
GRAPH_MAX_TOTAL_SOURCES_TO_READ=80
GRAPH_MAX_PROMOTED_CANDIDATES=8
```

默认：`HEAVY_ENGINE=graph`。只有设置 `HEAVY_ENGINE=legacy` 才走旧 `startHeavyInquiry`。

## Implementation Details

### 新增文件

| 文件 | 职责 |
|---|---|
| `lib/heavy/graph/types.ts` | 定义 graph engine 类型和 normalizer |
| `lib/heavy/graph/frame.ts` | 从用户 prompt 生成 `ResearchFrame` |
| `lib/heavy/graph/state.ts` | 创建、更新、保存、摘要化 `ResearchState` |
| `lib/heavy/graph/actions.ts` | action normalizer、英文 query sanitizer、action id |
| `lib/heavy/graph/planner.ts` | 根据全局 state 生成下一批 actions |
| `lib/heavy/graph/executor.ts` | 执行 search/read/analysis/verify action |
| `lib/heavy/graph/source-selector.ts` | 从 search batch 中选择读取 URL |
| `lib/heavy/graph/evidence-extractor.ts` | 从 search/read 结果抽取 evidence、candidate、query clue |
| `lib/heavy/graph/candidate-pool.ts` | 候选合并、打分、推进、排除 |
| `lib/heavy/graph/evidence-matrix.ts` | 生成 candidate x constraint 证据矩阵 |
| `lib/heavy/graph/evaluator.ts` | 判断下一步和停止条件 |
| `lib/heavy/graph/ranker.ts` | 对候选/路径排序 |
| `lib/heavy/graph/finalizer.ts` | 只读 state 生成 Markdown |
| `lib/heavy/graph/graph-orchestrator.ts` | Graph 主循环 |

### 修改文件

| 文件 | 修改 |
|---|---|
| `lib/heavy/types.ts` | 扩展 `Inquiry.graphState?: GraphStateSummary`，扩展 `HeavyEvent` union 支持 graph events |
| `lib/heavy/storage.ts` | 增加 graph state/search batch/source artifact 读写 |
| `app/api/inquiries/route.ts` | 根据 `HEAVY_ENGINE` 选择 graph 或 legacy |
| `app/api/inquiries/[id]/route.ts` | GET inquiry 时读取最新 turn 的 graph state summary |
| `app/api/inquiries/[id]/stream/route.ts` | NDJSON 协议不变，但支持 graph events |
| `app/api/health/route.ts` | 返回 `heavyEngine`、graph budget、search provider 状态，不回显 key |
| `app/page.tsx` | 增加 Graph Research Process、Candidate Pool、Evidence Matrix、Search Ledger、Source Ledger |
| `app/globals.css` | 增加 graph 控制台样式 |
| `tests/*` | 增加 graph 单测、集成测试、UI 测试、9 个样本场景测试 |

### 核心数据模型

```ts
export type TaskKind =
  | "find_person_company"
  | "find_website"
  | "technical_verification"
  | "data_workflow_design"
  | "market_list_building"
  | "sales_strategy"
  | "general_research";

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
```

```ts
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
```

```ts
export type ResearchAction =
  | {
      id: string;
      type: "search_web";
      purpose: string;
      rationale: string;
      priority: "low" | "medium" | "high";
      queries: string[];
      expectedSignals: string[];
      targetCandidateId?: string;
      maxResults: number;
    }
  | {
      id: string;
      type: "read_source";
      purpose: string;
      rationale: string;
      urls: string[];
      targetCandidateId?: string;
    }
  | {
      id: string;
      type: "extract_evidence" | "verify_candidate" | "compare_candidates" | "rank_candidates";
      purpose: string;
      rationale: string;
      targetCandidateIds?: string[];
    };
```

```ts
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
```

### Graph events

扩展 NDJSON event，但不改 stream 协议：

```ts
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
```

### 存储规则

继续使用文件存储。

```text
research-runs/inquiries/{inquiryId}.json
research-runs/logs/{turnId}.ndjson
research-runs/graph-state/{turnId}.json
research-runs/search-batches/{batchId}.json
research-runs/sources/{sourceHash}.json
```

规则：

1. NDJSON event 写 summary，不写完整正文，不写 secret。
2. 完整搜索结果写 `search-batches`。
3. 完整网页正文写 `sources`。
4. `graph-state` 保存完整主控状态，支持恢复和历史 UI 渲染。
5. `GET /api/inquiries/:id` 返回 Inquiry 时附加 `graphState` summary。
6. UI 运行中用 NDJSON 增量，刷新历史任务时用 `graphState` summary。

### Planner 规则

Planner 每个 cycle 读取 `ResearchState`，最多输出 `GRAPH_MAX_ACTIONS_PER_CYCLE` 个 action。

必须支持这些策略：

1. 初始 broad search：从 frame 的 hard constraints、soft preferences、exclusion rules 生成英文 query。
2. 弱结果反思：如果搜索返回少、来源弱、没有候选，生成 revised query。
3. 候选推进：如果发现候选触达核心稀缺条件，立即生成 candidate deep dive。
4. 排除项核验：对太阳能、医疗、重工、DNS 不支持、渠道不适合等排除项单独查证。
5. 比较候选：候选超过 1 个时，生成 compare candidates。
6. 隐含条件发现：当用户反馈或 evidence 显示标准不完整时，更新 frame assumptions 或 hard constraints。
7. 预算控制：预算快耗尽时进入 rank/finalize，不再无效搜索。

### Search 规则

搜索 query 默认英文。

每个 `search_web` action：

1. query 必须经过 `toEnglishSearchText` 或 graph query sanitizer。
2. relay 优先，但不能因为 relay 返回 1 条就停止。
3. OpenCLI 的 google、brave、duckduckgo 必须尽量都调用。
4. web fallback 仅在聚合结果不足或 provider 失败时补充。
5. 每个 provider/engine 的返回结果必须进入 search batch artifact。
6. UI 必须显示 provider、engine、query、status、durationMs、result count、全部返回结果。

### Candidate promotion 规则

候选推进不是等 final 才做。满足任一条件时，候选应进入 `promoted`：

1. 命中至少两个 hard constraints，并且没有命中 exclusion。
2. 命中用户最稀缺/最核心条件，例如 Grace/Andromeda 的 “Australia + robotics hardware + CEO/founder + AI public coverage”。
3. 在多个来源或多个 query 中重复出现。
4. 其他候选都明显更弱，但该候选有足够代理证据。

缺少软偏好不能直接排除候选。应标为 unknown 或 proxy。例如缺少 “30% annual growth” 精确数字时，可以用 funding、valuation、production expansion、deployment、market expansion 作为 proxy growth evidence。

### Finalizer 规则

Finalizer 只读 `ResearchState`，不允许自行搜索。

终稿 Markdown 结构：

```markdown
# 一句话结论

# 最大可能答案 / 候选排名

# 证据矩阵

# 直接证据

# 代理证据

# 排除项和被拒路径

# 未确认项

# 下一步建议

# 来源
```

不得把无来源 claim 写成确定事实。无来源但合理的判断必须标为假设或未确认。

## Implementation Algorithm Contracts

这一节是实现合同，不允许实现者自行发明另一套核心规则。后续 implementation plan 可以拆任务，但不能降低这些规则。

### Weak / Strong Search 定义

每个 `search_web` action 执行后生成 `SearchBatchSummary`。Evaluator 必须用下面规则判断搜索质量。

```ts
export type SearchQuality = "empty" | "weak" | "mixed" | "strong";

export type SearchBatchSummary = {
  id: string;
  actionId: string;
  cycle: number;
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
```

质量规则：

```text
empty:
  dedupedResultCount = 0

weak:
  dedupedResultCount < 5
  OR uniqueDomainCount < 3
  OR expectedSignalHits.length = 0
  OR officialOrPrimaryCount = 0

mixed:
  dedupedResultCount >= 5
  AND expectedSignalHits.length >= 1
  AND candidateMentions.length >= 1
  BUT officialOrPrimaryCount < 2 OR hard constraint evidence still missing

strong:
  dedupedResultCount >= 10
  AND uniqueDomainCount >= 5
  AND expectedSignalHits.length >= 2
  AND officialOrPrimaryCount >= 2
  AND no direct exclusion evidence found
```

Planner 行为：

1. `empty` 连续 1 次：改关键词，加入同义词、source target、地区、行业词。
2. `empty` 连续 2 次：换角度 broad search，扩大任务边界。
3. `weak`：保留有价值线索，但下一轮必须 revised query。
4. `mixed`：如果出现候选，必须 candidate deep dive。
5. `strong`：进入 source selection / evidence extraction。

### Provider Failure 规则

每个 query 必须尽量执行：relay、OpenCLI google、OpenCLI brave、OpenCLI duckduckgo。web fallback 按需补充。

```text
provider timeout: 记录 timeout，继续下一个 provider/engine。
provider error: 记录 error summary，继续下一个 provider/engine。
provider empty: 记录 empty，不算失败。
all providers error/timeout: action status = failed。
all providers empty: action status = completed, quality = empty。
部分 provider 成功: action status = completed。
```

Provider 错误 body 不得完整写入日志，只保存 `compactError(message)`。

### Artifact ID 与 Hash 规则

```ts
batchId = `batch_${turnId}_${cycle}_${actionId}_${sha256(normalizedQueries.join("\n")).slice(0, 12)}`;
providerCallArtifactId = `search_${batchId}_${provider}_${engineOrDefault}_${index}`;
sourceHash = sha256(normalizedUrl).slice(0, 32);
actionId = `act_${cycle}_${type}_${slug(purpose).slice(0, 32)}_${index}`;
evidenceId = `ev_${sourceHash}_${sha256(claim).slice(0, 10)}`;
candidateId = `cand_${kind}_${sha256(normalizedPrimaryNameOrUrl).slice(0, 12)}`;
```

`normalizedUrl` 必须小写 host，去掉 fragment，保留 path/query。`normalizedPrimaryNameOrUrl` 对候选名称做小写、去标点、多空格合并。

### EvidenceItem 与 EvidenceMatrix

```ts
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
  provider: "relay" | "opencli" | "web" | "fetch" | "test";
  engine?: string;
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
```

矩阵生成规则：

1. direct evidence 优先级最高。
2. contradictory evidence 覆盖 direct/proxy，cell 状态为 `contradicted`。
3. exclusion rule 命中 direct evidence，候选 status 改 `rejected`，cell 状态为 `excluded`。
4. 只有 proxy evidence 时，cell 状态为 `proxy`。
5. 没有证据但仍需核验，cell 状态为 `missing`。
6. 任务本身无法从公开资料确认，cell 状态为 `unknown`。

### Candidate Score 与 Confidence

Candidate score 必须确定性计算，LLM 只能提供 evidence，不直接给最终分。

```text
score = clamp(0, 100,
  directHardMatches * 18
  + proxyHardMatches * 10
  + directSoftMatches * 8
  + proxySoftMatches * 4
  + sourceDiversityBonus
  + recencyBonus
  + repeatedMentionBonus
  - missingHardCount * 16
  - missingSoftCount * 3
  - contradictionCount * 20
  - sourceRiskPenalty
  - exclusionPenalty
)

sourceDiversityBonus = min(uniqueDomains, 4) * 3
recencyBonus = 3 if at least one source appears current/recent, else 0
repeatedMentionBonus = min(candidateMentionCount, 5)
sourceRiskPenalty = lowQualitySourceCount * 4
exclusionPenalty = 100 if direct exclusion evidence exists, else 0
```

Confidence：

```text
high:
  score >= 75
  AND missingHardCount = 0
  AND directHardMatches >= 2
  AND uniqueDomains >= 2
  AND contradictionCount = 0

medium:
  score >= 45
  AND contradictionCount = 0
  AND directHardMatches + proxyHardMatches >= 2

low:
  otherwise
```

候选排序：先排除 `rejected`，再按 `score desc`，再按 `confidence high > medium > low`，再按 `directEvidenceIds.length desc`。

### GraphStateSummary API 合同

`GET /api/inquiries/:id` 附加的 `graphState` 必须是 summary，不返回完整正文。

```ts
export type GraphStateSummary = {
  frame: Pick<ResearchFrame, "taskKind" | "userGoal" | "deliverable" | "hardConstraints" | "softPreferences" | "exclusionRules">;
  status: "running" | "completed" | "failed";
  cycleIndex: number;
  actionCount: number;
  searchBatchCount: number;
  sourceCount: number;
  evidenceCount: number;
  candidates: Array<Pick<Candidate, "id" | "kind" | "name" | "aliases" | "summary" | "matchedConstraints" | "missingConstraints" | "score" | "confidence" | "status">>;
  evidenceMatrix: EvidenceMatrix;
  rejectedPaths: RejectedPath[];
  evaluatorDecisions: EvaluatorDecision[];
  recentSearchBatches: SearchBatchSummary[];
  recentSources: SourceSummary[];
  updatedAt: string;
};
```

UI 只能从 `graphState` summary、NDJSON event、artifact endpoints 渲染，不从本地文件路径直接读取。

### State Recovery 与 Multi-turn 继承

运行恢复：

1. `startGraphHeavyInquiry` 创建新 Turn 时，如果同一 `turnId` 已有 running graph state，调用 `resumeGraphHeavyInquiry`。
2. 恢复时读取 `graph-state/{turnId}.json`。
3. 已存在 artifact 的 action 不重复执行。
4. 从最后一个完整 `state_evaluated` cycle 后继续。
5. 如果 graph state 损坏，Turn failed，记录 `error`，不得静默重跑导致重复搜索。

多 turn 继承：

1. 同一 Inquiry 新 Turn 必须读取上一 Turn 的 final report、candidate pool summary、evidence matrix summary。
2. 新 Turn 的 prompt 如果是挑战/纠偏/扩大规模，则 `ResearchFrame` 必须保留上一轮 candidates 和 rejected paths。
3. 新 Turn 不复用完整网页正文，只复用 source summary 和 evidence ids。
4. 如果用户明确换题，则创建新 frame，不继承候选。

挑战/纠偏识别关键词：`不对`、`不是`、`重新`、`扩大`、`更多`、`为什么`、`对比`、`验证`、`challenge`、`compare`、`more`、`not correct`。

### Extractor 规则

Extractor 输入：`ResearchFrame`、当前 action、search results、read sources、现有 candidate pool。

输出严格 JSON：

```ts
export type EvidenceExtractionOutput = {
  evidenceItems: EvidenceItem[];
  candidates: Candidate[];
  queryClues: QueryClue[];
  rejectedPaths: RejectedPath[];
};
```

规则：

1. 每个 evidence 必须绑定 `sourceUrl`。
2. 没有 URL 的 claim 丢弃或写入 assumption，不进入 evidenceItems。
3. 从 title/snippet 抽到的 evidence strength 最高只能是 `weak` 或 `proxy`。
4. 从 fullText 官方页抽到的身份、产品、DNS 能力、公司介绍可为 `direct`。
5. LLM JSON 解析失败时，用启发式 extractor：从 title/snippet/fullText 提取人名、公司名、URL domain、关键词命中。
6. Extractor 不负责 final ranking，只产出证据和候选。

### Evaluator 规则

Evaluator 每 cycle 输出：

```ts
export type EvaluatorDecision = {
  id: string;
  cycle: number;
  action: "continue" | "revise_query" | "promote_candidate" | "compare_candidates" | "rank" | "finalize" | "fail";
  reason: string;
  nextFocus: string[];
  unresolvedQuestions: string[];
  createdAt: string;
};
```

决策优先级：

1. 有 direct exclusion 命中：reject candidate，继续找替代候选。
2. 有 promoted candidate 但缺 hard constraints：deep dive candidate。
3. 有多个 active/promoted candidates：compare candidates。
4. 搜索质量 empty/weak 且预算未耗尽：revise query。
5. 至少一个候选 score >= 45 且预算耗尽：rank，然后 finalize with uncertainty。
6. 至少一个候选 confidence high 或 medium 且 hard constraints 足够：rank，然后 finalize。
7. 没有任何 candidate/evidence 且预算耗尽：fail。

### Finalizer Model Boundary

Finalizer 可以调用 LLM 写作，但不得搜索，不得读取新 URL。

输入只允许：

```ts
{
  prompt: string;
  frame: ResearchFrame;
  candidates: Candidate[];
  evidenceMatrix: EvidenceMatrix;
  evidenceItems: EvidenceItem[];
  sourceSummaries: SourceSummary[];
  evaluatorDecisions: EvaluatorDecision[];
  rejectedPaths: RejectedPath[];
}
```

禁止输入：`HeavySearchProvider`、`search()`、`read()`、外部 URL fetch 函数。

Finalizer 验证规则：

1. Markdown 中每个确定事实必须至少有一个 source URL。
2. source URL 必须来自 `sourceSummaries` 或 `evidenceItems`。
3. unknowns 必须来自 missing/unknown matrix cells 或 evaluator unresolvedQuestions。
4. rejected paths 必须来自 rejectedPaths 或 exclusion cells。
5. 如果 LLM 输出引用了未知 URL，删除该引用并降级为 unsupported claim。

### UI Data Contract

UI 新增这些面板：

```text
GraphResearchOverview
  props: graphState, events
  shows: frame, current cycle, action/source/evidence counts

SearchLedgerPanel
  props: graphState.recentSearchBatches, events(search_batch_reported)
  shows: provider, engine, query, status, duration, all result titles/urls/snippets

SourceLedgerPanel
  props: graphState.recentSources, events(source_read)
  shows: title, url, provider, engine, read status, readCharCount

CandidatePoolPanel
  props: graphState.candidates
  shows: name, score, confidence, status, matched/missing constraints, evidence count

EvidenceMatrixPanel
  props: graphState.evidenceMatrix, graphState.candidates, frame constraints
  shows: rows=candidates, columns=constraints, cells=direct/proxy/missing/contradicted/excluded/unknown

GraphDecisionTimeline
  props: graphState.evaluatorDecisions, graph events
  shows: cycle decisions, reasons, nextFocus, unresolvedQuestions
```

UI 不得只展示最后 40 条事件。事件面板可以虚拟滚动或分页，但总量必须可查看。

### Scenario Test Fixtures 合同

`tests/heavy-graph-scenarios.test.ts` 不要求真实联网，使用 mock provider 固定结果。

每个 scenario 至少断言：

1. `frame.taskKind` 正确。
2. 至少产生 2 个 cycle，短任务可为 1 个 cycle 但必须有 frame/evidence boundary。
3. 至少一次英文 query。
4. search batch 记录 provider/engine。
5. relevant candidate 或 workflow path 进入 candidate pool。
6. evidence matrix 出现 direct/proxy/missing/unknown 至少一种状态。
7. final markdown 包含 source URL。
8. final markdown 包含 unknowns 或 rejected paths，当样本需要时。

具体 fixture：

| Scenario | Mock results | Required assertions |
|---|---|---|
| Grace/Andromeda | robotics CEO profile、funding article、AI interview、no exact growth | candidate promoted/ranked，growth cell = proxy 或 unknown |
| Website finding | clue result、candidate site、profile page | website candidate ranked，source URL cited |
| Cloudflare DNS | PSL docs、NS delegation docs、invalid provider page | hidden criterion added，invalid path rejected |
| Distributor list | Supply Chain Connect、IDEA、ERAI、trade show、Google dork、customs snippets | multiple action categories，dedupe path，market ceiling note |
| HK sales | platform eligibility、fee pages、risk docs | channels ranked，unsuitable channels rejected |
| HS8542 full | customs docs、entity resolution docs、EOL external data docs | workflow candidate，HS code boundary unknowns |
| HS8542 linear | same as above but short path | ordered gates present |
| HS8542 short | minimal docs | evidence boundary present |
| Distributor challenge | previous candidate pool + new broader sources | multi-turn inheritance and data-source reframing |

### Referenced Types 完整定义

这些类型必须在 `lib/heavy/graph/types.ts` 中定义并导出。不得只在注释或测试中临时定义。

```ts
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
  provider: "relay" | "opencli" | "web" | "fetch" | "test";
  engine?: string;
  status: "selected" | "read" | "snippet_only" | "error";
  readCharCount?: number;
  evidenceIds: string[];
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
```

`FinalReport` 继续复用 `lib/heavy/types.ts` 中已有类型，不在 graph/types 重复定义。

### LLM Output Schema 合同

模型可以参与 frame/planner/extractor/finalizer，但每个输出必须先 `parseJsonObject`，再 normalize。normalize 后为空时使用启发式 fallback，不允许让 Turn 因非关键 JSON 缺字段直接崩掉。

Frame model 输出：

```ts
export type FrameModelOutput = {
  taskKind: TaskKind;
  userGoal: string;
  deliverable: string;
  hardConstraints: Array<{ id: string; label: string; description?: string; core?: boolean }>;
  softPreferences: Array<{ id: string; label: string; description?: string }>;
  exclusionRules: Array<{ id: string; label: string; description?: string }>;
  initialAngles: Array<{ id: string; title: string; priority: "low" | "medium" | "high"; querySeeds: string[] }>;
  assumptions: Array<{ id: string; text: string }>;
};
```

Planner model 输出：

```ts
export type PlannerModelOutput = {
  actions: ResearchAction[];
  rationale: string;
};
```

Extractor model 输出已定义为 `EvidenceExtractionOutput`。Finalizer model 输出：

```ts
export type FinalizerModelOutput = {
  summary: string;
  markdown: string;
  sourceUrls: string[];
  unknowns: string[];
};
```

Prompt 边界：system prompt 必须声明“只输出严格 JSON，不搜索，不编造来源”。user prompt 必须包含 allowed source URLs 列表。Finalizer 输出后必须过滤不在 allowed source URLs 内的 URL。

### Budget Accounting 合同

每个 cycle 开始前检查预算：

```text
if cyclesUsed >= maxCycles -> stop and rank/finalize or fail
if sourcesRead >= maxTotalSourcesToRead -> stop reading new sources, rank/finalize or fail
if promotedCandidates >= maxPromotedCandidates -> compare/rank, no more candidate broadening
```

每个 action 记账：

```text
any action: actionsUsed += 1
search_web: searchActionsUsed += 1, queriesUsed += action.queries.length
read_source: sourcesRead += successfullyReadSourceCount
cycle completed: cyclesUsed += 1
```

每个 cycle 内：

1. `search_web` action 数量不得超过 `maxSearchActionsPerCycle`。
2. 每个 `search_web` 的 query 数量不得超过 `maxQueriesPerSearchAction`。
3. 每个 cycle 读取网页不得超过 `maxSourcesToReadPerCycle`。
4. 如果 Planner 输出超预算 action，normalizer 直接截断，并记录 `state_evaluated` reason。

### Deterministic Stop Conditions

`hardConstraintsEnough(candidate, frame)` 定义：

```text
candidate.status != rejected
AND no exclusion rule has direct evidence
AND every core hard constraint has direct or proxy evidence
AND missing non-core hard constraints <= 1
AND contradictionCount = 0
```

对于 `find_person_company`，默认 core hard constraints：person identity、company identity、role/seniority、industry fit、geography。增长率默认 soft preference，除非用户明确说“必须”。

Stop 条件优先级：

1. 没有 evidence 且预算耗尽：fail。
2. 至少一个 candidate 满足 `hardConstraintsEnough` 且 score >= 60：rank + finalize。
3. 至少一个 candidate score >= 45 且预算耗尽：rank + finalize_with_uncertainty。
4. 没有 candidate 但有 workflow path，且 taskKind 是 data_workflow_design 或 sales_strategy：finalize workflow。
5. 否则 continue/revise_query。

### Source Classification 合同

`officialOrPrimaryCount`、`sourceType`、`expectedSignalHits` 必须确定性计算。

```text
official:
  domain matches candidate company/person/project domain
  OR path/title contains official, about, company, docs, support, developers, newsroom
  OR domain is government/education/standards body for technical verification

profile:
  LinkedIn, Crunchbase, company leadership page, author bio, conference speaker page

news:
  reputable publication or press/newsroom article

directory:
  association/member/ranking/supplier directory

database:
  customs/trade/company database pages

snippet:
  search result without full-page read
```

`expectedSignalHits` = action.expectedSignals 中被 title/snippet/fullText 命中的词，大小写不敏感，连字符和空格视为等价。

`candidateMentionCount` = candidate aliases 在 title/snippet/fullText 中命中的次数，按 source 去重后求和。

`lowQualitySourceCount` = sourceType 为 forum/snippet/other 且没有 fullText 的数量。

`recencyBonus` = 来源 title/snippet/fullText 中出现当前年份或上一年，或日期字段在最近 24 个月。

### Artifact API 合同

新增 artifact API，供 UI 展开完整搜索结果和网页正文片段。

```text
GET /api/inquiries/:id/artifacts/search-batches/:batchId
-> SearchBatchArtifact

GET /api/inquiries/:id/artifacts/sources/:sourceHash
-> SourceArtifact summary + safe text excerpt
```

返回规则：

1. API 必须校验 artifact 属于该 inquiry 的 turn graph state。
2. search batch 返回完整 result list，但不返回 secret 或 provider raw error body。
3. source artifact 默认返回 `excerpt`，最多 12,000 字符。
4. 如需完整正文，后续单独加内部权限，本 issue 不做。

### UI State / Error 合同

每个 graph panel 必须有四种状态：

```text
loading: 正在加载 inquiry 或 artifact
empty: 当前没有对应数据
ready: 正常展示
error: artifact 或 inquiry 加载失败，显示可读错误和重试按钮
```

UI 必须做到：

1. 长 query、长 URL、长标题不撑破布局。
2. 搜索结果超过 30 条时分页或折叠，但用户能展开全部。
3. event panel 不再 slice 最后 40 条作为唯一视图。
4. 历史 Inquiry 没有 live events 时，仍从 graphState 渲染完整 summary。
5. artifact 加载失败不影响 final report 展示。

## Child Issues

| # | 标题 | 优先级 | 依赖 | 预估 |
|---|---|---|---|---:|
| 1 | Graph 类型、normalizer、预算配置 | Critical | 无 | 0.5 天 |
| 2 | Graph state 存储和事件扩展 | Critical | #1 | 0.5 天 |
| 3 | ResearchFrame 生成器 | Critical | #1 | 0.5 天 |
| 4 | Planner 动态动作生成 | Critical | #1 #3 | 1 天 |
| 5 | Executor + source selector | Critical | #1 #2 #4 | 1 天 |
| 6 | Evidence extractor + candidate pool | Critical | #1 #5 | 1 天 |
| 7 | Evaluator + evidence matrix + ranker | Critical | #6 | 1 天 |
| 8 | Graph orchestrator + API 分流 | Critical | #2 #4 #5 #6 #7 | 1 天 |
| 9 | Graph finalizer | High | #7 #8 | 0.5 天 |
| 10 | UI graph panels | High | #2 #8 | 1 天 |
| 11 | 9 个 Apodex 样本场景测试 | High | #8 #9 #10 | 1 天 |
| 12 | Health/config/docs/no-secret 验证 | Medium | #8 | 0.5 天 |

## Dependency Graph

```text
#1 Graph Types
 ├─> #2 Storage + Events
 ├─> #3 ResearchFrame
 │    └─> #4 Planner
 │         └─> #5 Executor + Source Selector
 │              └─> #6 Evidence + Candidate Pool
 │                   └─> #7 Evaluator + Matrix + Ranker
 │                        ├─> #8 Graph Orchestrator + API
 │                        │    ├─> #9 Finalizer
 │                        │    └─> #10 UI
 │                        └─> #11 Scenario Tests
 └─> #12 Config + Health + Docs
```

顺序原因：先有类型和状态，才能让 Planner/Executor/Evidence/Evaluator 共享同一套事实。UI 必须等 graph state 和事件稳定后再做，否则又会变成展示层补丁。

## Acceptance Criteria

1. `HEAVY_ENGINE` 未设置时，新 Inquiry 默认走 graph engine。
2. `HEAVY_ENGINE=legacy` 时，新 Inquiry 走旧 `lib/heavy/orchestrator.ts`。
3. Graph engine 每个 Turn 都写入 `research-runs/graph-state/{turnId}.json`。
4. Graph engine 每个 Turn 都写入 `research-runs/logs/{turnId}.ndjson`。
5. 所有 graph event 都经过 `redactSecrets` 或等效逻辑，不写 API key。
6. 搜索 query 默认英文，中文 prompt 生成的 query 不得保留大段中文关键词。
7. relay、OpenCLI、google、brave、duckduckgo、web fallback 的调用状态都能在 graph state 或 search batch 中看到。
8. UI 能显示每个 provider/engine 的 query、status、duration、result count、返回结果列表。
9. UI 不再只依赖最后 40 条事件，历史 Inquiry 重新打开后仍能看到 frame、process、candidate pool、evidence matrix。
10. 每个抓取网页都显示 title、url、provider、engine、read status、readCharCount。
11. 完整搜索结果写入 `search-batches`，NDJSON 只写 summary。
12. 完整网页正文写入 `sources`，NDJSON 只写 summary。
13. 候选实体进入全局 `candidatePool`。
14. 候选可被 `active`、`promoted`、`ranked`、`rejected` 标记。
15. Evidence matrix 能按 candidate x constraint 显示 direct、proxy、missing、contradicted。
16. Final report 必须输出最大可能候选或最大可能路径。
17. Final report 必须区分直接证据、代理证据、假设、未知项、排除项。
18. 无来源 claim 不得写成确定事实。
19. 预算耗尽但有候选时，输出不完全确认报告，而不是直接失败。
20. 预算耗尽且没有任何证据时，Turn failed 并记录原因。
21. 一个 action 失败不能终止整个 Turn，除非所有关键 action 均失败且没有证据。
22. 9 个 Apodex 样本场景测试全部通过。
23. `npm run test` 通过。
24. `npm run lint` 通过。
25. `npm run build` 通过。

## Apodex Scenario Acceptance

### 1. Grace Brown / Andromeda

输入类似：找澳大利亚创新硬件 CEO，排除太阳能、医疗器械、重工，最好 30% 增长，任职三年以上，最近发表 AI 观点。

必须行为：

1. 生成英文 broad search query。
2. 搜索结果弱时改 query。
3. 发现 Grace Brown / Andromeda 类候选时推进到 candidate pool。
4. 围绕候选做 deep dive。
5. 缺少精确 30% 增长时标为 unknown/proxy，不直接放弃。
6. Final 输出 top candidate 和证据矩阵。

### 2. 美国考试/许可网站定位

必须行为：

1. 从线索抽取人名、产品、考试、免费、AI 等 clue。
2. 组合英文 query。
3. 搜索不到时改用 discovered entities。
4. 输出 candidate website 并说明验证链。

### 3. 免费子域名 + Cloudflare DNS

必须行为：

1. 识别用户真正要验证的是“能不能接 Cloudflare”。
2. 发现 hidden criterion：Public Suffix List 和 authoritative NS delegation。
3. 用户挑战后能更新 frame。
4. 重新核验之前建议，标出不支持/不确定项。

### 4. 电子元器件 distributor 大名单

必须行为：

1. 拆出北美、欧洲、亚太、混合分销商等区域或类型 action。
2. 后续拆出协会目录、B2B 平台、展会、Google dork、海关数据。
3. 合并去重。
4. 抽样核验。
5. 说明公开渠道可验证名单规模和市场天花板。
6. 区分精准买家和大规模 funnel。

### 5. 香港 EOL 库存销售策略

必须行为：

1. 识别新卖家、低成本、无历史交易、风险控制。
2. 验证平台准入和成本。
3. 排除不适合冷启动的渠道。
4. 输出分阶段路径和交易风险。

### 6. HS8542 海关数据流程

必须行为：

1. 生成 data workflow frame。
2. 区分清洗、实体合并、同行识别、客户分级、存储架构。
3. 明确 HS code 能支持什么，不能支持什么。
4. EOL/HTF 需要外部验证，不能从 HS code 单独推断。

### 7. HS8542 workflow linear variant

必须行为：

1. 即使是线性 workflow，也要记录步骤、边界、下一步。
2. 输出 ordered gates。

### 8. HS8542 short variant

必须行为：

1. 短任务仍创建 frame 和 evidence boundary。
2. 不因任务短而跳过证据和未知项。

### 9. Distributor duplicate challenge

必须行为：

1. 多 turn 中继承上一轮 state。
2. 用户要求扩大规模时，不只是多搜，而是重估数据源策略。
3. 明确免费公开渠道、付费目录、海关数据、LinkedIn/销售数据库的边界。

## Testing Plan

| Layer | 测试文件 | 内容 |
|---|---|---|
| Unit | `tests/heavy-graph-types.test.ts` | 类型 normalizer 过滤坏数据，保留有效 action/evidence/candidate |
| Unit | `tests/heavy-graph-frame.test.ts` | prompt 生成 taskKind、constraints、exclusions、search policy |
| Unit | `tests/heavy-graph-planner.test.ts` | broad search、revised query、candidate deep dive、compare、rank trigger |
| Unit | `tests/heavy-graph-executor.test.ts` | provider trace、engine trace、search batch artifact、read fallback |
| Unit | `tests/heavy-graph-source-selector.test.ts` | 从宽搜索结果选择来源，官方/高信号来源优先 |
| Unit | `tests/heavy-graph-evidence.test.ts` | 从 source/snippet 抽证据、候选、query clue |
| Unit | `tests/heavy-graph-candidate-pool.test.ts` | 候选合并、别名合并、推进、排除、打分 |
| Unit | `tests/heavy-graph-evaluator-ranker.test.ts` | evidence matrix、预算耗尽、rank 规则 |
| Integration | `tests/heavy-graph-orchestrator.test.ts` | 多 cycle：搜索弱 -> 改 query -> 推进候选 -> rank -> final |
| Integration | `tests/heavy-graph-scenarios.test.ts` | 9 个 Apodex 样本的 mock scenario |
| API | `tests/heavy-api.test.ts` | graph/legacy 分流，GET inquiry 注入 graphState |
| UI | `tests/heavy-ui.test.tsx` | frame、process、search ledger、source ledger、candidate pool、matrix、final 渲染 |
| Manual | 本地浏览器 | 跑 Grace/Andromeda 和 distributor 两个真实样本，确认 UI 可审计 |

## Rollback Plan

不删除旧 `lib/heavy/orchestrator.ts`。上线后如 graph engine 出现阻塞，设置：

```env
HEAVY_ENGINE=legacy
```

即可回旧流程。

数据回滚：

1. 旧 Inquiry JSON 不需要迁移。
2. Graph 新增文件独立存放在 `graph-state`、`search-batches`、`sources`。
3. 删除 graph 文件不影响旧 legacy Inquiry 的读取。
4. UI 如果没有 `graphState`，继续显示旧 Run/AgentReport。

## Effort Estimate

| 工作 | 预估 |
|---|---:|
| 类型、normalizer、预算 | 0.5 天 |
| 存储和事件 | 0.5 天 |
| Frame + Planner | 1.5 天 |
| Executor + source selector | 1 天 |
| Evidence + candidate pool | 1 天 |
| Evaluator + ranker + matrix | 1 天 |
| Orchestrator + API | 1 天 |
| Finalizer | 0.5 天 |
| UI | 1 天 |
| 测试和真实样本验证 | 1.5 天 |
| 总计 | 9.5 天 |

人类团队预估为 12 到 16 个开发日。AI pair/subagent 执行如果并行充分，目标是 3 到 5 个长工作日，但不能跳过测试、真实样本验收和质量门。

## Files Reference

| File | Change |
|---|---|
| `lib/heavy/graph/types.ts` | 新增 graph 类型和 normalizer |
| `lib/heavy/graph/frame.ts` | 新增 frame 创建逻辑 |
| `lib/heavy/graph/state.ts` | 新增 state 创建、更新、summary |
| `lib/heavy/graph/actions.ts` | 新增 action helper 和英文 query sanitizer |
| `lib/heavy/graph/planner.ts` | 新增动态 planner |
| `lib/heavy/graph/executor.ts` | 新增 action executor |
| `lib/heavy/graph/source-selector.ts` | 新增来源选择 |
| `lib/heavy/graph/evidence-extractor.ts` | 新增证据和候选抽取 |
| `lib/heavy/graph/candidate-pool.ts` | 新增候选池 |
| `lib/heavy/graph/evidence-matrix.ts` | 新增证据矩阵 |
| `lib/heavy/graph/evaluator.ts` | 新增状态评估 |
| `lib/heavy/graph/ranker.ts` | 新增排序 |
| `lib/heavy/graph/finalizer.ts` | 新增终稿生成 |
| `lib/heavy/graph/graph-orchestrator.ts` | 新增主循环 |
| `lib/heavy/types.ts` | 扩展 Inquiry 和 HeavyEvent |
| `lib/heavy/storage.ts` | 增加 graph state/search batch/source artifact 存储 |
| `app/api/inquiries/route.ts` | graph/legacy 分流 |
| `app/api/inquiries/[id]/route.ts` | graphState summary hydration |
| `app/api/inquiries/[id]/stream/route.ts` | 支持 graph event 回放 |
| `app/api/health/route.ts` | health 暴露 engine/config 状态，不暴露 key |
| `app/page.tsx` | 增加 graph 控制台面板 |
| `app/globals.css` | 增加 graph UI 样式 |
| `tests/heavy-graph-*.test.ts` | 新增 graph 测试 |
| `tests/heavy-graph-scenarios.test.ts` | 新增 9 个 Apodex 样本场景 |

## What Is Working Well, Do Not Touch

1. 保留 `createHeavySearchProvider` 的 relay/OpenCLI/web fallback 基础能力。
2. 保留 `adaptive-research.ts` 中英文 query、搜索质量评估、关键词调整的局部逻辑，可迁移复用。
3. 保留当前 Inquiry JSON 和 Turn NDJSON 作为基础存储。
4. 保留旧 `/api/research` legacy routes。
5. 保留旧 Heavy orchestrator 作为 `HEAVY_ENGINE=legacy` 回退。
6. 保留 `react-markdown + remark-gfm` 的 final markdown 渲染。

## Out of Scope

1. 登录、权限、计费。
2. 云端部署。
3. SQLite/Postgres 迁移。
4. 通用浏览器自动化爬虫平台。
5. 复制 Apodex 视觉品牌。
6. 付费数据库真实接入，例如 LinkedIn Sales Navigator、Volza 付费账号、ERAI 付费目录。
7. 把历史 legacy Inquiry 全量迁移为 graph state。

## Definition of Done

1. 新任务默认 graph engine。
2. 旧 engine 可通过 `HEAVY_ENGINE=legacy` 回退。
3. 9 个 Apodex-derived scenario tests 通过。
4. UI 可完整查看每个 action 的搜索、读取、候选、证据和最终推理。
5. Grace/Andromeda 类问题能输出最大可能候选，而不是只说证据不足。
6. Distributor 类问题能动态扩展数据源策略，并输出名单规模边界。
7. Cloudflare 子域名类问题能发现隐含成功条件并纠偏。
8. HS8542 类问题能明确数据可推断边界，不能从 HS code 过度推断 EOL/HTF。
9. 日志、测试、文档、UI 中不出现 API key。
10. `npm run test`、`npm run lint`、`npm run build` 全部通过。

## Related

- `docs/superpowers/specs/2026-07-02-apodex-graph-heavy-research-engine-design.md`
- `docs/superpowers/plans/2026-07-02-apodex-graph-heavy-research-engine.md`
- `docs/superpowers/specs/2026-07-01-agent-adaptive-research-design.md`
- `docs/superpowers/plans/2026-07-01-agent-adaptive-research.md`


