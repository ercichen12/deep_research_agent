# Apodex Heavy Replica Design

## 目标

把当前 `Deep Research MVP` 从单次研究流程重构成一个内部可用的 Apodex Heavy 类产品。

这里的“复刻”不是复制 Apodex 的品牌、代码或外观细节，而是复刻它的核心运行逻辑：

```text
用户问题
-> 主控理解和拆解
-> 多个子 Agent 独立研究或分析
-> 收集子报告
-> 核验 Agent 挑错和补缺
-> 必要时继续下一轮 Run
-> 终稿 Agent 生成最终报告
-> UI 展示 Run、Agent、核验、终稿和来源
```

产品可以先粗糙，但底层运行链路必须真实。不能用假 Agent、假并行、假报告或写死流程来冒充 Apodex Heavy。

## 从 Apodex 样本提取的主逻辑

三条样本呈现出两个层级的运行方式。

第一类是 Deep Solve 模式。它更像单主控 ReAct 流程：

```text
理解问题
-> 尝试打开原始链接
-> 遇到访问限制
-> 改写搜索词
-> 搜索
-> 选中来源
-> 读取网页
-> 再搜索
-> 交叉验证
-> 写出证据链报告
```

第二类是 Apodex Heavy 模式。它是我们要重点复刻的模式。样本中的 Heavy 任务展示了：

```text
已完成思考
运行时长
研究 / 校验 / 撰写
Run 1 ... Run 8
派发多角色 Agent
派发核验 Agent
分析报告
调研报告
最终核验
终稿确认
子 Agent 活动
```

这说明 Heavy 不是单模型一次性回答，而是主控编排、多子 Agent、多轮 Run、独立核验、最终合成。

第二条样本的 Run 1 明确派发了 4 个子任务：

```text
data-cleaning_research
peer-identification_research
customer-grading_research
data-architecture_analyze
```

后续 Run 会根据任务需要调整子 Agent 数量和类型，说明它不是固定模板，而是动态编排。

## 设计原则

1. 真实主控  
   系统必须先由主控理解用户需求并拆解任务，不能直接进入搜索和报告生成。

2. 真实子 Agent  
   每个 AgentTask 必须有自己的目标、输入、搜索、来源、报告和不确定项。

3. 真实核验  
   Verifier 不是摘要器，而是挑错器。它必须指出证据不足、来源不支持、结论冲突和需要补查的任务。

4. 真实多轮 Run  
   如果核验发现关键缺口，系统必须能开启下一轮 Run，而不是在原报告上补一句。

5. 终稿只基于证据  
   FinalReport 只能引用 AgentReport 和 VerificationReport 中已有的事实和来源。终稿 Agent 不应自行编造新事实。

6. UI 展示真实数据  
   Run、Agent、报告、核验、耗时、来源都必须来自真实运行记录，不能写死。

## 非目标

第一版不做以下内容：

- Deep Solve 模式的新实现。第一版只实现 Heavy 模式。现有 Deep Solve 代码可以保留为旧入口或后续兼容层，但不作为本次复刻主线。
- 登录和多用户权限
- 计费和 credits
- 云端部署
- 完整项目/文件夹管理
- 浏览器外部扩展授权
- 和 Apodex 一样的品牌视觉

这些不是运行主逻辑的核心。第一版内部产品优先保证真实执行、可追溯、可复用。

## 核心数据模型

### Inquiry

一次探究主题，相当于 Apodex 分享页的顶层对象。

```ts
type Inquiry = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running" | "completed" | "failed";
  turns: Turn[];
};
```

### Turn

用户的一次提问和系统的一次或多次回答。

```ts
type Turn = {
  id: string;
  inquiryId: string;
  userPrompt: string;
  attachments: Attachment[];
  mode: "deep_solve" | "heavy";
  createdAt: string;
  status: "planning" | "researching" | "verifying" | "writing" | "completed" | "failed";
  runs: ResearchRun[];
  finalReport?: FinalReport;
};
```

### ResearchRun

一次主控执行轮次。Heavy 模式可以有多个 Run。

```ts
type ResearchRun = {
  id: string;
  turnId: string;
  index: number;
  goal: string;
  startedAt: string;
  completedAt?: string;
  status: "planned" | "running" | "verifying" | "completed" | "failed";
  coordinatorPlan: CoordinatorPlan;
  agentTasks: AgentTask[];
  agentReports: AgentReport[];
  verificationReport?: VerificationReport;
  decision: RunDecision;
};
```

### CoordinatorPlan

主控对当前 Run 的计划。

```ts
type CoordinatorPlan = {
  taskType: string;
  objective: string;
  decompositionRationale: string;
  tasks: PlannedAgentTask[];
  evidenceRequirements: string[];
  stopCriteria: string[];
};
```

