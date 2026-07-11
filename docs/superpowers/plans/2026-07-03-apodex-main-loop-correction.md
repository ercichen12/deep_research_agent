# Apodex Main Loop 修正版 Implementation Plan

> 目标：修正 Graph Heavy 的主流程问题。不要继续直接修 finalizer 文案。实现重点是 `observe -> decide -> act -> evaluate -> replan` 动态研究循环。

## 当前判定

gstack `/plan-eng-review` 判断：

```text
STATUS: DONE_WITH_CONCERNS
REASON: 当前问题是架构规划没有锁住动态研究循环，导致实现变成 graph 外壳 + 类型模板 + finalizer 补强。
RECOMMENDATION: 先补一份流程主逻辑修正版 design/implementation plan，再改代码。不要继续直接修 final 输出。
```

本计划对应设计文档：

- `docs/superpowers/specs/2026-07-03-apodex-main-loop-correction-design.md`

## 原则

1. 先修主循环，不修 final 文案。
2. 每个样本是否像 Apodex，先看 trace，不先看终稿。
3. 每个 cycle 必须有 observation、decision、action outcome。
4. Planner 不能直接按 taskKind 套模板，必须吃 decision。
5. Evaluator 不能只输出 continue/finalize，必须维护 gaps、weak searches、contradictions。
6. EvidenceExtractor 不只抽 evidence，还要标记 evidence 解决了哪个 gap。
7. Finalizer 只能表达 state，不能创造流程。

## Phase 0: 锁定失败基线

本阶段必须覆盖三类 Apodex 主流程，不允许只看 HS8542。

- [ ] 读取最新 HS8542 browser benchmark：
  - `research-runs/graph-state/turn_mr4atiid_fc9ec182.json`
  - `.gstack/qa-reports/apodex-parity-2026-07-03/hs8542-fanout-browser-benchmark.json`
- [ ] 读取或重跑 Grace/Andromeda 样本 trace：
  - 目标：确认当前是否缺 candidate promotion、candidate deep dive、proxy growth。
- [ ] 读取或重跑 Cloudflare DNS 样本 trace：
  - 目标：确认当前是否缺 hidden criterion、user challenge、frame revision、prior decision re-evaluation。
- [ ] 写三个 trace audit 小结：
  1. Grace/Andromeda：候选推进失败基线。
  2. Cloudflare DNS：多 turn / 用户挑战失败基线。
  3. HS8542：workflow gap trace 失败基线。
- [ ] 每个 audit 都确认当前缺少：
  - observation trace
  - decision reason trace
  - action outcome trace
  - weak search diagnosis
  - gap transition
  - 如果是 Cloudflare，还必须确认是否缺 `TurnFeedback -> FrameRevision -> StateCarryover`。
- [ ] 不修改代码，只形成基线报告。

验收：

- 能明确指出三类样本当前流程哪里不像 Apodex。
- 不用 final report 质量作为主证据。

## Phase 1: 类型和状态模型

新增或扩展 `lib/heavy/graph/types.ts`。

- [ ] 新增 `ResearchObservation`。
- [ ] 新增 `ResearchDecision`。
- [ ] 新增 `ActionOutcome`。
- [ ] 新增 `EvidenceGap`。
- [ ] 新增 `GapEvidenceLink`。
- [ ] 新增 `WeakSearchReason`。
- [ ] 新增 `QueryRevisionStrategy`。
- [ ] 新增 `Contradiction`。
- [ ] 新增 `SourceFamily`。
- [ ] 新增 `TurnFeedback`。
- [ ] 扩展 `ResearchState`：
  - `observations`
  - `decisions`
  - `actionOutcomes`
  - `evidenceGaps`
  - `gapEvidenceLinks`
  - `weakSearches`
  - `contradictions`
  - `turnFeedback`
  - `frameRevisions`
- [ ] 为所有新类型写 normalizer，坏数据过滤，不能让 Turn 崩掉。

测试：

- [ ] `tests/heavy-graph-main-loop-types.test.ts`
  - bad gap 被过滤。
  - bad decision fallback。
  - action outcome 保留有效 source/gap/candidate refs。
- [ ] `tests/heavy-graph-trace-contracts.test.ts`
  - 建立 9 个 Apodex trace contract fixture，第一版可以 pending/expected-fail 标记，但文件和断言结构必须先有。
  - 每个 fixture 至少声明需要哪些 event/state trace，不只声明 final markdown。

验收：

- 类型能表达“为什么搜、为什么弱、下一步为什么改”。
- 9 样本 trace contract 前移建立，不等 Phase 10 才补。

## Phase 2: Initial Observation Builder + Gap Inventory

新增 `lib/heavy/graph/observation.ts`。

