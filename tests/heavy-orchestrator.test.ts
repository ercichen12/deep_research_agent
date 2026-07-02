import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runExistingInquiry, runHeavyInquiry, type RunHeavyInquiryOptions } from "@/lib/heavy/orchestrator";
import { createInquiry, loadInquiry } from "@/lib/heavy/storage";
import {
  DEFAULT_HEAVY_BUDGET,
  type AgentReport,
  type AgentTask,
  type HeavyEvent,
  type HeavySearchProvider,
  type HeavySearchResult,
  type HeavySource,
  type VerificationReport
} from "@/lib/heavy/types";

describe("HeavyOrchestrator", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "heavy-orchestrator-"));
  });

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true });
  });

  it("runs multiple real Run cycles when verifier asks for more research", async () => {
    let verifierCall = 0;
    const inquiry = await runHeavyInquiry("找澳大利亚创新硬件 CEO", {
      rootDir,
      awaitCompletion: true,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxRuns: 3, maxAgentsPerRun: 2, maxTotalAgents: 4 },
      coordinator: async ({ runIndex, recommendedNextTasks }) => ({
        runIndex,
        objective: `run ${runIndex}`,
        tasks: recommendedNextTasks?.length ? recommendedNextTasks : [task(`task_${runIndex}`, `任务 ${runIndex}`)]
      }),
      runAgents: async ({ tasks }) => tasks.map((item) => report(item)),
      verifier: async () => {
        verifierCall += 1;
        return verifierCall === 1
          ? verification("needs_more_research", [task("follow_up", "补查任务")])
          : verification("pass", []);
      },
      synthesizer: async ({ reports }) => ({
        markdown: `# 终稿\n\n来源 ${reports.length} 个。[Source](https://example.com/task_1)`,
        summary: "完成",
        sourceUrls: ["https://example.com/task_1"],
        unknowns: [],
        completedAt: "2026-07-01T00:00:02.000Z"
      })
    });

    const turn = inquiry.turns[0];
    expect(turn.runs).toHaveLength(2);
    expect(turn.status).toBe("completed");
    expect(turn.finalReport?.markdown).toContain("终稿");

    const persistedInquiry = await loadInquiry(inquiry.id, { rootDir });
    const persistedReports = persistedInquiry?.turns.flatMap((item) => item.runs.flatMap((run) => run.agentReports)) ?? [];
    expect(persistedReports).toHaveLength(2);
    for (const persistedReport of persistedReports) {
      expect(persistedReport.taskId).toBeTruthy();
      expect(persistedReport.researchSteps[0]).toMatchObject({ type: "intent", title: "识别任务意图" });
    }

    const logRaw = await readFile(join(rootDir, "logs", `${turn.id}.ndjson`), "utf8");
    const events = logRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; runId?: string; report?: AgentReport });
    const agentReportedEvents = events.filter((event) => event.type === "agent_reported");
    expect(agentReportedEvents).toHaveLength(2);
    for (const event of agentReportedEvents) {
      expect(event.runId).toBeTruthy();
      expect(event.report?.taskId).toBeTruthy();
      expect(event.report?.researchSteps[0]).toMatchObject({ type: "intent", title: "识别任务意图" });
    }
  });

  it("creates an uncertain final report when budget is exhausted but evidence exists", async () => {
    const inquiry = await runHeavyInquiry("找澳大利亚创新硬件 CEO", {
      rootDir,
      awaitCompletion: true,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxRuns: 1, maxAgentsPerRun: 1, maxTotalAgents: 1 },
      coordinator: async ({ runIndex }) => ({ runIndex, objective: "run", tasks: [task("task_1", "任务 1")] }),
      runAgents: async ({ tasks }) => tasks.map((item) => report(item)),
      verifier: async () => verification("needs_more_research", [task("follow_up", "补查任务")]),
      synthesizer: async ({ verificationReports }) => ({
        markdown: `# 未完全确认\n\n${verificationReports[0].missingEvidence.join(", ")}`,
        summary: "未完全确认",
        sourceUrls: ["https://example.com/task_1"],
        unknowns: verificationReports[0].missingEvidence,
        completedAt: "2026-07-01T00:00:02.000Z"
      })
    });

    const turn = inquiry.turns[0];
    expect(turn.status).toBe("completed");
    expect(turn.runs[0].decision?.action).toBe("finalize_with_uncertainty");
    expect(turn.finalReport?.unknowns).toEqual(["annual growth"]);
  });

  it("persists default agent progress before all agents finish", async () => {
    const blockedSearch = deferred<void>();
    let blockedSearchStarted = false;

    const provider: HeavySearchProvider = {
      async search(query) {
        if ((query.includes("blocked_task") || query.includes("blocked task")) && !blockedSearchStarted) {
          blockedSearchStarted = true;
          await blockedSearch.promise;
        }

        if (query.includes("fast_task") || query.includes("fast task")) {
          return [
            {
              title: "Fast Task CEO founder leadership profile",
              url: "https://www.linkedin.com/in/fast-task-ceo",
              snippet: "Fast Task CEO founder leadership profile interview article funding Series A robotics hardware product AI.",
              provider: "test" as const
            },
            {
              title: "Fast Task funding article",
              url: "https://www.businessnewsaustralia.com/fast-task-funding",
              snippet: "Fast Task raises funding for robotics hardware product with CEO interview and company growth evidence.",
              provider: "test" as const
            }
          ];
        }

        return [];
      },
      async read(result) {
        return source(result);
      }
    };

    const runOptions: RunHeavyInquiryOptions = {
      rootDir,
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxRuns: 1, maxAgentsPerRun: 2, maxTotalAgents: 2, maxSourcesPerAgent: 1, agentConcurrency: 2 },
      coordinator: async ({ runIndex }) => ({
        runIndex,
        objective: "run",
        tasks: [task("fast_task", "Fast task"), task("blocked_task", "Blocked task")]
      }),
      verifier: async () => verification("pass", []),
      synthesizer: async ({ reports }) => ({
        markdown: `# Done\n\n${reports.map((item) => item.taskId).join(", ")}`,
        summary: "done",
        sourceUrls: [],
        unknowns: [],
        completedAt: "2026-07-01T00:00:02.000Z"
      })
    };
    const { inquiry: createdInquiry, turn } = await createInquiry("Find candidate CEOs", {
      rootDir,
      budget: runOptions.budget
    });
    const completion = runExistingInquiry(createdInquiry.id, turn.id, runOptions);

    let earlyFailure: unknown;

    try {
      await waitFor(() => (blockedSearchStarted ? true : undefined), "blocked agent to pause while default agents are running");

      const earlyEvents = await waitFor(async () => {
        const events = await readLogEvents(rootDir, turn.id);
        const started = events.filter((event) => event.type === "agent_started");
        const reported = events.filter((event) => event.type === "agent_reported");
        return started.length >= 2 && reported.length >= 1 ? events : undefined;
      }, "default path to persist early agent_started and agent_reported events");

      const startedTasks = earlyEvents
        .filter((event): event is Extract<HeavyEvent, { type: "agent_started" }> => event.type === "agent_started")
        .map((event) => event.task.id)
        .sort();
      expect(startedTasks).toEqual(["blocked_task", "fast_task"]);

      const earlyReports = earlyEvents.filter((event): event is Extract<HeavyEvent, { type: "agent_reported" }> => event.type === "agent_reported");
      expect(earlyReports).toHaveLength(1);
      expect(earlyReports[0].report.taskId).toBe("fast_task");
      expect(earlyReports[0].report.status).toBe("completed");
      expect(earlyReports[0].report.sources).toHaveLength(1);
      expect(earlyReports[0].report.researchSteps[0]).toMatchObject({ type: "intent", title: "识别任务意图" });

      const partialInquiry = await waitFor(async () => {
        const inquiry = await loadInquiry(createdInquiry.id, { rootDir });
        const reports = inquiry?.turns[0]?.runs[0]?.agentReports ?? [];
        return reports.length >= 1 ? inquiry : undefined;
      }, "partial agent report to be saved to inquiry JSON");
      const partialReports = partialInquiry.turns[0].runs[0].agentReports;
      expect(partialReports.map((item) => item.taskId)).toEqual(["fast_task"]);
      expect(partialReports[0].status).toBe("completed");
      expect(partialReports[0].sources).toHaveLength(1);
      expect(partialReports[0].researchSteps[0]).toMatchObject({ type: "intent", title: "识别任务意图" });
    } catch (error) {
      earlyFailure = error;
    } finally {
      blockedSearch.resolve();
    }

    const completedInquiry = await completion;
    const finalReports = completedInquiry.turns[0].runs[0].agentReports;
    expect(completedInquiry.turns[0].status).toBe("completed");
    expect(finalReports.map((item) => item.taskId)).toEqual(["fast_task", "blocked_task"]);

    if (earlyFailure) {
      throw earlyFailure;
    }
  });

  it("does not fail the default agent when agent_started progress persistence fails", async () => {
    const provider: HeavySearchProvider = {
      async search() {
        return [
          {
            title: "Resilient Task CEO founder leadership profile",
            url: "https://www.linkedin.com/in/resilient-task-ceo",
            snippet: "Resilient Task CEO founder leadership profile interview article funding Series A robotics hardware product AI.",
            provider: "test" as const
          },
          {
            title: "Resilient Task funding article",
            url: "https://www.businessnewsaustralia.com/resilient-task-funding",
            snippet: "Resilient Task raises funding for robotics hardware product with CEO interview and company growth evidence.",
            provider: "test" as const
          }
        ];
      },
      async read(result) {
        return source(result);
      }
    };
    const runOptions: RunHeavyInquiryOptions = {
      rootDir,
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxRuns: 1, maxAgentsPerRun: 1, maxTotalAgents: 1, maxSourcesPerAgent: 1, agentConcurrency: 1 },
      coordinator: async ({ runIndex }) => ({
        runIndex,
        objective: "run",
        tasks: [task("resilient_task", "Resilient task")]
      }),
      verifier: async () => verification("pass", []),
      synthesizer: async ({ reports }) => ({
        markdown: `# Done\n\n${reports.map((item) => item.taskId).join(", ")}`,
        summary: "done",
        sourceUrls: [],
        unknowns: [],
        completedAt: "2026-07-01T00:00:02.000Z"
      })
    };
    const { inquiry, turn } = await createInquiry("Find resilient CEOs", {
      rootDir,
      budget: runOptions.budget
    });

    vi.resetModules();
    vi.doMock("@/lib/heavy/storage", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/heavy/storage")>();
      const appendTurnEvent: typeof actual.appendTurnEvent = async (event, options) => {
        if (event.type === "agent_started") {
          throw new Error("Simulated progress persistence failure");
        }
        return actual.appendTurnEvent(event, options);
      };
      return {
        ...actual,
        appendTurnEvent
      };
    });

    try {
      const { runExistingInquiry: runWithMockedStorage } = await import("@/lib/heavy/orchestrator");
      const completedInquiry = await runWithMockedStorage(inquiry.id, turn.id, runOptions);
      const finalReports = completedInquiry.turns[0].runs[0].agentReports;

      expect(finalReports).toHaveLength(1);
      expect(finalReports[0]).toMatchObject({
        taskId: "resilient_task",
        status: "completed"
      });
      expect(finalReports[0].sources).toHaveLength(1);
      expect(finalReports[0].researchSteps[0]).toMatchObject({ type: "intent", title: "识别任务意图" });
    } finally {
      vi.doUnmock("@/lib/heavy/storage");
      vi.resetModules();
    }
  });

  it("persists live agent research and search events before a slow read finishes", async () => {
    const blockedRead = deferred<void>();
    let readStarted = false;
    const searchTrace: HeavyEvent[] = [];
    const provider: HeavySearchProvider = {
      async search(query) {
        const results: HeavySearchResult[] = [
          {
            title: "Andromeda Robotics official product",
            url: "https://andromedarobotics.ai/",
            snippet: "Official robotics company led by Grace Brown with AI hardware product evidence.",
            provider: "test"
          },
          {
            title: "Grace Brown LinkedIn profile",
            url: "https://www.linkedin.com/in/grace-brown",
            snippet: "Grace Brown CEO founder leadership profile interview article funding Series A robotics hardware product AI.",
            provider: "test"
          }
        ];
        searchTrace.push({
          type: "agent_search_log",
          inquiryId: "unused",
          turnId: "unused",
          runId: "unused",
          taskId: "slow_task",
          log: {
            provider: "opencli",
            engine: "google",
            query,
            status: "done",
            results: results.map((result) => ({ ...result, provider: "opencli" as const, engine: "google" })),
            timestamp: "2026-07-01T00:00:00.100Z",
            durationMs: 15
          },
          timestamp: "2026-07-01T00:00:00.100Z"
        } as HeavyEvent);
        return results;
      },
      async read(result) {
        readStarted = true;
        await blockedRead.promise;
        return source(result);
      },
      drainSearchLogs: () => {
        const drained = searchTrace.splice(0);
        return drained
          .filter((event): event is Extract<HeavyEvent, { type: "agent_search_log" }> => event.type === "agent_search_log")
          .map((event) => event.log);
      }
    };
    const runOptions: RunHeavyInquiryOptions = {
      rootDir,
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxRuns: 1, maxAgentsPerRun: 1, maxTotalAgents: 1, maxSourcesPerAgent: 1, agentConcurrency: 1 },
      coordinator: async ({ runIndex }) => ({
        runIndex,
        objective: "run",
        tasks: [task("slow_task", "Slow task")]
      }),
      verifier: async () => verification("pass", []),
      synthesizer: async () => ({
        markdown: "# Done",
        summary: "done",
        sourceUrls: [],
        unknowns: [],
        completedAt: "2026-07-01T00:00:02.000Z"
      })
    };
    const { inquiry, turn } = await createInquiry("Find slow CEOs", {
      rootDir,
      budget: runOptions.budget
    });

    const completion = runExistingInquiry(inquiry.id, turn.id, runOptions);
    let earlyFailure: unknown;

    try {
      await waitFor(() => (readStarted ? true : undefined), "slow read to start after search events");
      const earlyEvents = await waitFor(async () => {
        const events = await readLogEvents(rootDir, turn.id);
        return events.some((event) => event.type === "agent_research_step") &&
          events.some((event) => event.type === "agent_search_log")
          ? events
          : undefined;
      }, "live agent research and search events to be persisted");

      expect(earlyEvents).toContainEqual(
        expect.objectContaining({
          type: "agent_research_step",
          taskId: "slow_task"
        })
      );
      expect(earlyEvents).toContainEqual(
        expect.objectContaining({
          type: "agent_search_log",
          taskId: "slow_task",
          log: expect.objectContaining({ provider: "opencli", engine: "google", status: "done" })
        })
      );
      expect(earlyEvents.some((event) => event.type === "agent_reported")).toBe(false);
    } catch (error) {
      earlyFailure = error;
    } finally {
      blockedRead.resolve();
    }

    await completion;
    if (earlyFailure) {
      throw earlyFailure;
    }
  });

  it("does not leave an unhandled rejection when background error logging fails", async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);
    vi.resetModules();
    vi.doMock("@/lib/heavy/storage", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/heavy/storage")>();
      const appendTurnEvent: typeof actual.appendTurnEvent = async (event, options) => {
        if (event.type === "error") {
          throw new Error("Simulated error event persistence failure");
        }
        return actual.appendTurnEvent(event, options);
      };
      const loadInquiry: typeof actual.loadInquiry = async () => {
        throw new Error("Simulated background run failure");
      };
      return {
        ...actual,
        appendTurnEvent,
        loadInquiry
      };
    });

    try {
      const { startHeavyInquiry: startWithMockedStorage } = await import("@/lib/heavy/orchestrator");
      await expect(
        startWithMockedStorage("Background failure should not leak", {
          rootDir,
          awaitCompletion: false
        })
      ).resolves.toMatchObject({
        inquiryId: expect.any(String),
        turnId: expect.any(String)
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      vi.doUnmock("@/lib/heavy/storage");
      vi.resetModules();
    }
  });
});

