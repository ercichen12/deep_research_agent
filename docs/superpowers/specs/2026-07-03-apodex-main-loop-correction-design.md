# Apodex Main Loop 修正版 Design Doc

## 背景

当前 Graph Heavy 已经有 `ResearchFrame`、`ResearchState`、`Planner`、`Executor`、`EvidenceExtractor`、`Evaluator`、`Finalizer`，也能真实搜索、读取网页、保存 search/source artifact，并在 HS8542 样本中跑出较像样的终稿。

但这还不是 Apodex 的主逻辑。现在的问题不是搜索数量、UI 展示、final report 文案，而是主控流程仍然容易滑成：

```text
按 taskKind 建 frame
-> 按模板生成 search actions
-> 读一批网页
-> 有 evidence 后进入固定 draft / critique / revision
-> finalizer 输出像样报告
```

这说明当前实现有 Graph 外壳，但动态研究控制器还不够。Apodex 的关键不是“最后输出什么格式”，而是每一步都在问：

```text
当前最大不确定点是什么？
刚刚的搜索有没有解决它？
如果没有，为什么没有？
下一步应该换关键词、换来源、推进候选、验证矛盾，还是停止？
```

本设计文档修正 Graph Heavy 的主循环合同。后续实现必须优先修 `Planner + Evaluator + EvidenceGapLoop`，不能继续靠 finalizer 补强。

## 目标

把 Heavy 主逻辑从“固定研究流水线”改成“动态研究控制器”。

目标主循环：

```text
ResearchState
-> observe current evidence/search/candidates/gaps
-> decide next best uncertainty
-> act with targeted search/read/verify
-> evaluate outcome
-> update state
-> replan
-> repeat until enough evidence or budget exhausted
```

这个循环必须在日志和 UI 中可见。用户应该能看到：

- 系统当前认为要解决的问题是什么。
- 为什么生成这些英文关键词。
- 哪次搜索弱，弱在哪里。
- 为什么换关键词或换来源。
- 为什么推进某个候选或路径。
- 为什么停止并输出最大可能答案。

## 非目标

本次不做：

- 继续改 final report 文案来掩盖流程问题。
- 继续单纯提高 search limit。
- 继续增加固定 taskKind 模板。
- 复制 Apodex 视觉样式。
- 引入数据库、登录、权限、付费数据源。

## 核心判断

这是规划问题为主，实现问题为辅。

旧规划虽然提出 Graph State，但没有把“动态研究循环”锁成不可违反的合同。因此实现自然变成：

```text
graph shell + taskKind templates + finalizer compensation
```

修正后必须变成：

```text
research loop controller + state transition reasons + evidence gaps + dynamic replanning
```

## 新主循环

### 1. Observe

每个 cycle 开始时，主控必须从 `ResearchState` 生成 `ResearchObservation`。

```ts
export type ResearchObservation = {
  cycle: number;
  taskKind: TaskKind;
  currentGoal: string;
  knownFacts: ObservedFact[];
  candidateSnapshot: CandidateSnapshot[];
  searchOutcomes: SearchOutcomeSummary[];
  evidenceGaps: EvidenceGap[];
  contradictions: Contradiction[];
  weakSearches: WeakSearchReason[];
  availableClues: QueryClue[];
  budgetSnapshot: GraphBudgetSnapshot;
};
```

`Observe` 的职责不是规划下一步，而是诚实描述当前局面：

- 哪些 hard constraints 已经有 direct/proxy evidence。
- 哪些 hard constraints 仍然 missing。
- 哪些搜索结果是 empty/weak/mixed/strong。
- 哪些 query 带来了高价值来源。
- 哪些 query 失败了，失败原因是关键词太宽、太窄、语言不对、来源类型不对、候选不明确、provider 失败。
- 当前是否有候选、路径、workflow gate 可以推进。

### 2. Decide

`DecisionEngine` 读取 `ResearchObservation`，输出一个 `ResearchDecision`。

