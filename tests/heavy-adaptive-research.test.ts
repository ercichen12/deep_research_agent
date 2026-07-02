import { describe, expect, it } from "vitest";
import { runAdaptiveResearch } from "@/lib/heavy/adaptive-research";
import {
  DEFAULT_HEAVY_BUDGET,
  type AgentTask,
  type AgentResearchStep,
  type HeavySearchProvider,
  type HeavySearchResult,
  type ReadAttemptLog,
  type SearchAttemptLog
} from "@/lib/heavy/types";

describe("Adaptive Heavy research", () => {
  it("revises English keywords after an empty first round and then reads useful sources", async () => {
    const searchedQueries: string[] = [];
    const provider: HeavySearchProvider = {
      search: async (query) => {
        searchedQueries.push(query);
        if (searchedQueries.length <= 3) {
          return [];
        }
        return [
          {
            title: "Grace Brown - Andromeda Robotics CEO",
            url: "https://andromedarobotics.ai/post/series-a-funding-news-fuel-for-our-zero-loneliness-vision",
            snippet: "Three years ago, we set out to solve the loneliness epidemic with Abi.",
            provider: "test"
          }
        ];
      },
      read: async (result) => ({
        ...result,
        snippet: result.snippet ?? "evidence",
        fullText: `${result.snippet ?? "evidence"} Grace Brown CEO Andromeda Robotics AI hardware.`
      })
    };

    const output = await runAdaptiveResearch({
      prompt: "找澳大利亚创新硬件 CEO，任职三年以上，最近发表 AI 观点",
      task: task("role-tenure_research", "任职年限", "Verify CEO tenure and founder year"),
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 5 }
    });

    expect(output.researchSteps.some((step) => step.type === "keyword_revision")).toBe(true);
    expect(output.researchSteps.some((step) => step.type === "reflection" && step.decision === "revise_query")).toBe(true);
    expect(output.sources).toHaveLength(1);
    expect(searchedQueries.length).toBeGreaterThan(3);
    expect(searchedQueries.every((query) => !/[\u3400-\u9fff\uf900-\ufaff]/.test(query))).toBe(true);
  });

  it("uses discovered candidate entities in later query rounds", async () => {
    const searchedQueries: string[] = [];
    const provider: HeavySearchProvider = {
      search: async (query) => {
        searchedQueries.push(query);
        if (searchedQueries.length <= 3) {
          return [
            {
              title: "Grace Brown - Andromeda Robotics founder interview",
              url: "https://example.com/interview",
              snippet: "Grace Brown leads Andromeda Robotics in Melbourne.",
              provider: "test"
            }
          ];
        }
        return [
          {
            title: "Andromeda Robotics Series A funding news",
            url: "https://andromedarobotics.ai/post/series-a-funding-news-fuel-for-our-zero-loneliness-vision",
            snippet: "Grace Brown and Andromeda Robotics announced funding.",
            provider: "test"
          }
        ];
      },
      read: async (result) => ({ ...result, snippet: result.snippet ?? "evidence", fullText: result.snippet ?? "evidence" })
    };

    await runAdaptiveResearch({
      prompt: "找澳大利亚创新硬件 CEO",
      task: task("article-ai-view_research", "AI 观点文章", "Find recent AI article by the CEO"),
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 5 }
    });

    const laterQueries = searchedQueries.slice(3).join(" ");
    expect(laterQueries).toContain("Grace Brown");
    expect(laterQueries).toContain("Andromeda Robotics");
  });

  it("selects official and reputable sources before generic pages", async () => {
    const results: HeavySearchResult[] = [
      { title: "Top startups list", url: "https://seo.example.com/list", snippet: "Generic listicle", provider: "test" },
      { title: "Andromeda Robotics official product", url: "https://andromedarobotics.ai/", snippet: "Official robotics company", provider: "test" },
      { title: "Business News Australia funding", url: "https://www.businessnewsaustralia.com/articles/robot-developer-andromeda-raises-23m-seriesa.html", snippet: "Funding and valuation", provider: "test" },
      { title: "LinkedIn Grace Brown AI post", url: "https://www.linkedin.com/posts/grace-brown-619b59161_linkedinnewsaustralia-linkedinnews-bigideas2026-activity-7404670028555481088-BPjf", snippet: "AI robotics post", provider: "test" }
    ];
    const readUrls: string[] = [];
    const provider: HeavySearchProvider = {
      search: async () => results,
      read: async (result) => {
        readUrls.push(result.url);
        return { ...result, snippet: result.snippet ?? "evidence", fullText: result.snippet ?? "evidence" };
      }
    };

    const output = await runAdaptiveResearch({
      prompt: "找澳大利亚创新硬件 CEO",
      task: task("company-fit_research", "公司画像", "Verify company hardware fit"),
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 3 }
    });

    expect(output.selectedResults.map((result) => result.url)).toEqual([
      "https://andromedarobotics.ai/",
      "https://www.linkedin.com/posts/grace-brown-619b59161_linkedinnewsaustralia-linkedinnews-bigideas2026-activity-7404670028555481088-BPjf",
      "https://www.businessnewsaustralia.com/articles/robot-developer-andromeda-raises-23m-seriesa.html"
    ]);
    expect(readUrls).toEqual(output.selectedResults.map((result) => result.url));
  });

  it("keeps wide selected results but only full-reads the strongest sources", async () => {
    const results: HeavySearchResult[] = Array.from({ length: 12 }, (_, index) => ({
      title: index === 0 ? "Andromeda Robotics official product" : `Andromeda Robotics evidence ${index}`,
      url: index === 0 ? "https://andromedarobotics.ai/" : `https://example.com/evidence-${index}`,
      snippet: "Grace Brown CEO founder leadership profile interview article funding Series A robotics hardware product AI.",
      provider: "test"
    }));
    const readUrls: string[] = [];
    const provider: HeavySearchProvider = {
      search: async () => results,
      read: async (result) => {
        readUrls.push(result.url);
        return { ...result, snippet: result.snippet ?? "evidence", fullText: `${result.snippet ?? "evidence"} full read` };
      }
    };

    const output = await runAdaptiveResearch({
      prompt: "find Australian robotics CEO",
      task: task("identity_research", "身份", "Identify CEO and company"),
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 12 }
    });

    expect(output.selectedResults).toHaveLength(12);
    expect(output.sources).toHaveLength(12);
    expect(readUrls).toHaveLength(8);
    expect(output.sources.filter((source) => source.fullText).length).toBe(8);
    expect(output.researchSteps.some((step) => step.type === "read" && step.title === "使用搜索摘要作为宽搜索来源")).toBe(true);
  });

  it("continues after one provider search failure and still finalizes", async () => {
    let searchCount = 0;
    const provider: HeavySearchProvider = {
      search: async () => {
        searchCount += 1;
        if (searchCount === 1) {
          throw new Error("temporary search outage");
        }
        return [
          {
            title: "Grace Brown - Andromeda Robotics CEO",
            url: "https://andromedarobotics.ai/",
            snippet: "Grace Brown leads Andromeda Robotics.",
            provider: "test"
          }
        ];
      },
      read: async (result) => ({ ...result, snippet: result.snippet ?? "evidence", fullText: result.snippet ?? "evidence" })
    };

    const output = await runAdaptiveResearch({
      prompt: "find Australian robotics CEO",
      task: task("identity_research", "身份", "Identify CEO and company"),
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 2 }
    });

    expect(output.searchLogs.some((log) => log.status === "error" && log.message?.includes("temporary search outage"))).toBe(true);
    expect(output.researchSteps.some((step) => step.type === "search" && step.decision === "continue")).toBe(true);
    expect(output.researchSteps.at(-1)?.type).toBe("finalize");
    expect(output.sources.length).toBeGreaterThan(0);
  });

  it("preserves provider trace search logs alongside local search logs", async () => {
    const providerTrace: SearchAttemptLog = {
      provider: "web",
      engine: "google",
      query: "provider internal trace",
      status: "done",
      results: [],
      timestamp: "2026-01-01T00:00:00.000Z",
      durationMs: 12
    };
    const localQueries: string[] = [];
    const provider: HeavySearchProvider = {
      search: async (query) => {
        localQueries.push(query);
        return [
          {
            title: "Andromeda Robotics",
            url: "https://andromedarobotics.ai/",
            snippet: "Robotics company led by Grace Brown.",
            provider: "test"
          }
        ];
      },
      read: async (result) => ({ ...result, snippet: result.snippet ?? "evidence", fullText: result.snippet ?? "evidence" }),
      drainSearchLogs: () => [providerTrace]
    };

    const output = await runAdaptiveResearch({
      prompt: "find Australian robotics CEO",
      task: task("company-fit_research", "公司画像", "Verify company hardware fit"),
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 1 }
    });

    expect(output.searchLogs).toContainEqual(providerTrace);
    expect(output.searchLogs.some((log) => localQueries.includes(log.query))).toBe(true);
  });

  it("ranks a real company domain above a generic page claiming official status", async () => {
    const results: HeavySearchResult[] = [
      {
        title: "Official Andromeda Robotics leadership profile",
        url: "https://profiles.example.com/andromeda-robotics-official",
        snippet: "Official page for Andromeda Robotics CEO information.",
        provider: "test"
      },
      {
        title: "Andromeda Robotics",
        url: "https://andromedarobotics.ai/",
        snippet: "Grace Brown leads Andromeda Robotics in Melbourne.",
        provider: "test"
      }
    ];
    const provider: HeavySearchProvider = {
      search: async () => results,
      read: async (result) => ({ ...result, snippet: result.snippet ?? "evidence", fullText: result.snippet ?? "evidence" })
    };

    const output = await runAdaptiveResearch({
      prompt: "Andromeda Robotics CEO",
      task: task("identity_research", "身份", "Identify CEO and company"),
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 1 }
    });

    expect(output.selectedResults[0]?.url).toBe("https://andromedarobotics.ai/");
  });

  it("records read errors and snippet fallback steps when source reading fails", async () => {
    const provider: HeavySearchProvider = {
      search: async () => [
        {
          title: "Andromeda Robotics",
          url: "https://andromedarobotics.ai/",
          snippet: "Snippet evidence about Grace Brown and Andromeda Robotics.",
          provider: "test"
        }
      ],
      read: async () => {
        throw new Error("read timeout");
      }
    };

    const output = await runAdaptiveResearch({
      prompt: "Andromeda Robotics CEO",
      task: task("identity_research", "身份", "Identify CEO and company"),
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 1 }
    });

    expect(output.sources).toHaveLength(1);
    expect(output.readLogs.some((log) => log.status === "error" && log.message?.includes("read timeout"))).toBe(true);
    expect(output.researchSteps.some((step) => step.type === "read" && /fallback|snippet/i.test(step.detail))).toBe(true);
  });

  it("emits research steps and provider search/read logs before the agent report is built", async () => {
    const emittedSteps: AgentResearchStep[] = [];
    const emittedSearchLogs: SearchAttemptLog[] = [];
    const emittedReadLogs: ReadAttemptLog[] = [];
    const searchTrace: SearchAttemptLog[] = [];
    const readTrace: ReadAttemptLog[] = [];
    const result: HeavySearchResult = {
      title: "Andromeda Robotics CEO profile",
      url: "https://andromedarobotics.ai/",
      snippet: "Grace Brown CEO founder leadership profile robotics hardware AI.",
      provider: "test"
    };
    const provider: HeavySearchProvider = {
      async search(query) {
        searchTrace.push({
          provider: "opencli",
          engine: "google",
          query,
          status: "done",
          results: [{ ...result, provider: "opencli", engine: "google" }],
          timestamp: "2026-07-01T00:00:00.100Z",
          durationMs: 11
        });
        return [result];
      },
      async read(item) {
        readTrace.push({
          provider: "opencli",
          status: "done",
          title: item.title,
          url: item.url,
          readCharCount: 1200,
          timestamp: "2026-07-01T00:00:00.200Z",
          durationMs: 22
        });
        return { ...item, snippet: item.snippet ?? "evidence", fullText: "Grace Brown leads Andromeda Robotics." };
      },
      drainSearchLogs: () => searchTrace.splice(0),
      drainReadLogs: () => readTrace.splice(0)
    };

    const output = await runAdaptiveResearch({
      prompt: "找澳大利亚创新硬件 CEO",
      task: task("identity_research", "身份", "Identify CEO and company"),
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 1 },
      onStep: (step) => emittedSteps.push(step),
      onSearchLog: (log) => emittedSearchLogs.push(log),
      onReadLog: (log) => emittedReadLogs.push(log)
    });

    expect(emittedSteps[0]).toMatchObject({ type: "intent", title: "识别任务意图" });
    expect(emittedSteps.some((step) => step.type === "search")).toBe(true);
    expect(emittedSearchLogs).toContainEqual(expect.objectContaining({ provider: "opencli", engine: "google", status: "done" }));
    expect(emittedReadLogs).toContainEqual(expect.objectContaining({ provider: "opencli", status: "done", url: result.url }));
    expect(output.searchLogs).toContainEqual(expect.objectContaining({ provider: "opencli", engine: "google", status: "done" }));
    expect(output.readLogs).toContainEqual(expect.objectContaining({ provider: "opencli", status: "done", url: result.url }));
  });
});

function task(id: string, title: string, objective: string): AgentTask {
  return {
    id,
    role: id,
    title,
    objective,
    questions: [`${objective} question`],
    searchHints: [`${objective} search hint`]
  };
}
