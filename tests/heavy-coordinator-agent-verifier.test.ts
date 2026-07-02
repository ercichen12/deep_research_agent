import { describe, expect, it } from "vitest";
import { buildAgentQueries, runAgentTasks } from "@/lib/heavy/agent-runner";
import { buildHeuristicCoordinatorPlan } from "@/lib/heavy/coordinator";
import {
  DEFAULT_HEAVY_BUDGET,
  type AgentTask,
  type HeavySearchProvider,
  type ReadAttemptLog,
  type SearchAttemptLog
} from "@/lib/heavy/types";
import { verifyRun } from "@/lib/heavy/verifier";

describe("Heavy coordinator", () => {
  it("creates identity/company/tenure/article/exclusion tasks for find-people prompts", () => {
    const plan = buildHeuristicCoordinatorPlan(
      "找澳大利亚创新硬件 CEO，不能是医疗器械，需要最近发表 AI 观点文章",
      1,
      DEFAULT_HEAVY_BUDGET
    );

    expect(plan.tasks.map((task) => task.role)).toEqual(
      expect.arrayContaining([
        "identity_research",
        "company-fit_research",
        "role-tenure_research",
        "article-ai-view_research",
        "exclusion-risk_research"
      ])
    );
  });

  it("creates cleaning/entity/peer/grading/storage tasks for data-solution prompts", () => {
    const plan = buildHeuristicCoordinatorPlan("海关数据清洗、客户分群、同行识别和存储架构方案", 1, DEFAULT_HEAVY_BUDGET);

    expect(plan.tasks.map((task) => task.role)).toEqual(
      expect.arrayContaining([
        "data-cleaning_research",
        "entity-resolution_research",
        "peer-identification_research",
        "customer-grading_research",
        "data-architecture_analyze"
      ])
    );
  });
});