### AgentTask

主控派发给子 Agent 的任务。

```ts
type AgentTask = {
  id: string;
  runId: string;
  role: string;
  title: string;
  prompt: string;
  objective: string;
  evidenceRequirements: string[];
  status: "queued" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
};
```

### AgentReport

子 Agent 独立产出的结构化报告。

```ts
type AgentReport = {
  id: string;
  taskId: string;
  role: string;
  title: string;
  summary: string;
  findings: Finding[];
  sources: ResearchSource[];
  unknowns: string[];
  confidence: "low" | "medium" | "high";
  rawReportMarkdown: string;
};
```

### Finding

报告中的单条结论，必须绑定来源或明确标记无证据。

```ts
type Finding = {
  claim: string;
  evidence: string;
  sourceUrls: string[];
  confidence: "low" | "medium" | "high";
};
```

### VerificationReport

核验 Agent 输出。

```ts
type VerificationReport = {
  id: string;
  runId: string;
  verdict: "pass" | "needs_more_research" | "failed";
  summary: string;
  issues: VerificationIssue[];
  missingEvidence: string[];
  contradictions: string[];
  recommendedNextTasks: PlannedAgentTask[];
  rawReportMarkdown: string;
};
```

### RunDecision

主控在核验后做出的决定。

```ts
type RunDecision = {
  action: "continue" | "write_final" | "stop_failed";
  reason: string;
  nextRunGoal?: string;
};
```

### FinalReport

终稿 Agent 输出。

```ts
type FinalReport = {
  id: string;
  turnId: string;
  model: string;
  title: string;
  conclusion: string;
  markdown: string;
  citedSourceUrls: string[];
  unresolvedQuestions: string[];
  generatedAt: string;
};
```

## 后端运行流程

### 1. 创建 Inquiry 和 Turn

用户提交问题后，系统创建 Inquiry 和 Turn。

如果用户在已有 Inquiry 内继续提问，则只新增 Turn。

### 2. 主控生成 Run 1 计划

Coordinator 读取用户问题、附件和历史上下文，输出 CoordinatorPlan。

主控提示词要求：

```text
你是研究主控，不直接回答用户。
你的任务是把用户问题拆成可以独立执行的 AgentTask。
每个任务必须有清晰目标、证据要求和输出格式。
不要生成最终答案。
```

找人找公司的典型拆解：

```text
identity_research
company_fit_research
growth_signal_research
leadership_tenure_research
article_or_opinion_research
exclusion_check
source_crosscheck
```

数据方案类任务的典型拆解：

```text
data_cleaning_research
entity_resolution_analyze
peer_identification_research
customer_grading_analyze
storage_architecture_analyze
workflow_risk_verification
```

主控可以动态增减任务，不能只套固定模板。

### 3. 执行 AgentTask

每个 AgentTask 都运行完整研究流程：

```text
理解任务
-> 生成搜索查询
-> 搜索
-> 读取来源
-> 提取证据
-> 输出 AgentReport
```

Agent 不能写最终综合报告，只能回答自己的子任务。

Agent 输出必须包含：

- summary
- findings
- sources
- unknowns
- confidence
- rawReportMarkdown

### 搜索接入策略

第一版搜索优先使用 relay provider：

```text
SEARCH_PROVIDER=relay
SEARCH_RELAY_URL=https://ai.input.im/v1/responses
```

本地 OpenCLI 搜索保留为备选能力。实现时按速度和稳定性选择优先级：

```text
优先：relay
备选：OpenCLI
兜底：已有 searchWeb / fetchSource 能力
```

如果 relay 在当前环境下响应更快且结果质量足够，就作为默认搜索入口。如果 relay 慢、失败或结果为空，则自动切到 OpenCLI。搜索失败不应直接终止 AgentTask，必须把失败写入 AgentReport 的 unknowns 或运行日志，并继续尝试备选来源。

### 4. 主控收集子报告

Run 内所有 AgentTask 完成后，主控收集 AgentReport。

如果某个子 Agent 失败，Run 不立即失败，而是记录失败，并交给核验 Agent 判断是否必须补查。

### 5. 核验 Agent 挑错

Verifier 读取：

- 用户原问题
- CoordinatorPlan
- 所有 AgentReport
- 所有来源

Verifier 不写终稿，只输出核验报告。

核验提示词要求：

```text
你是核验 Agent。你的任务是找错，不是润色。
请检查每个关键结论是否有来源支撑。
请指出冲突、缺口、过度推断和需要补查的问题。
如果证据不足，必须给出 recommendedNextTasks。
```

核验结果为：

```text
pass
needs_more_research
failed
```

### 6. 主控决定是否继续下一轮 Run

如果核验结果是 `needs_more_research`，主控根据 `recommendedNextTasks` 创建下一轮 Run。

