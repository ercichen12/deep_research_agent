import { runAgentTasks, type AgentRunnerInput } from "@/lib/heavy/agent-runner";
import { createCoordinatorPlan } from "@/lib/heavy/coordinator";
import { createHeavySearchProvider } from "@/lib/heavy/search-provider";
import { synthesizeFinalReport } from "@/lib/heavy/synthesizer";
import {
  DEFAULT_HEAVY_BUDGET,
  compactError,
  normalizeBudget,
  type AgentReport,
  type AgentTask,
  type CoordinatorPlan,
  type FinalReport,
  type HeavyBudget,
  type HeavyEvent,
  type HeavySearchProvider,
  type Inquiry,
  type ResearchRun,
  type RunDecision,
  type VerificationReport
} from "@/lib/heavy/types";
import { verifyRun } from "@/lib/heavy/verifier";
import { appendTurnEvent, createInquiry, loadInquiry, saveInquiry, type HeavyStorageOptions } from "@/lib/heavy/storage";

export type RunHeavyInquiryOptions = HeavyStorageOptions & {
  budget?: Partial<HeavyBudget>;
  awaitCompletion?: boolean;
  provider?: HeavySearchProvider;
  coordinator?: (input: {
    prompt: string;
    runIndex: number;
    budget: HeavyBudget;
    historySummary?: string;
    recommendedNextTasks?: AgentTask[];
  }) => Promise<CoordinatorPlan> | CoordinatorPlan;
  runAgents?: (input: {
    prompt: string;
    tasks: AgentTask[];
    provider: HeavySearchProvider;
    budget: HeavyBudget;
  }) => Promise<AgentReport[]> | AgentReport[];
  verifier?: (input: { prompt: string; plan: CoordinatorPlan; reports: AgentReport[] }) => Promise<VerificationReport> | VerificationReport;
  synthesizer?: (input: {
    prompt: string;
    reports: AgentReport[];
    verificationReports: VerificationReport[];
    incomplete?: boolean;
  }) => Promise<FinalReport> | FinalReport;
};

export async function startHeavyInquiry(prompt: string, options: RunHeavyInquiryOptions = {}): Promise<{ inquiryId: string; turnId: string }> {
  const { inquiry, turn } = await createInquiry(prompt, {
    ...options,
    budget: options.budget
  });

  const completion = runExistingInquiry(inquiry.id, turn.id, options).catch(async (error) => {
    try {
      await appendTurnEvent(
        {
          type: "error",
          inquiryId: inquiry.id,
          turnId: turn.id,
          message: compactError(error instanceof Error ? error.message : "Heavy inquiry failed"),
          timestamp: new Date().toISOString()
        },
        options
      );
    } catch {
      // Background error logging is best-effort; never reject the fire-and-forget run from here.
    }
  });

  if (options.awaitCompletion) {
    await completion;
  }

  return { inquiryId: inquiry.id, turnId: turn.id };
}

export async function runHeavyInquiry(prompt: string, options: RunHeavyInquiryOptions = {}): Promise<Inquiry> {
  const { inquiryId } = await startHeavyInquiry(prompt, { ...options, awaitCompletion: true });
  const inquiry = await loadInquiry(inquiryId, options);
  if (!inquiry) {
    throw new Error("Heavy inquiry was not saved");
  }
  return inquiry;
}