- [ ] 从 `ResearchState` 生成 `ResearchObservation`。
- [ ] 汇总当前 hard constraints direct/proxy/missing。
- [ ] 汇总 candidate 状态。
- [ ] 汇总最近 search batch outcome。
- [ ] 识别 open evidence gaps。
- [ ] 识别 weak searches。
- [ ] 识别 contradiction。
- [ ] 生成 budget snapshot。
- [ ] 只生成 gap inventory 和 gap status proposal，不直接关闭 gap。

规则：

- 没有 evidence 的 hard constraint 必须生成 gap。
- weak search 必须有原因，不允许只标 weak。
- provider error 和 low-signal result 要分开。
- HS8542 中 EOL/HTF 必须生成 external verification gap，不能被 HS code evidence 解决。
- Observation 不能只因关键词命中把 gap 标为 resolved。
- gap resolved 必须等待 Phase 6 的 `GapEvidenceLink`。

测试：

- [ ] HS8542：customs evidence 不能关闭 EOL/HTF gap。
- [ ] Grace：缺 30% growth 是 soft gap，不是 blocking。
- [ ] Cloudflare：PSL/NS delegation 缺失是 blocking gap。

验收：

- 每个 cycle 开始都能得到一张“当前研究局面”。
- 这一阶段只能打开/定位 gap，不能最终关闭 gap。

## Phase 3: Decision Engine

新增 `lib/heavy/graph/decision-engine.ts`。

- [ ] 输入 `ResearchObservation`，输出 `ResearchDecision`。
- [ ] 实现优先级：
  1. contradiction blocking -> `verify_contradiction`
  2. new candidate 满足稀缺条件 -> `promote_candidate`
  3. promoted candidate 缺关键证据 -> `deep_dive_candidate`
  4. blocking gap + weak search -> `revise_query`
  5. blocking gap + source family 不足 -> `broaden_sources`
  6. 多候选 -> `compare_candidates`
  7. workflow evidence/gap 足够 -> `synthesize_workflow`
  8. 证据足够或预算将尽 -> `finalize`
  9. 无证据且预算耗尽 -> `fail`
- [ ] 每个 decision 必须有 `reason`。
- [ ] `revise_query` 必须带 `QueryRevisionStrategy`。
- [ ] `promote_candidate` 不生成搜索 action，只做主线状态转换。
- [ ] `deep_dive_candidate` 才生成候选补证据 action。

测试：

- [ ] weak search 后必须输出 revise_query。
- [ ] candidate found 后不能继续 broad search，必须 promote/reject/defer。
- [ ] candidate promoted 后必须 deep_dive/compare/finalize。
- [ ] contradiction blocking 优先于 final。
- [ ] workflow 不因有一点 evidence 就直接 revision，必须看 gap 是否足够。

验收：

- 决策不是 taskKind 模板，而是由 gap/outcome 驱动。

## Phase 4: Planner 改造

修改 `lib/heavy/graph/planner.ts`。

- [ ] Planner 不再直接决定下一步。
- [ ] Planner 接收 `ResearchDecision`。
- [ ] `revise_query` 生成具体英文 query，并记录 before/after。
- [ ] `broaden_sources` 按 source family 生成 query。
- [ ] `promote_candidate` 只生成 candidate state transition event。
- [ ] `deep_dive_candidate` 生成 candidate deep dive。
- [ ] `verify_contradiction` 生成 contradiction verification query。
- [ ] `synthesize_workflow` 生成 analysis action。
- [ ] 保留 taskKind 只作为 query vocabulary，不作为流程控制器。

测试：

- [ ] Planner 对同一个 taskKind，在不同 decision 下生成不同 action。
- [ ] revised query 必须引用 weak search/gap。
- [ ] HS8542 的 workflow synthesis 只在 decision 为 synthesize_workflow 时出现。

验收：

- 看代码能确认：流程控制权从 taskKind 模板迁移到 decision。

## Phase 5: Executor / Outcome

修改 `lib/heavy/graph/executor.ts` 和 `graph-orchestrator.ts`。

- [ ] 每个 action 执行后生成 `ActionOutcome`。
- [ ] search action outcome 必须包含：
  - useful/weak/empty/failed
  - solvedGapIds
  - newGapIds
  - usefulSourceHashes
  - weakReason
  - nextClues
- [ ] read/source outcome 必须标记哪些 source 真正有用。
- [ ] provider failure 不等于 weak search，必须单独记录。
- [ ] action outcome 写入 state 和 NDJSON。

测试：

- [ ] search 返回 0 -> outcome empty + weak_search_diagnosed。
- [ ] search 返回泛 CDP 页面 -> outcome weak/wrong_domain。
- [ ] search 返回 trade/customs source -> outcome useful + solved gap。
- [ ] provider error 但 Bing 有结果 -> action 不 failed。