describe("Heavy AgentRunner", () => {
  it("builds English-only search queries even when task text is Chinese", () => {
    const queries = buildAgentQueries("找澳大利亚创新硬件 CEO，最近发表 AI 观点文章", {
      id: "article-ai-view_research",
      role: "article-ai-view_research",
      title: "AI 观点文章",
      objective: "查找候选人近期发表或接受采访时关于 AI 的观点。",
      questions: ["是否有近期文章、访谈、博客或演讲包含 AI 观点？"],
      searchHints: ["recent AI article CEO Australia hardware"]
    });

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((query) => !/[\u3400-\u9fff\uf900-\ufaff]/.test(query))).toBe(true);
    expect(queries[0]).toContain("article-ai-view_research");
    expect(queries.join(" ")).toContain("recent AI article CEO Australia hardware");
  });

  it("runs multiple AgentTask items independently with different queries, sources, and reports", async () => {
    const searchLog: string[] = [];
    const provider: HeavySearchProvider = {
      search: async (query) => {
        searchLog.push(query);
        return [{ title: `Result ${query}`, url: `https://example.com/${encodeURIComponent(query)}`, provider: "test" }];
      },
      read: async (result) => ({ ...result, snippet: `Evidence for ${result.title}`, fullText: `Evidence for ${result.title}` })
    };

    const reports = await runAgentTasks({
      prompt: "找 CEO",
      tasks: [task("identity_research", "身份核验"), task("growth_research", "增长核验")],
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, agentConcurrency: 2, maxSourcesPerAgent: 2 }
    });

    expect(reports).toHaveLength(2);
    expect(reports.every((report) => report.status === "completed")).toBe(true);
    expect(new Set(searchLog).size).toBeGreaterThanOrEqual(2);
    expect(reports[0].taskId).not.toBe(reports[1].taskId);
    expect(reports[0].sources[0].url).not.toBe(reports[1].sources[0].url);
    expect(reports[0].searchLogs.length).toBeGreaterThan(0);
    expect(reports[0].readLogs.length).toBeGreaterThan(0);
    expect(reports[0].researchSteps.length).toBeGreaterThan(0);
    expect(reports[0].researchSteps.map((step) => step.type)).toEqual(
      expect.arrayContaining(["intent", "query_generation", "search", "reflection", "source_selection", "finalize"])
    );
  });

  it("requests wide search results for each query and can retain 30 sources per agent", async () => {
    const requestedLimits: number[] = [];
    const requestedQueries: string[] = [];
    const provider: HeavySearchProvider = {
      search: async (query, limit = 0) => {
        requestedQueries.push(query);
        requestedLimits.push(limit);
        return Array.from({ length: limit }, (_, index) => ({
          title: `Result ${index + 1} ${query}`,
          url: `https://wide.example/${encodeURIComponent(query)}/${index + 1}`,
          snippet: `Evidence ${index + 1}`,
          provider: "test"
        }));
      },
      read: async (result) => ({ ...result, snippet: result.snippet ?? "evidence", fullText: result.snippet ?? "evidence" })
    };

    const reports = await runAgentTasks({
      prompt: "找澳大利亚创新硬件 CEO",
      tasks: [task("wide", "宽搜索")],
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 30, agentConcurrency: 1 }
    });

    expect(requestedLimits[0]).toBe(30);
    expect(requestedLimits.every((limit) => limit === 30)).toBe(true);
    expect(requestedQueries.length).toBeGreaterThanOrEqual(3);
    expect(reports[0].sources).toHaveLength(30);
  });

  it("turns one failed AgentTask into a failed report without stopping the run", async () => {
    let forkIndex = 0;
    const provider: HeavySearchProvider = {
      search: async () => [{ title: "OK", url: "https://example.com/ok", provider: "test" }],
      read: async (result) => ({ ...result, snippet: "OK evidence" }),
      forkTrace: () => {
        forkIndex += 1;
        let shouldFail = false;
        return {
          search: async (query) => {
            shouldFail = shouldFail || query.includes("bad");
            if (shouldFail) {
              throw new Error("search failed");
            }
            return [{ title: `OK ${forkIndex}`, url: `https://example.com/ok-${forkIndex}`, provider: "test" }];
          },
          read: async (result) => ({ ...result, snippet: "OK evidence" })
        };
      }
    };

    const reports = await runAgentTasks({
      prompt: "找 CEO",
      tasks: [task("ok", "正常任务"), task("bad", "失败任务")],
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, agentConcurrency: 2 }
    });

    expect(reports.map((report) => report.status).sort()).toEqual(["completed", "failed"]);
    const failedReport = reports.find((report) => report.status === "failed");
    expect(failedReport?.queries.length).toBeGreaterThan(0);
    expect(failedReport?.searchLogs.length).toBeGreaterThan(0);
    expect(failedReport?.searchLogs.every((log) => log.status === "error")).toBe(true);
    expect(failedReport?.researchSteps.length).toBeGreaterThan(0);
    expect(failedReport?.researchSteps.at(-1)?.type).toBe("finalize");
  });

  it("returns a failed report for a start hook failure and continues the queue", async () => {
    const provider: HeavySearchProvider = {
      search: async (query) => [{ title: `OK ${query}`, url: `https://example.com/${encodeURIComponent(query)}`, provider: "test" }],
      read: async (result) => ({ ...result, snippet: "OK evidence" })
    };

    const reports = await runAgentTasks({
      prompt: "找 CEO",
      tasks: [task("start_failure", "启动失败任务"), task("second_task", "第二任务")],
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, agentConcurrency: 1, maxSourcesPerAgent: 1 },
      onAgentStarted: (startedTask) => {
        if (startedTask.id === "start_failure") {
          throw new Error("start hook failed");
        }
      }
    });

    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      taskId: "start_failure",
      status: "failed",
      error: expect.stringContaining("start hook failed")
    });
    expect(reports[0].queries.length).toBeGreaterThan(0);
    expect(reports[0].researchSteps.at(-1)?.type).toBe("finalize");
    expect(reports[0].researchSteps.at(-1)?.decision).toBe("stop");
    expect(reports[1]).toMatchObject({ taskId: "second_task", status: "completed" });
  });

  it("keeps reports and continues the queue when the reported hook fails", async () => {
    const provider: HeavySearchProvider = {
      search: async (query) => [{ title: `OK ${query}`, url: `https://example.com/${encodeURIComponent(query)}`, provider: "test" }],
      read: async (result) => ({ ...result, snippet: "OK evidence" })
    };

    const reports = await runAgentTasks({
      prompt: "找 CEO",
      tasks: [task("first_report", "第一报告"), task("second_report", "第二报告")],
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, agentConcurrency: 1, maxSourcesPerAgent: 1 },
      onAgentReported: () => {
        throw new Error("reported hook failed");
      }
    });

    expect(reports).toHaveLength(2);
    expect(reports.map((report) => report.taskId)).toEqual(["first_report", "second_report"]);
    expect(reports.every((report) => report.status === "completed")).toBe(true);
  });

  it("classifies zero-source search outcomes by whether every search failed", async () => {
    let mixedSearchCount = 0;
    const mixedProvider: HeavySearchProvider = {
      search: async () => {
        mixedSearchCount += 1;
        if (mixedSearchCount === 1) {
          throw new Error("temporary search outage");
        }
        return [];
      },
      read: async (result) => ({ ...result, snippet: "unused" })
    };
    const allErrorProvider: HeavySearchProvider = {
      search: async () => {
        throw new Error("search route unavailable");
      },
      read: async (result) => ({ ...result, snippet: "unused" })
    };

    const [mixedReport] = await runAgentTasks({
      prompt: "find CEO",
      tasks: [task("mixed_zero_sources", "混合零来源")],
      provider: mixedProvider,
      budget: { ...DEFAULT_HEAVY_BUDGET, agentConcurrency: 1, maxSourcesPerAgent: 1 }
    });
    const [allErrorReport] = await runAgentTasks({
      prompt: "find CEO",
      tasks: [task("all_error_zero_sources", "全错误零来源")],
      provider: allErrorProvider,
      budget: { ...DEFAULT_HEAVY_BUDGET, agentConcurrency: 1, maxSourcesPerAgent: 1 }
    });

    expect(mixedReport.status).toBe("completed");
    expect(mixedReport.sources).toHaveLength(0);
    expect(mixedReport.searchLogs.some((log) => log.status === "error")).toBe(true);
    expect(mixedReport.searchLogs.some((log) => log.status !== "error")).toBe(true);
    expect(mixedReport.findings[0]).toMatchObject({ support: "unknown", confidence: "low", sourceUrls: [] });

    expect(allErrorReport.status).toBe("failed");
    expect(allErrorReport.sources).toHaveLength(0);
    expect(allErrorReport.queries.length).toBeGreaterThan(0);
    expect(allErrorReport.searchLogs.length).toBeGreaterThan(0);
    expect(allErrorReport.searchLogs.every((log) => log.status === "error")).toBe(true);
    expect(allErrorReport.researchSteps.at(-1)?.type).toBe("finalize");
  });

  it("fails zero-source reports when drained provider attempts all failed despite local empty wrappers", async () => {
    const providerSearchLogs: SearchAttemptLog[] = [
      {
        provider: "relay",
        query: "provider relay attempt",
        status: "error",
        results: [],
        message: "Relay HTTP 503",
        timestamp: "2026-01-01T00:00:00.000Z",
        durationMs: 10
      },
      {
        provider: "opencli",
        engine: "google",
        query: "provider google attempt",
        status: "error",
        results: [],
        message: "google search failed",
        timestamp: "2026-01-01T00:00:01.000Z",
        durationMs: 12
      },
      {
        provider: "web",
        engine: "bing",
        query: "provider web fallback",
        status: "error",
        results: [],
        message: "bing fallback failed",
        timestamp: "2026-01-01T00:00:02.000Z",
        durationMs: 14
      }
    ];
    const providerReadLog: ReadAttemptLog = {
      provider: "fetch",
      status: "error",
      title: "Provider read trace",
      url: "https://trace.example/read",
      message: "read queue drained after provider outage",
      timestamp: "2026-01-01T00:00:03.000Z",
      durationMs: 4
    };
    const provider: HeavySearchProvider = {
      search: async () => [],
      read: async (result) => ({ ...result, snippet: "unused" }),
      drainSearchLogs: () => providerSearchLogs,
      drainReadLogs: () => [providerReadLog]
    };

    const [report] = await runAgentTasks({
      prompt: "find CEO",
      tasks: [task("provider_outage_zero_sources", "生产搜索失败")],
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, agentConcurrency: 1, maxSourcesPerAgent: 1 }
    });

    expect(report.status).toBe("failed");
    expect(report.sources).toHaveLength(0);
    expect(report.queries.length).toBeGreaterThan(0);
    expect(report.searchLogs).toEqual(expect.arrayContaining(providerSearchLogs));
    expect(report.searchLogs.some((log) => log.provider === "test" && log.status === "empty")).toBe(true);
    expect(report.readLogs).toContainEqual(providerReadLog);
    expect(report.researchSteps.length).toBeGreaterThan(0);
    expect(report.researchSteps.at(-1)?.type).toBe("finalize");
  });

  it("preserves provider drain logs alongside local wrapper logs", async () => {
    const providerSearchLog: SearchAttemptLog = {
      provider: "web",
      engine: "google",
      query: "provider search trace",
      status: "done",
      results: [],
      timestamp: "2026-01-01T00:00:00.000Z",
      durationMs: 11
    };
    const providerReadLog: ReadAttemptLog = {
      provider: "fetch",
      status: "done",
      title: "Provider read trace",
      url: "https://trace.example/read",
      readCharCount: 42,
      timestamp: "2026-01-01T00:00:01.000Z",
      durationMs: 7
    };
    const searchedQueries: string[] = [];
    const provider: HeavySearchProvider = {
      search: async (query) => {
        searchedQueries.push(query);
        return [{ title: "Local result", url: `https://example.com/${encodeURIComponent(query)}`, provider: "test" }];
      },
      read: async (result) => ({ ...result, snippet: "Local read evidence", fullText: "Local read evidence" }),
      drainSearchLogs: () => [providerSearchLog],
      drainReadLogs: () => [providerReadLog]
    };

    const reports = await runAgentTasks({
      prompt: "找 CEO",
      tasks: [task("identity_research", "身份核验")],
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, agentConcurrency: 1, maxSourcesPerAgent: 1 }
    });

    const [report] = reports;
    expect(report.searchLogs).toContainEqual(providerSearchLog);
    expect(report.searchLogs.some((log) => searchedQueries.includes(log.query))).toBe(true);
    expect(report.readLogs).toContainEqual(providerReadLog);
    expect(report.readLogs.some((log) => log.url.startsWith("https://example.com/"))).toBe(true);
  });
});