```ts
export type ResearchDecision =
  | {
      action: "revise_query";
      targetGapId: string;
      reason: string;
      queryRevisionStrategy: QueryRevisionStrategy;
    }
  | {
      action: "broaden_sources";
      targetGapId: string;
      reason: string;
      sourceFamilies: SourceFamily[];
    }
  | {
      action: "promote_candidate";
      candidateId: string;
      reason: string;
    }
  | {
      action: "deep_dive_candidate";
      candidateId: string;
      reason: string;
      missingEvidence: EvidenceGap[];
    }
  | {
      action: "verify_contradiction";
      contradictionId: string;
      reason: string;
    }
  | {
      action: "compare_candidates";
      candidateIds: string[];
      reason: string;
    }
  | {
      action: "synthesize_workflow";
      reason: string;
      requiredGates: string[];
    }
  | {
      action: "finalize";
      reason: string;
      confidence: "low" | "medium" | "high";
    }
  | {
      action: "fail";
      reason: string;
    };
```

`DecisionEngine` 必须遵守优先级：

1. 有 contradiction 且影响结论，先验证 contradiction。
2. 新候选满足稀缺条件但还没有进入主线，先 `promote_candidate`。
3. 已 promoted candidate/path 但缺关键证据，先 `deep_dive_candidate`。
4. 搜索 weak/empty 且关键 gap 未解决，先 revise query 或 broaden source。
5. 有多个候选且都部分满足，进入 compare。
6. workflow task 已有足够证据，进入 synthesize/critique/revision。
7. 预算接近耗尽但已有证据，finalize with uncertainty。
8. 没有证据且预算耗尽，fail。

### 3. Act

`ActionPlanner` 只根据 `ResearchDecision` 生成 action，不再直接按 taskKind 套固定模板。

```text
ResearchDecision -> ResearchAction[]
```

例子：

- `revise_query` 生成带明确 revision reason 的英文 query。
- `broaden_sources` 生成按 source family 拆开的 query，例如 association directory、trade database、official docs、newsroom、forum。
- `promote_candidate` 只更新 candidate 主线状态，并记录 promotion reason。
- `deep_dive_candidate` 生成 candidate deep dive query。
- `verify_contradiction` 生成针对矛盾点的 verification query。
- `synthesize_workflow` 生成 internal analysis action，不再继续无效搜索。

`actions_planned` event 必须包含：

- `decisionAction`
- `decisionReason`
- `targetGapId`
- `queryRevisionStrategy`
- `expectedSignals`

### 4. Evaluate

每个 action 执行后，必须立即生成 `ActionOutcome`。

```ts
export type ActionOutcome = {
  actionId: string;
  actionType: ResearchAction["type"];
  status: "useful" | "weak" | "empty" | "failed";
  solvedGapIds: string[];
  newGapIds: string[];
  newCandidateIds: string[];
  newContradictionIds: string[];
  usefulSourceHashes: string[];
  weakReason?: string;
  nextClues: QueryClue[];
};
```

不能等整轮结束才泛泛评价。Apodex 的关键是搜索后立刻判断结果是否有用。

### 5. Replan

每个 cycle 末尾，主控把 `ResearchObservation`、`ResearchDecision`、`ActionOutcome[]` 写回 `ResearchState`。

下一轮 planner 必须使用上一轮 outcome：

```text
if previous action weak:
  next decision must reference weakReason or mark why not

if new candidate found:
  next decision must promote/reject or mark why deferred

if candidate promoted:
  next decision must deep-dive/compare/finalize or mark why not

if contradiction found:
  next decision must verify contradiction or mark as non-blocking

if gap remains:
  next decision must target a concrete gap, not broad taskKind template
```

## 新增状态类型

### EvidenceGap

```ts
export type EvidenceGap = {
  id: string;
  constraintId?: string;
  label: string;
  severity: "blocking" | "important" | "nice_to_have";
  status: "open" | "targeted" | "resolved" | "deferred";
  neededEvidence: string[];
  attemptedQueries: string[];
  failedReasons: string[];
  sourceFamiliesTried: SourceFamily[];
  createdAt: string;
  updatedAt: string;
};
```

### GapEvidenceLink

