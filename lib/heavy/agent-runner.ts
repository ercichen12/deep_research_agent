import { createChatCompletion, getOpenAIConfig } from "@/lib/openai";
import { buildAgentQueries, runAdaptiveResearch } from "@/lib/heavy/adaptive-research";
import {
  compactError,
  normalizeAgentReport,
  type AgentResearchStep,
  type AgentReport,
  type AgentTask,
  type HeavyBudget,
  type HeavySearchProvider,
  type ReadAttemptLog,
  type SearchAttemptLog,
  type HeavySource
} from "@/lib/heavy/types";

export { buildAgentQueries } from "@/lib/heavy/adaptive-research";

export type AgentRunnerInput = {
  prompt: string;
  tasks: AgentTask[];
  provider: HeavySearchProvider;
  budget: HeavyBudget;
  onAgentStarted?: (task: AgentTask) => void | Promise<void>;
  onAgentResearchStep?: (task: AgentTask, step: AgentResearchStep) => void | Promise<void>;
  onAgentSearchLog?: (task: AgentTask, log: SearchAttemptLog) => void | Promise<void>;
  onAgentReadLog?: (task: AgentTask, log: ReadAttemptLog) => void | Promise<void>;
  onAgentReported?: (report: AgentReport) => void | Promise<void>;
};

export async function runAgentTasks(input: AgentRunnerInput): Promise<AgentReport[]> {
  const taskQueue = input.tasks.slice();
  const reports: AgentReport[] = [];
  const concurrency = Math.max(1, Math.min(input.budget.agentConcurrency, taskQueue.length || 1));
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < taskQueue.length) {
      const task = taskQueue[nextIndex];
      nextIndex += 1;

      try {
        await input.onAgentStarted?.(task);
      } catch (error) {
        const report = failedAgentReport(input.prompt, task, error, new Date().toISOString(), "Agent start hook failed.");
        reports.push(report);
        await notifyAgentReported(input.onAgentReported, report);
        continue;
      }

      const provider = input.provider.forkTrace?.() ?? input.provider;
      const report = await runSingleAgentTask(input.prompt, task, provider, input.budget, {
        onResearchStep: input.onAgentResearchStep,
        onSearchLog: input.onAgentSearchLog,
        onReadLog: input.onAgentReadLog
      });
      reports.push(report);
      await notifyAgentReported(input.onAgentReported, report);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return reports.sort((a, b) => input.tasks.findIndex((task) => task.id === a.taskId) - input.tasks.findIndex((task) => task.id === b.taskId));
}

export async function runSingleAgentTask(
  prompt: string,
  task: AgentTask,
  provider: HeavySearchProvider,
  budget: HeavyBudget,
  callbacks: {
    onResearchStep?: (task: AgentTask, step: AgentResearchStep) => void | Promise<void>;
    onSearchLog?: (task: AgentTask, log: SearchAttemptLog) => void | Promise<void>;
    onReadLog?: (task: AgentTask, log: ReadAttemptLog) => void | Promise<void>;
  } = {}
): Promise<AgentReport> {
  const startedAt = new Date().toISOString();
  try {
    const research = await runAdaptiveResearch({
      prompt,
      task,
      provider,
      budget,
      onStep: (step) => callbacks.onResearchStep?.(task, step),
      onSearchLog: (log) => callbacks.onSearchLog?.(task, log),
      onReadLog: (log) => callbacks.onReadLog?.(task, log)
    });

    const allSearchesFailed = didAllMeaningfulSearchAttemptsFail(research.searchLogs);
    if (research.sources.length === 0 && allSearchesFailed) {
      const searchErrorMessage = research.searchLogs.find((log) => log.status === "error")?.message ?? "Agent task failed";
      return normalizeAgentReport({
        taskId: task.id,
        agentId: `agent_${task.id}`,
        role: task.role,
        status: "failed",
        summary: `${task.title} 执行失败。`,
        queries: research.queries,
        searchLogs: research.searchLogs,
        readLogs: research.readLogs,
        researchSteps: research.researchSteps,
        sources: [],
        findings: [],
        error: compactError(searchErrorMessage),
        startedAt,
        completedAt: new Date().toISOString()
      });
    }

    const report = await generateAgentReport(prompt, task, research.queries, research.sources, research.researchSteps, startedAt);
    return normalizeAgentReport({
      ...report,
      searchLogs: research.searchLogs,
      readLogs: research.readLogs,
      researchSteps: research.researchSteps
    });
  } catch (error) {
    return normalizeAgentReport({
      taskId: task.id,
      agentId: `agent_${task.id}`,
      role: task.role,
      status: "failed",
      summary: `${task.title} 执行失败。`,
      queries: buildAgentQueries(prompt, task).slice(0, 2),
      searchLogs: [],
      readLogs: [],
      researchSteps: [
        {
          id: "step_1",
          type: "finalize",
          title: "Agent 执行失败",
          detail: "The agent failed before completing adaptive research.",
          decision: "stop",
          reason: compactError(error instanceof Error ? error.message : "Agent task failed"),
          timestamp: new Date().toISOString()
        }
      ],
      sources: [],
      findings: [],
      error: compactError(error instanceof Error ? error.message : "Agent task failed"),
      startedAt,
      completedAt: new Date().toISOString()
    });
  }
}