export async function runExistingInquiry(inquiryId: string, turnId: string, options: RunHeavyInquiryOptions = {}): Promise<Inquiry> {
  const inquiry = await loadInquiry(inquiryId, options);
  if (!inquiry) {
    throw new Error(`Inquiry not found: ${inquiryId}`);
  }
  const turn = inquiry.turns.find((item) => item.id === turnId);
  if (!turn) {
    throw new Error(`Turn not found: ${turnId}`);
  }

  const budget = { ...DEFAULT_HEAVY_BUDGET, ...normalizeBudget(options.budget as Record<string, unknown> | undefined) };
  const provider = options.provider ?? createHeavySearchProvider();
  const now = new Date().toISOString();
  inquiry.status = "running";
  turn.status = "running";
  turn.startedAt = turn.startedAt ?? now;
  turn.updatedAt = now;
  await persist(inquiry, { type: "turn_started", inquiryId, turnId, timestamp: now }, options);

  let recommendedNextTasks: AgentTask[] | undefined;
  let totalAgents = 0;
  let finalIncomplete = false;
  let agentHookPersistence = Promise.resolve();
  const enqueueAgentHookPersistence = (action: () => Promise<void>) => {
    const next = agentHookPersistence.then(action, action);
    agentHookPersistence = next.catch(() => undefined);
    return next;
  };
  const observeAgentHookPersistence = (action: () => Promise<void>) => {
    return enqueueAgentHookPersistence(action).catch(() => undefined);
  };

  try {
    for (let runIndex = 1; runIndex <= budget.maxRuns; runIndex += 1) {
      const run = createRun(runIndex);
      turn.runs.push(run);

      const plan = await (options.coordinator ?? createCoordinatorPlan)({
        prompt: turn.prompt,
        runIndex,
        budget,
        historySummary: summarizeRuns(turn.runs),
        recommendedNextTasks
      });
      const remainingAgents = Math.max(0, budget.maxTotalAgents - totalAgents);
      plan.tasks = plan.tasks.slice(0, Math.min(budget.maxAgentsPerRun, remainingAgents));
      run.coordinatorPlan = plan;
      run.status = "running";
      run.updatedAt = new Date().toISOString();
      await persist(
        inquiry,
        { type: "run_planned", inquiryId, turnId, runId: run.id, runIndex, plan, timestamp: new Date().toISOString() },
        options
      );

      if (plan.tasks.length === 0) {
        run.decision = { action: evidenceExists(turn.runs) ? "finalize_with_uncertainty" : "fail", reason: "没有剩余 Agent 预算。" };
        await persist(
          inquiry,
          { type: "run_decision", inquiryId, turnId, runId: run.id, decision: run.decision, timestamp: new Date().toISOString() },
          options
        );
        finalIncomplete = true;
        break;
      }

      const reports = options.runAgents
        ? await options.runAgents({
            prompt: turn.prompt,
            tasks: plan.tasks,
            provider,
            budget
          })
        : await defaultRunAgents({
            prompt: turn.prompt,
            tasks: plan.tasks,
            provider,
            budget,
            onAgentStarted: (task) => {
              observeAgentHookPersistence(async () => {
                await persist(
                  inquiry,
                  { type: "agent_started", inquiryId, turnId, runId: run.id, task, timestamp: new Date().toISOString() },
                  options
                );
              });
            },
            onAgentResearchStep: (task, step) => {
              observeAgentHookPersistence(async () => {
                await appendTurnEvent(
                  { type: "agent_research_step", inquiryId, turnId, runId: run.id, taskId: task.id, step, timestamp: new Date().toISOString() },
                  options
                );
              });
            },
            onAgentSearchLog: (task, log) => {
              observeAgentHookPersistence(async () => {
                await appendTurnEvent(
                  { type: "agent_search_log", inquiryId, turnId, runId: run.id, taskId: task.id, log, timestamp: new Date().toISOString() },
                  options
                );
              });
            },
            onAgentReadLog: (task, log) => {
              observeAgentHookPersistence(async () => {
                await appendTurnEvent(
                  { type: "agent_read_log", inquiryId, turnId, runId: run.id, taskId: task.id, log, timestamp: new Date().toISOString() },
                  options
                );
              });
            },
            onAgentReported: async (report) => {
              await observeAgentHookPersistence(async () => {
                run.agentReports = mergeAgentReportInTaskOrder(plan.tasks, run.agentReports, report);
                run.updatedAt = new Date().toISOString();
                await persist(
                  inquiry,
                  { type: "agent_reported", inquiryId, turnId, runId: run.id, report, timestamp: new Date().toISOString() },
                  options
                );
              });
            }
          });
      await agentHookPersistence;
      totalAgents += plan.tasks.length;
      run.agentReports = reports;
      if (options.runAgents) {
        for (const report of reports) {
          await appendTurnEvent({ type: "agent_reported", inquiryId, turnId, runId: run.id, report, timestamp: new Date().toISOString() }, options);
        }
      }

      await persist(inquiry, { type: "verification_started", inquiryId, turnId, runId: run.id, timestamp: new Date().toISOString() }, options);
      const verificationReport = await (options.verifier ?? verifyRun)({ prompt: turn.prompt, plan, reports });
      run.verificationReport = verificationReport;
      await persist(
        inquiry,
        { type: "verification_reported", inquiryId, turnId, runId: run.id, report: verificationReport, timestamp: new Date().toISOString() },
        options
      );

      run.decision = decideRun({
        verificationReport,
        runIndex,
        budget,
        totalAgents,
        hasEvidence: evidenceExists(turn.runs)
      });
      run.status = "completed";
      run.updatedAt = new Date().toISOString();
      await persist(
        inquiry,
        { type: "run_decision", inquiryId, turnId, runId: run.id, decision: run.decision, timestamp: new Date().toISOString() },
        options
      );

      if (run.decision.action === "continue") {
        recommendedNextTasks = verificationReport.recommendedNextTasks;
        continue;
      }

      if (run.decision.action === "fail") {
        throw new Error(run.decision.reason);
      }

      finalIncomplete = run.decision.action === "finalize_with_uncertainty";
      break;
    }

    await persist(inquiry, { type: "final_started", inquiryId, turnId, timestamp: new Date().toISOString() }, options);
    const reports = turn.runs.flatMap((run) => run.agentReports);
    const verificationReports = turn.runs.flatMap((run) => (run.verificationReport ? [run.verificationReport] : []));
    turn.finalReport = await (options.synthesizer ?? synthesizeFinalReport)({
      prompt: turn.prompt,
      reports,
      verificationReports,
      incomplete: finalIncomplete
    });
    turn.status = "completed";
    inquiry.status = "completed";
    const completedAt = new Date().toISOString();
    turn.completedAt = completedAt;
    turn.updatedAt = completedAt;
    inquiry.updatedAt = completedAt;
    await persist(inquiry, { type: "final_reported", inquiryId, turnId, report: turn.finalReport, timestamp: completedAt }, options);
    await persist(inquiry, { type: "turn_completed", inquiryId, turnId, timestamp: completedAt }, options);
    return inquiry;
  } catch (error) {
    const message = compactError(error instanceof Error ? error.message : "Heavy inquiry failed");
    inquiry.status = "failed";
    turn.status = "failed";
    turn.error = message;
    turn.completedAt = new Date().toISOString();
    await persist(inquiry, { type: "error", inquiryId, turnId, message, timestamp: new Date().toISOString() }, options);
    return inquiry;
  }
}