Observation 可以先生成 gap inventory，但不能在证据绑定完成前假装 gap 已解决。`GapEvidenceLink` 是证据和 gap 之间的唯一关闭依据。

```ts
export type GapEvidenceLink = {
  gapId: string;
  evidenceId: string;
  support: "direct" | "proxy" | "contradicted";
  reason: string;
  linkedAt: string;
};
```

规则：

- Phase 早期可以生成 open/targeted gap。
- 只有 `GapEvidenceLink.support = direct | proxy` 且符合该 gap 的 required source/evidence policy，才能把 gap 改成 resolved。
- `Observation` 不直接根据关键词命中关闭 gap。
- HS8542 的 customs/HS code evidence 不能关闭 EOL/HTF external verification gap。

### WeakSearchReason

```ts
export type WeakSearchReason = {
  id: string;
  batchId: string;
  actionId: string;
  query: string;
  reason:
    | "empty_results"
    | "low_signal_results"
    | "wrong_domain"
    | "too_broad"
    | "too_narrow"
    | "language_mismatch"
    | "provider_failure"
    | "candidate_not_found"
    | "source_family_missing";
  evidence: string;
  suggestedRevision: string[];
};
```

### QueryRevisionStrategy

```ts
export type QueryRevisionStrategy = {
  mode:
    | "add_exact_phrase"
    | "remove_overbroad_terms"
    | "add_source_family"
    | "add_candidate_alias"
    | "switch_entity"
    | "use_negative_terms"
    | "try_database_terms"
    | "try_official_terms";
  beforeQueries: string[];
  afterQueries: string[];
  reason: string;
};
```

### SourceFamily

```ts
export type SourceFamily =
  | "official"
  | "newsroom"
  | "profile"
  | "database"
  | "directory"
  | "trade_data"
  | "government"
  | "standards"
  | "forum"
  | "marketplace"
  | "documentation";
```

## 模块职责修正

### Planner

旧职责：

```text
根据 taskKind + state 生成下一批 actions
```

新职责：

```text
根据 Observation + Decision 生成动作
```

Planner 不应该直接决定“现在该干什么”。决定由 `DecisionEngine` 做，Planner 负责把决定落成 action。

`promote_candidate` 与 `deep_dive_candidate` 必须分离：

- `promote_candidate` 是状态转换，表示候选进入主线。
- `deep_dive_candidate` 是行动决策，表示下一步围绕候选补证据。

### Evaluator

旧职责：

```text
决定 continue/finalize/fail
```

新职责：

```text
生成 observation
判断 action outcome
维护 evidence gaps / contradictions / weak searches
给 DecisionEngine 提供事实
```

### EvidenceExtractor

旧职责：

```text
从 sources 抽 evidence/candidates/queryClues
```

新职责：

```text
抽 evidence/candidates/queryClues
标记 evidence 支撑哪个 constraint/gap
标记 source 是否真正解决 gap
发现 contradiction 和 new gaps
```

### Orchestrator

旧循环：

```text
plan actions
-> run actions
-> extract evidence
-> evaluate state
```

新循环：

```text
observe
-> decide
-> plan actions
-> run action
-> evaluate action outcome
-> update state
-> replan
```

### Finalizer

Finalizer 只负责表达，不负责补逻辑。

规则：

- 不允许自己补搜索。
- 不允许把没有 source 的推断写成事实。
- 不允许用 taskKind 模板填满报告。
- 必须引用 `DecisionTrace` 说明为什么这是最大可能答案或最大可能路径。

## 事件与 UI 合同

新增事件：

```ts
| { type: "observation_reported"; observation: ResearchObservation; ... }
| { type: "research_decision_made"; decision: ResearchDecision; ... }
| { type: "action_outcome_reported"; outcome: ActionOutcome; ... }
| { type: "gap_opened"; gap: EvidenceGap; ... }
| { type: "gap_resolved"; gapId: string; evidenceIds: string[]; ... }
| { type: "weak_search_diagnosed"; weakSearch: WeakSearchReason; ... }
| { type: "query_revised"; strategy: QueryRevisionStrategy; ... }
| { type: "contradiction_found"; contradiction: Contradiction; ... }
| { type: "turn_feedback_received"; feedback: TurnFeedback; ... }
| { type: "frame_revised"; previousFrameId: string; frame: ResearchFrame; reason: string; ... }
```