function didAllMeaningfulSearchAttemptsFail(searchLogs: SearchAttemptLog[]): boolean {
  const hasProviderTrace = searchLogs.some((log) => log.provider !== "test");
  const meaningfulLogs = hasProviderTrace
    ? searchLogs.filter((log) => !isLocalEmptyWrapperLog(log))
    : searchLogs;

  return meaningfulLogs.length > 0 && meaningfulLogs.every((log) => log.status === "error");
}

function isLocalEmptyWrapperLog(log: SearchAttemptLog): boolean {
  return log.provider === "test" && log.status === "empty" && log.results.length === 0 && !log.message;
}

async function notifyAgentReported(
  onAgentReported: AgentRunnerInput["onAgentReported"],
  report: AgentReport
): Promise<void> {
  try {
    await onAgentReported?.(report);
  } catch {
    // Reporting hooks are observational; a hook failure should not drop queued agent work.
  }
}

function failedAgentReport(
  prompt: string,
  task: AgentTask,
  error: unknown,
  startedAt: string,
  detail: string
): AgentReport {
  const message = compactError(error instanceof Error ? error.message : "Agent task failed");
  return normalizeAgentReport({
    taskId: task.id,
    agentId: `agent_${task.id}`,
    role: task.role,
    status: "failed",
    summary: `${task.title} 执行失败。`,
    queries: buildAgentQueries(prompt, task).slice(0, 2),
    searchLogs: [],
    readLogs: [],
    researchSteps: [
      {
        id: "step_1",
        type: "finalize",
        title: "Agent 执行失败",
        detail,
        decision: "stop",
        reason: message,
        timestamp: new Date().toISOString()
      }
    ],
    sources: [],
    findings: [],
    error: message,
    startedAt,
    completedAt: new Date().toISOString()
  });
}

async function generateAgentReport(
  prompt: string,
  task: AgentTask,
  queries: string[],
  sources: HeavySource[],
  researchSteps: AgentResearchStep[],
  startedAt: string
): Promise<Partial<AgentReport>> {
  const baseReport = heuristicAgentReport(task, queries, sources, researchSteps, startedAt);
  if (sources.length === 0) {
    return baseReport;
  }

  try {
    const config = getOpenAIConfig();
    const completion = await createChatCompletion({
      ...config,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "你是 Heavy 模式下的独立研究子 Agent。只基于本 Agent 搜到和读到的来源输出严格 JSON。"
        },
        {
          role: "user",
          content: buildAgentReportPrompt(prompt, task, queries, sources, researchSteps)
        }
      ]
    });
    const parsed = JSON.parse(extractJson(completion.content)) as Record<string, unknown>;
    return {
      ...parsed,
      taskId: task.id,
      agentId: `agent_${task.id}`,
      role: task.role,
      queries,
      sources,
      researchSteps,
      startedAt,
      completedAt: new Date().toISOString()
    };
  } catch {
    return baseReport;
  }
}

function heuristicAgentReport(
  task: AgentTask,
  queries: string[],
  sources: HeavySource[],
  researchSteps: AgentResearchStep[],
  startedAt: string
): Partial<AgentReport> {
  return {
    taskId: task.id,
    agentId: `agent_${task.id}`,
    role: task.role,
    status: "completed",
    summary: sources.length > 0 ? `${task.title} 完成，读取 ${sources.length} 个来源。` : `${task.title} 未找到可用来源。`,
    queries,
    searchLogs: [],
    readLogs: [],
    researchSteps,
    sources,
    findings: sources.length
      ? [
          {
            claim: `${task.title}: ${sources[0].snippet.slice(0, 180)}`,
            support: "supported",
            confidence: "medium",
            sourceUrls: [sources[0].url]
          }
        ]
      : [
          {
            claim: `${task.title} 缺少可用公开来源。`,
            support: "unknown",
            confidence: "low",
            sourceUrls: []
          }
        ],
    startedAt,
    completedAt: new Date().toISOString()
  };
}

function buildAgentReportPrompt(
  prompt: string,
  task: AgentTask,
  queries: string[],
  sources: HeavySource[],
  researchSteps: AgentResearchStep[]
): string {
  return `用户问题：
${prompt}

你的独立任务：
${JSON.stringify(task, null, 2)}

你实际搜索的 queries：
${queries.join("\n")}

Agent research process:
${researchSteps
  .map((step) => `- [${step.type}] ${step.title}: ${step.detail}${step.reason ? ` Reason: ${step.reason}` : ""}`)
  .join("\n")}

你读取的来源：
${sources
  .map(
    (source, index) => `[${index + 1}] ${source.title}
URL: ${source.url}
Snippet: ${source.snippet.slice(0, 2500)}`
  )
  .join("\n\n")}

输出严格 JSON：
{
  "status": "completed",
  "summary": "中文摘要",
  "findings": [
    {
      "claim": "只根据本 Agent 来源可支持/反驳/未知的事实",
      "support": "supported|contradicted|unknown",
      "confidence": "low|medium|high",
      "sourceUrls": ["https://..."]
    }
  ]
}

规则：
- 不要使用其他 Agent 的信息。
- 没有来源支持的结论必须 support=unknown。
- 不要输出 JSON 以外的文字。`;
}

function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Agent report did not include JSON");
  }
  return candidate.slice(start, end + 1);
}