export function decideRun(input: {
  verificationReport: VerificationReport;
  runIndex: number;
  budget: HeavyBudget;
  totalAgents: number;
  hasEvidence: boolean;
}): RunDecision {
  if (input.verificationReport.status === "pass") {
    return { action: "finalize", reason: "核验通过，进入终稿。" };
  }

  if (input.verificationReport.status === "failed" && !input.hasEvidence) {
    return { action: "fail", reason: "所有关键 Agent 失败且没有可用证据。" };
  }

  const exhausted = input.runIndex >= input.budget.maxRuns || input.totalAgents >= input.budget.maxTotalAgents;
  if (exhausted) {
    return input.hasEvidence
      ? { action: "finalize_with_uncertainty", reason: "预算耗尽，但已有部分证据，生成未完全确认终稿。" }
      : { action: "fail", reason: "预算耗尽且证据不足。" };
  }

  return { action: "continue", reason: "核验要求补查，进入下一轮 Run。" };
}

async function defaultRunAgents(input: AgentRunnerInput): Promise<AgentReport[]> {
  return runAgentTasks(input);
}

function mergeAgentReportInTaskOrder(tasks: AgentTask[], currentReports: AgentReport[], nextReport: AgentReport): AgentReport[] {
  const reportsByTaskId = new Map(currentReports.map((report) => [report.taskId, report]));
  reportsByTaskId.set(nextReport.taskId, nextReport);
  const orderedReports = tasks.map((task) => reportsByTaskId.get(task.id)).filter((report): report is AgentReport => Boolean(report));
  const taskIds = new Set(tasks.map((task) => task.id));
  const unknownTaskReports = currentReports.filter((report) => !taskIds.has(report.taskId));
  if (!taskIds.has(nextReport.taskId)) {
    unknownTaskReports.push(nextReport);
  }
  return [...orderedReports, ...unknownTaskReports];
}

function createRun(index: number): ResearchRun {
  const now = new Date().toISOString();
  return {
    id: `run_${index}_${Date.now().toString(36)}`,
    index,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    agentReports: []
  };
}

async function persist(inquiry: Inquiry, event: HeavyEvent, options: RunHeavyInquiryOptions): Promise<void> {
  inquiry.updatedAt = new Date().toISOString();
  await appendTurnEvent(event, options);
  await saveInquiry(inquiry, options);
}

function evidenceExists(runs: ResearchRun[]): boolean {
  return runs.some((run) => run.agentReports.some((report) => report.sources.length > 0 || report.findings.some((finding) => finding.sourceUrls.length > 0)));
}

function summarizeRuns(runs: ResearchRun[]): string {
  return runs
    .map((run) => {
      const verification = run.verificationReport ? `${run.verificationReport.status}: ${run.verificationReport.summary}` : "not verified yet";
      return `Run ${run.index}: ${verification}`;
    })
    .join("\n");
}