function task(id: string, title: string): AgentTask {
  return {
    id,
    role: id,
    title,
    objective: `${title} objective`,
    questions: [`${title} question`],
    searchHints: [`${title} search`]
  };
}

function report(taskItem: AgentTask): AgentReport {
  return {
    taskId: taskItem.id,
    agentId: `agent_${taskItem.id}`,
    role: taskItem.role,
    status: "completed",
    summary: `${taskItem.title} summary`,
    queries: [`${taskItem.title} query`],
    searchLogs: [],
    readLogs: [],
    researchSteps: [
      {
        id: `step_${taskItem.id}`,
        type: "intent",
        title: "识别任务意图",
        detail: `${taskItem.title} intent`,
        decision: "continue",
        timestamp: "2026-07-01T00:00:00.000Z"
      }
    ],
    sources: [{ title: taskItem.title, url: `https://example.com/${taskItem.id}`, snippet: "evidence", provider: "test" }],
    findings: [
      {
        claim: `${taskItem.title} supported claim`,
        support: "supported",
        confidence: "medium",
        sourceUrls: [`https://example.com/${taskItem.id}`]
      }
    ],
    startedAt: "2026-07-01T00:00:00.000Z",
    completedAt: "2026-07-01T00:00:01.000Z"
  };
}

function source(result: HeavySearchResult): HeavySource {
  return {
    title: result.title,
    url: result.url,
    snippet: result.snippet ?? "evidence",
    provider: result.provider
  };
}

function verification(status: VerificationReport["status"], recommendedNextTasks: AgentTask[]): VerificationReport {
  return {
    status,
    summary: status === "pass" ? "通过" : "还需要补查",
    issues: status === "pass" ? [] : [{ type: "missing_evidence", severity: "medium", message: "缺少增长率" }],
    contradictions: [],
    missingEvidence: status === "pass" ? [] : ["annual growth"],
    recommendedNextTasks,
    unknowns: status === "pass" ? [] : ["annual growth"]
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function readLogEvents(rootDir: string, turnId: string): Promise<HeavyEvent[]> {
  try {
    const raw = await readFile(join(rootDir, "logs", `${turnId}.ndjson`), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HeavyEvent);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function waitFor<T>(probe: () => T | Promise<T | undefined> | undefined, label: string, timeoutMs = 3000): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