describe("Heavy verifier", () => {
  it("flags source-free findings and contradictory findings, then recommends next tasks", async () => {
    const report = {
      taskId: "identity_research",
      agentId: "agent_identity_research",
      role: "identity_research",
      status: "completed" as const,
      summary: "有结论但证据不完整",
      queries: ["q"],
      researchSteps: [],
      sources: [{ title: "A", url: "https://example.com/a", snippet: "source", provider: "test" as const }],
      findings: [
        { claim: "候选人是 CEO", support: "supported" as const, confidence: "medium" as const, sourceUrls: [] },
        {
          claim: "公司属于排除行业",
          support: "contradicted" as const,
          confidence: "high" as const,
          sourceUrls: ["https://example.com/a"]
        }
      ],
      startedAt: "2026-07-01T00:00:00.000Z",
      completedAt: "2026-07-01T00:00:01.000Z"
    };

    const verification = await verifyRun({
      prompt: "找创新硬件 CEO，排除医疗器械",
      plan: { runIndex: 1, objective: "test", tasks: [task("identity_research", "身份核验")] },
      reports: [report]
    });

    expect(verification.status).toBe("needs_more_research");
    expect(verification.issues.map((issue) => issue.type)).toEqual(expect.arrayContaining(["missing_source", "contradiction"]));
    expect(verification.recommendedNextTasks.length).toBeGreaterThan(0);
  });
});

function task(id: string, title: string): AgentTask {
  return {
    id,
    role: id,
    title,
    objective: `${title} objective`,
    questions: [`${title} question`],
    searchHints: [`${title} search hint`]
  };
}