下一轮 Run 必须有明确目标，例如：

```text
Run 2: 只核验候选人是否仍是现任 CEO
Run 3: 只查公司增长数据和排除行业
Run 4: 只查 AI 观点文章是否本人发表
```

停止条件：

- 核验通过
- 达到最大 Run 数
- 达到最大 Agent 数
- 达到最大耗时
- 达到成本预算
- 没有新的高价值补查任务

第一版默认：

```text
maxRuns = 3
maxAgentsPerRun = 6
maxTotalAgents = 14
maxSourcesPerAgent = 6
```

这些是默认配置，不是写死逻辑。后续内部使用时可以在环境变量或设置页中调整。

### 7. 终稿 Agent 写最终报告

只有当主控决定 `write_final` 时，才调用 Synthesizer。

Synthesizer 输入：

- 用户原问题
- 所有 Run 的 CoordinatorPlan
- 所有 AgentReport
- 所有 VerificationReport
- 所有来源

Synthesizer 规则：

```text
只使用输入材料中的事实。
每个关键判断必须引用来源。
证据不足必须写入不确定项。
不要把推测写成确定事实。
```

终稿结构：

```text
一句话结论
关键证据链
候选/对象对比
用户条件逐条核验
来源引用
不确定项
下一步建议
```

## API 设计

### POST /api/inquiries

创建 Inquiry 并启动第一轮 Turn。

请求：

```json
{
  "prompt": "...",
  "mode": "heavy",
  "attachments": []
}
```

响应：

```json
{
  "inquiryId": "...",
  "turnId": "..."
}
```

### POST /api/inquiries/:id/turns

在已有 Inquiry 内继续提问。

### GET /api/inquiries/:id

返回完整 Inquiry，包括 Turns、Runs、AgentReports、VerificationReports 和 FinalReport。

### GET /api/inquiries/:id/stream

返回 NDJSON 或 SSE，用于实时展示运行过程。

事件类型：

```text
turn_started
run_planned
agent_started
agent_reported
verification_started
verification_reported
run_decision
final_started
final_reported
turn_completed
error
```

## 本地存储设计

第一版内部产品使用文件存储，不一开始引入数据库。

推荐目录：

```text
research-runs/
  inquiries/
    {inquiryId}.json
  sources/
    {sourceHash}.json
  logs/
    {turnId}.ndjson
```

每次事件都追加写入 NDJSON，完整 Inquiry 定期落盘为 JSON。

这样做的好处：

- 易调试
- 易导出
- 不依赖数据库迁移
- 后续可迁移到 SQLite

当历史查询和全文搜索变重要时，再引入 SQLite FTS。

## 前端信息架构

第一版 UI 可以粗糙，但必须展示真实运行结构。

页面结构：

```text
左侧：本地 Inquiry 列表
主区：
  Inquiry 标题
  用户问题和附件
  模式、状态、耗时
  阶段条：研究 / 校验 / 撰写
  Run 列表
    Run 1
      派发 Agent
      Agent 报告
      核验报告
      Run 决策
    Run 2
      ...
  最终报告
  来源列表
```

Run 展开结构：

```text
Run 1 13m54s
  派发 多角色 Agent
    identity_research
    company_fit_research
    source_crosscheck
  调研报告
  分析报告
  最终核验
  终稿确认
```

最终报告需要 Markdown 渲染，支持：

- H1/H2/H3
- 表格
- 代码块
- 引用编号
- 复制代码块
- 来源链接

## 错误处理

### Agent 失败

单个 Agent 失败不立即终止 Turn。记录错误，交给 Verifier 判断是否必须补查。

### 搜索无结果

AgentReport 中写入 unknowns，并降低 confidence。

### 来源读取失败

保留搜索结果和读取错误，继续尝试其他来源。

### 核验失败

如果 Verifier 无法解析或失败，Run 标记为 `failed`，Turn 返回可读错误，并保留已完成的 AgentReport。

### 达到预算

如果达到 maxRuns 或 maxTotalAgents 仍未核验通过，Synthesizer 可以生成“未完全确认报告”，但必须显式标注不确定项。

## 测试策略

### 单元测试

- CoordinatorPlan JSON 解析和校验
- AgentReport JSON 解析和校验
- VerificationReport JSON 解析和校验
- RunDecision 规则
- 事件流 reducer
- 文件存储读写

### 集成测试

使用 mock model 和 mock search，验证：

```text
用户问题
-> 生成 Run 1
-> 派发多个 AgentTask
-> 生成多个 AgentReport
-> 核验发现缺口
-> 生成 Run 2
-> 核验通过
-> 生成 FinalReport
```

### 真实运行验证

用两个真实样本验证：

1. 找人找公司类任务  
   验证能拆身份、公司、任职、文章、排除项和证据链。