验收：

- 每个 action 后都能解释“有没有用、解决了什么、没解决什么”。

## Phase 6: EvidenceExtractor Gap Binding

修改 `lib/heavy/graph/evidence-extractor.ts`。

- [ ] 每条 evidence 绑定 constraint/gap。
- [ ] 生成 `GapEvidenceLink`。
- [ ] evidence 不能解决不支持的 gap。
- [ ] 抽取 new gaps。
- [ ] 抽取 contradictions。
- [ ] 抽取 query clues。

关键规则：

- HS code/customs data 可以支持 trade-flow/customer-segmentation。
- HS code/customs data 不能单独支持 EOL/HTF。
- Grace 的 funding/expansion 可以作为 proxy growth，但不能当成 direct 30% growth。
- Cloudflare 的普通 DNS 支持不能替代 PSL/NS delegation。

测试：

- [ ] HS8542 customs source 不关闭 EOL/HTF external verification gap。
- [ ] Grace proxy growth 进入 proxy evidence。
- [ ] Cloudflare hidden criterion 缺失时生成 gap。

验收：

- Evidence 不再只是“发现了什么”，而是“解决了哪个问题”。
- 从这一阶段开始，gap 才允许基于 `GapEvidenceLink` 进入 resolved。

## Phase 6.5: Multi-turn / User Challenge

新增或修改 inquiry/turn state carryover 逻辑。

- [ ] 新增 `TurnFeedback` 识别：
  - `challenge`
  - `scope_expand`
  - `correction`
  - `follow_up`
- [ ] 新 turn 创建时可读取 previous turn 的 graph state summary。
- [ ] 用户挑战时生成 `frame_revised`，不能当成全新无上下文 prompt。
- [ ] scope expand 时保留旧 evidence/candidates/gaps，并新增 source strategy gaps。
- [ ] 被挑战的 prior decision 必须重新评估：
  - 可保留
  - contradicted
  - needs_research
  - superseded
- [ ] 写事件：
  - `turn_feedback_received`
  - `frame_revised`
  - `prior_decision_reopened`

测试：

- [ ] Cloudflare 用户挑战后，PSL/NS delegation 进入 hard constraints。
- [ ] Distributor duplicate/scope expand 后，继承旧 state 并新增 data-source strategy gaps。
- [ ] 用户 follow-up 不丢失上一轮 candidate/evidence。

验收：

- 多 turn 样本不再被当成互不相关的新任务。

## Phase 7: Orchestrator 主循环改造

修改 `lib/heavy/graph/graph-orchestrator.ts`。

旧循环：

```text
plan actions
-> run search
-> extract evidence
-> evaluate state
```

新循环：

```text
build observation
-> make decision
-> plan actions from decision
-> run action
-> extract evidence
-> evaluate action outcome
-> update gaps/candidates/contradictions
-> persist state/events
-> repeat
```

- [ ] 每 cycle 写 `observation_reported`。
- [ ] 每 cycle 写 `research_decision_made`。
- [ ] 每 action 写 `action_outcome_reported`。
- [ ] weak search 写 `weak_search_diagnosed`。
- [ ] revised query 写 `query_revised`。
- [ ] gap 状态变化写 `gap_opened/gap_resolved`。
- [ ] final 前必须有至少一个 decision trace。
- [ ] gap resolved 只能由 `GapEvidenceLink` 驱动，不能由 Observation 直接关闭。
- [ ] 多 turn 时必须先处理 `TurnFeedback/FrameRevision/StateCarryover`，再进入 observe。

测试：

- [ ] mock weak search -> next cycle revised query。
- [ ] mock candidate found -> next cycle candidate deep dive。
- [ ] mock contradiction -> next cycle verification branch。
- [ ] mock workflow gaps resolved -> synthesize workflow。

验收：

- 日志能还原 Apodex-like research process。

## Phase 8: UI Trace 展示

修改 `app/page.tsx`。

- [ ] 新增 Main Loop Timeline：
  - Observation
  - Decision
  - Action
  - Outcome
  - Replan
- [ ] 展示 weak search reason。
- [ ] 展示 query before/after。
- [ ] 展示 evidence gaps open/resolved/deferred。
- [ ] 展示 candidate promotion reason。
- [ ] 展示 contradiction branch。

测试：

- [ ] UI 能从 mock inquiry 渲染 decision reason。
- [ ] UI 能显示 query revision。
- [ ] UI 能显示 gap resolved。
- [ ] UI 能显示 weak search diagnosis。

验收：

- 用户能看懂每一步为什么这么走，而不只是看到一堆 source。

## Phase 9: Finalizer 降权