UI 必须显示研究过程，而不是只显示结果：

```text
Cycle 1
  Observation: 当前最大缺口是什么
  Decision: 为什么要这样搜
  Action: 搜索 query / engine / result
  Outcome: 有用还是弱，解决了哪个 gap
  Replan: 下一轮为什么改变
```

## Apodex 对齐标准

### Grace / Andromeda

必须看到：

- broad search 弱在哪里。
- 如何从弱结果改 query。
- Grace/Andromeda 何时进入 candidate pool。
- 为什么缺少 30% 增长不直接失败。
- 哪些 proxy growth evidence 被接受。

### Cloudflare DNS

必须看到：

- 初始成功标准是什么。
- 用户挑战后如何发现 hidden criterion。
- PSL / NS delegation 如何变成 hard constraints。
- 旧建议如何被重新核验和纠正。

### Multi-turn / User Challenge

Apodex 的 Cloudflare 和 distributor duplicate 样本不是单 turn 能覆盖的。主循环必须支持用户反馈进入下一轮：

```text
previous ResearchState
-> user feedback/challenge
-> TurnFeedback
-> FrameRevision
-> carry over candidates/evidence/gaps
-> re-evaluate prior decisions
-> plan next decision
```

新增类型：

```ts
export type TurnFeedback = {
  turnId: string;
  previousTurnId: string;
  feedbackKind: "challenge" | "scope_expand" | "correction" | "follow_up";
  userMessage: string;
  affectedDecisionIds: string[];
  affectedGapIds: string[];
};
```

规则：

- 用户挑战不能当作新独立 prompt 处理。
- 新 turn 必须继承上一轮 state summary。
- 如果反馈推翻 success criteria，必须写 `frame_revised`。
- 如果反馈只扩大范围，必须保留旧 evidence，同时新增 source strategy gaps。
- 旧 final/decision 中被挑战的部分必须重新进入 open/targeted 状态。

### Distributor

必须看到：

- 第一次来源不足时如何拓展 source families。
- 区域/目录/B2B/展会/海关数据如何作为不同 source strategy。
- 去重和市场天花板为什么出现。

### HS8542

必须看到：

- HS code/customs data 解决了哪些 gap。
- 哪些 gap 不能由 HS code 解决。
- EOL/HTF 为什么需要 external verification。
- workflow draft/critique/revision 不是固定模板，而是由 evidence gaps 推出来。

## Acceptance Criteria

1. 每个 cycle 都有 `observation_reported`。
2. 每个 cycle 都有 `research_decision_made`。
3. 每个 executed action 都有 `action_outcome_reported`。
4. 弱搜索必须生成 `weak_search_diagnosed`，除非 provider 全失败。
5. revised query 必须引用具体 weak search 或 evidence gap。
6. candidate deep dive 必须引用 candidate promotion reason。
7. workflow synthesis 必须引用已解决/未解决 gaps。
8. final report 必须引用 decision trace，而不是只引用 evidence list。
9. HS8542 不能只靠 finalizer 生成固定表结构，必须在 state 中有 workflow/gap trace。
10. Grace/Andromeda 必须展示 candidate promotion 和 proxy evidence 逻辑。
11. 9 个 Apodex scenario tests 必须覆盖主流程 trace，而不只是终稿字符串。
12. Multi-turn/user challenge 必须有 state carryover、frame revision、prior decision re-evaluation。
13. `npm run test`、`npm run lint`、`npm run build` 通过。

## 风险

最大风险是继续把问题修在 finalizer。

禁止路径：

```text
发现某个样本不像 Apodex
-> 给 finalizer 加 if taskKind
-> 终稿更像
-> 主流程仍然没变
```

正确路径：

```text
发现某个样本不像 Apodex
-> 找 trace 中少了哪类 observation/decision/outcome
-> 修 Planner/Evaluator/EvidenceGapLoop
-> 让 finalizer 只是表达已有 state
```