2. 数据方案类任务  
   验证能拆清洗、实体合并、同行识别、客户分级、存储架构和核验。

## 与当前代码的关系

当前已有模块可以复用：

- `lib/search.ts`
- `lib/source.ts`
- `lib/openai.ts`
- `lib/research-stream.ts`
- 部分 `lib/research-log.ts`

需要重构或替换：

- `lib/research.ts`  
  从单流程 orchestrator 改为 Inquiry/Run/Agent 编排入口。

- `lib/deep-research-loop.ts`  
  当前是单循环评估模型。可以保留为 Deep Solve 模式，但 Heavy 模式应新建独立 orchestrator。

- `app/page.tsx`  
  从调试面板改为 Inquiry 阅读器和运行控制台。

- `lib/types.ts`  
  扩展为 Inquiry、Turn、Run、AgentTask、AgentReport、VerificationReport、FinalReport。

建议新增：

```text
lib/heavy/types.ts
lib/heavy/coordinator.ts
lib/heavy/agent-runner.ts
lib/heavy/verifier.ts
lib/heavy/synthesizer.ts
lib/heavy/orchestrator.ts
lib/heavy/storage.ts
lib/heavy/events.ts
```

## 实现顺序

这里的顺序是施工顺序，不是“假功能阶段”。每一步都要真实可用。

### 第一步：真实数据模型和存储

先定义 Inquiry、Turn、Run、AgentTask、AgentReport、VerificationReport、FinalReport。

同时实现文件存储和事件日志。

验收标准：

```text
可以创建 Inquiry
可以创建 Turn
可以写入 Run
可以追加事件
可以重新读取完整 Inquiry
```

### 第二步：真实主控拆任务

实现 Coordinator，让它根据用户问题动态生成 CoordinatorPlan。

验收标准：

```text
找人任务和数据方案任务会生成不同 AgentTask
每个任务都有 role、objective、prompt、evidenceRequirements
Coordinator 不生成最终答案
```

### 第三步：真实子 Agent 执行

实现 AgentRunner。每个 AgentTask 独立搜索、读取来源并生成 AgentReport。

验收标准：

```text
每个 AgentTask 都有自己的 search logs
每个 AgentReport 都有 findings、sources、unknowns、confidence
不同 Agent 的报告内容不是同一个大报告切片
```

### 第四步：真实核验 Agent

实现 Verifier。它读取所有 AgentReport 并输出 VerificationReport。

验收标准：

```text
能指出无来源结论
能指出冲突
能指出缺口
能给 recommendedNextTasks
```

### 第五步：真实多 Run 循环

实现 HeavyOrchestrator 的 Run loop。

验收标准：

```text
核验 pass -> 写终稿
核验 needs_more_research -> 创建下一轮 Run
达到 maxRuns -> 生成带不确定项的报告或失败
```

### 第六步：真实终稿生成

实现 Synthesizer。它只基于 AgentReport 和 VerificationReport 生成最终 Markdown。

验收标准：

```text
最终报告有来源引用
关键判断能追溯到 AgentReport
不确定项被保留
```

### 第七步：UI 展示真实运行

重做页面为内部 Inquiry 控制台。

验收标准：

```text
能看到原始问题
能看到 Run 1 / Run 2
能展开 AgentTask
能展开 AgentReport
能看到 VerificationReport
能看到 FinalReport
能看到来源
```

### 第八步：内部产品化能力

补齐内部使用需要的能力：

```text
历史 Inquiry 列表
重新打开旧任务
导出报告
导出运行日志
失败重试
预算配置
模型配置
```

## 成功标准

这个设计完成后，一个内部用户应该能够：

1. 输入复杂找人、找公司或数据方案问题。
2. 看到系统真实拆成多个 AgentTask。
3. 看到每个 Agent 查了什么、引用了什么来源、得出了什么结论。
4. 看到核验 Agent 指出了哪些问题。
5. 如果证据不足，看到系统开启下一轮 Run。
6. 最终得到一份可追溯、可核查、带来源的 Markdown 报告。

如果只能看到最终报告，看不到真实 Run 和 Agent 活动，就不算完成。

如果 Run 和 Agent 活动是写死的，也不算完成。

如果核验只是润色摘要，也不算完成。

## 已确认的设计决策

1. 第一版只实现 Heavy 模式。
2. 第一版使用文件存储。
3. 默认预算采用 `maxRuns = 3`、`maxAgentsPerRun = 6`、`maxTotalAgents = 14`。
4. 搜索优先接入 relay：`SEARCH_PROVIDER=relay`，`SEARCH_RELAY_URL=https://ai.input.im/v1/responses`。
5. 本地 OpenCLI 作为搜索备选；实现时以速度和稳定性为准，快的优先，慢的备选。