修改 `lib/heavy/graph/finalizer.ts`。

- [ ] Finalizer 不再负责创造 workflow 结构。
- [ ] Finalizer 必须读取 `decision trace`。
- [ ] Finalizer 必须列出：
  - 最终 decision reason
  - 已解决 gaps
  - deferred gaps
  - contradiction handling
  - source-backed facts
- [ ] 移除或减少 taskKind-specific 兜底模板。

测试：

- [ ] 没有 decision trace 时 finalizer 输出低置信报告。
- [ ] 没有 source 的 claim 不写成事实。
- [ ] HS8542 表结构必须来自 state artifact/gap trace，而不是 finalizer 硬编码。

验收：

- Finalizer 只是表达流程结果，不是流程本身。

## Phase 10: 9 样本流程验收

本阶段不是第一次创建 9 样本测试。Phase 1 已经建立 trace contract fixture，本阶段负责让全部 contract 通过。

重点不是终稿字符串，而是 trace。

- [ ] Grace / Andromeda：
  - weak search -> revised query
  - candidate promotion
  - proxy growth evidence
- [ ] Website finding：
  - clue extraction
  - query recombination
  - candidate website verification
- [ ] Cloudflare DNS：
  - hidden criterion gap
  - contradiction/user challenge branch
  - PSL/NS delegation verification
- [ ] Distributor expansion：
  - source family broadening
  - region/type split
  - dedupe/sample verification
- [ ] Hong Kong EOL seller：
  - seller constraints
  - channel exclusion
  - phased path
- [ ] HS8542 90b378a3：
  - customs gap solved
  - EOL/HTF gap deferred/external verification
  - workflow synthesis from resolved gaps
- [ ] HS8542 linear：
  - ordered gates from decision trace
- [ ] HS8542 short：
  - short prompt still creates gaps/boundaries
- [ ] Distributor duplicate challenge：
  - multi-turn state inheritance
  - data-source strategy re-estimation

验收：

- 9 个 scenario tests 不只检查 final markdown，还检查 events/state trace。

## Phase 11: 真实浏览器 QA

- [ ] 先跑 Grace/Andromeda。
- [ ] 再跑 HS8542。
- [ ] 再跑 Cloudflare DNS。
- [ ] 每次保存：
  - inquiry JSON
  - graph-state JSON
  - event log
  - screenshot
  - benchmark JSON
  - trace audit markdown

验收：

- 用户能在 UI 中看到 Apodex-like research process。
- 不再需要通过 final report 猜测系统怎么推理。

## 最终验证

- [ ] `npm run test`
- [ ] `npm run lint`
- [ ] `npm run build`

## 完成定义

这次完成不是“某个样本输出更像”。

完成定义是：

```text
每个研究任务都有可审计的动态决策链：
observe -> decide -> act -> evaluate -> replan
```

并且：

- 弱搜索会导致明确 query revision。
- 候选出现会导致 candidate branch。
- 矛盾出现会导致 verification branch。
- workflow 输出来自 gaps/evidence trace。
- finalizer 不再承担主流程修补职责。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | 未运行 |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | not run | 未运行 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | clean | 0 unresolved, 0 critical gaps, 0 blocking issues |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | not run | 后续 UI trace 阶段再跑 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | 非当前阶段 |

- **VERDICT:** ENG CLEARED — 可以进入实现。实现时必须按 Phase 0 开始，不允许跳到 finalizer/UI。

**Eng Review Final Confirmation**

1. **三样本失败基线已锁定。**
   Phase 0 覆盖 Grace/Andromeda、Cloudflare DNS、HS8542，能防止只优化 workflow 类任务。

2. **Multi-turn / User Challenge 已纳入主流程。**
   Phase 6.5 明确 `TurnFeedback -> FrameRevision -> StateCarryover -> Re-evaluate prior decisions`，覆盖 Cloudflare 和 distributor duplicate 的关键行为。

3. **candidate promotion 与 deep dive 已拆分。**
   `promote_candidate` 是状态转换，`deep_dive_candidate` 才生成补证据 action，避免实现滑成状态标记。

4. **Observation 与 Gap Binding 的依赖顺序已修正。**
   Phase 2 只做 gap inventory；Phase 6 引入 `GapEvidenceLink` 后才允许 resolved，避免 Observation 误关 gap。

5. **9 样本 trace contract 已前移。**
   Phase 1 建立 `tests/heavy-graph-trace-contracts.test.ts`，Phase 10 负责全部通过，避免最后才发现样本缺口。

**Implementation Gate**

可以进入实现，但必须从 Phase 0 trace audit 开始。禁止直接修 finalizer、UI 或单个样本文案。

NO UNRESOLVED DECISIONS
