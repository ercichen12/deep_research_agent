import { describe, expect, it } from "vitest";
import {
  buildPageReaderPrompt,
  formatSearchSummary,
  getOpenCliSearchEngines,
  humanizeSearchError,
  readAndAnalyzeSource,
  readSource,
  runResearch,
  selectResearchResults
} from "@/lib/research";
import type { ResearchSource, SearchQueryPlan, SearchResult } from "@/lib/types";

describe("selectResearchResults", () => {
  it("keeps high-intent seeds while reserving slots for OpenCLI discoveries", () => {
    const seeds = Array.from({ length: 7 }, (_, index) => result(`seed-${index}`, "Seed"));
    const openCliResults = Array.from({ length: 4 }, (_, index) => result(`opencli-${index}`, "OpenCLI"));

    const selected = selectResearchResults(seeds, openCliResults, 8);

    expect(selected).toHaveLength(8);
    expect(selected[0]).toEqual(seeds[0]);
    expect(selected.filter((item) => item.url.includes("opencli")).length).toBeGreaterThanOrEqual(3);
  });
});

describe("getOpenCliSearchEngines", () => {
  it("uses Google in addition to Brave and DuckDuckGo", () => {
    expect(getOpenCliSearchEngines()).toEqual(["google", "brave", "duckduckgo"]);
  });
});

describe("formatSearchSummary", () => {
  it("shows query keywords and result titles for auditability", () => {
    const summary = formatSearchSummary({
      query: "Andromeda Robotics Grace Brown CEO AI article growth Australia",
      keywords: ["Andromeda Robotics", "Grace Brown", "CEO", "AI", "Australia"],
      engine: "google",
      status: "done",
      results: [
        {
          title: "Grace Brown - Talent Corp CEO of Andromeda",
          url: "https://talentcorp.com.au/speakers/grace-brown/"
        }
      ]
    });

    expect(summary).toContain("关键词：Andromeda Robotics, Grace Brown, CEO, AI, Australia");
    expect(summary).toContain("查询：Andromeda Robotics Grace Brown CEO AI article growth Australia");
    expect(summary).toContain("Grace Brown - Talent Corp CEO of Andromeda");
  });
});

describe("humanizeSearchError", () => {
  it("turns OpenCLI empty-result stderr into a readable audit message", () => {
    const message = humanizeSearchError(
      "Command failed: cmd.exe /d /s /c npx.cmd -y @jackwener/opencli duckduckgo search Andromeda Robotics Grace Brown CEO AI article growth Australia --limit 6\nok: false\nerror:\n  code: EMPTY_RESULT\n  message: DuckDuckGo search returned no data\n  help: No DuckDuckGo results matched \"Andromeda Robotics Grace Brown CEO AI article growth Australia\".\n  exitCode: 66",
      "duckduckgo"
    );

    expect(message).toBe("DuckDuckGo returned 0 parsed results for this exact query; continuing with other engines.");
    expect(message).not.toContain("Command failed");
    expect(message).not.toContain("cmd.exe");
  });
});

describe("readSource", () => {
  it("falls back to direct fetch when OpenCLI returns only a tiny snippet", async () => {
    const target = result("andromeda", "Andromeda");
    const directSnippet = "Grace Brown Founder CEO Andromeda Robotics AI ".repeat(12);

    const source = await readSource(target, {
      openCli: async (): Promise<ResearchSource> => ({ ...target, snippet: "Home" }),
      fetch: async (): Promise<ResearchSource> => ({ ...target, snippet: directSnippet })
    });

    expect(source.snippet).toBe(directSnippet);
  });

  it("keeps the OpenCLI source if the direct fallback also fails", async () => {
    const target = result("fallback", "Fallback");

    const source = await readSource(target, {
      openCli: async (): Promise<ResearchSource> => ({ ...target, snippet: "Short" }),
      fetch: async (): Promise<ResearchSource> => {
        throw new Error("Fetch failed");
      }
    });

    expect(source.snippet).toBe("Short");
  });
});

describe("buildPageReaderPrompt", () => {
  it("passes long page text to a page-level reader and asks for evidence", () => {
    const prompt = buildPageReaderPrompt(
      "找澳大利亚创新硬件 CEO",
      {
        title: "Grace Brown - Talent Corp CEO of Andromeda",
        url: "https://talentcorp.com.au/speakers/grace-brown/",
        snippet: "Grace Brown is Co-Founder and CEO. ".repeat(400),
        fullText: "Grace Brown is Co-Founder and CEO. ".repeat(700),
        rawCharCount: 24000,
        readCharCount: 23800,
        extractionMethod: "opencli"
      }
    );

    expect(prompt).toContain("网页全文");
    expect(prompt).toContain("rawCharCount: 24000");
    expect(prompt).toContain("Grace Brown is Co-Founder and CEO");
    expect(prompt.length).toBeGreaterThan(10000);
  });
});

describe("readAndAnalyzeSource", () => {
  it("returns page-reader evidence while retaining full text metrics", async () => {
    const target = result("andromeda", "Andromeda");
    const analyzed = await readAndAnalyzeSource("找澳大利亚创新硬件 CEO", target, {
      readers: {
        openCli: async (): Promise<ResearchSource> => ({
          ...target,
          snippet: "Grace Brown CEO evidence. ".repeat(200),
          fullText: "Grace Brown CEO evidence. ".repeat(600),
          rawCharCount: 18000,
          readCharCount: 17000,
          extractionMethod: "opencli"
        }),
        fetch: async (): Promise<ResearchSource> => {
          throw new Error("not needed");
        }
      },
      analyze: async () => "证据笔记：Grace Brown 是 Andromeda Robotics 的 CEO。"
    });

    expect(analyzed.snippet).toBe("证据笔记：Grace Brown 是 Andromeda Robotics 的 CEO。");
    expect(analyzed.fullText?.length).toBeGreaterThan(10000);
    expect(analyzed.rawCharCount).toBe(18000);
    expect(analyzed.readCharCount).toBe(17000);
  });

  it("falls back to the full-text snippet if the page reader fails", async () => {
    const target = result("fallback-page-reader", "FallbackPageReader");

    const analyzed = await readAndAnalyzeSource("找澳大利亚创新硬件 CEO", target, {
      readers: {
        openCli: async (): Promise<ResearchSource> => ({
          ...target,
          snippet: "Long fallback evidence. ".repeat(200),
          fullText: "Long fallback evidence. ".repeat(400),
          rawCharCount: 12000,
          readCharCount: 10000,
          extractionMethod: "opencli"
        }),
        fetch: async (): Promise<ResearchSource> => {
          throw new Error("not needed");
        }
      },
      analyze: async () => {
        throw new Error("page reader failed");
      }
    });

    expect(analyzed.snippet).toContain("Long fallback evidence");
    expect(analyzed.evidenceCharCount).toBe(analyzed.snippet.length);
    expect(analyzed.fullText?.length).toBeGreaterThan(5000);
  });
});

describe("runResearch", () => {
  it("emits auditable progress events while the research loop runs", async () => {
    const events: string[] = [];

    await runResearch("find Australian innovative hardware CEO with recent AI article", {
      createRunId: () => "run_test_stream_events",
      buildInitialQueries: () => [plan("Australian robotics hardware CEO AI article")],
      search: async (query) => [result(query.query, "Search")],
      read: async (_prompt, item) => ({
        ...item,
        snippet: "Grace Brown is CEO of Andromeda Robotics and discusses AI robotics.",
        fullText: "Grace Brown is CEO of Andromeda Robotics and discusses AI robotics.",
        rawCharCount: 3200,
        readCharCount: 3100,
        evidenceCharCount: 180,
        extractionMethod: "opencli"
      }),
      evaluate: async () => ({
        summary: "Andromeda is promising; growth remains unverified.",
        candidates: [],
        conditionMatrix: [],
        nextQueries: [],
        stopReason: "no_next_queries"
      }),
      generateReport: async () => ({
        content: "报告：流式事件测试。",
        model: "test-model"
      }),
      writeLog: async () => "F:\\research-runs\\run_test_stream_events.json",
      onEvent: async (event) => {
        events.push(event.type);
      }
    });

    expect(events).toEqual(
      expect.arrayContaining(["run_started", "step", "search_done", "read_done", "iteration_done", "report_done", "log_saved", "final"])
    );
    expect(events[0]).toBe("run_started");
    expect(events.at(-1)).toBe("final");
    expect(events.indexOf("read_done")).toBeLessThan(events.indexOf("iteration_done"));
    expect(events.indexOf("iteration_done")).toBeLessThan(events.indexOf("report_done"));
  });

  it("returns iterative Deep Solve logs and persists them with the run log", async () => {
    let capturedLog: unknown;

    const response = await runResearch("找澳大利亚创新硬件 CEO，最近发表 AI 文章", {
      createRunId: () => "run_test_deep_solve",
      buildInitialQueries: () => [plan("Australian robotics hardware CEO AI article")],
      search: async (query) => [result(query.query, "Search")],
      read: async (_prompt, item) => ({
        ...item,
        snippet: "Grace Brown is CEO of Andromeda Robotics and discusses AI robotics.",
        fullText: "Grace Brown is CEO of Andromeda Robotics and discusses AI robotics.",
        rawCharCount: 3200,
        readCharCount: 3100,
        evidenceCharCount: 180,
        extractionMethod: "opencli"
      }),
      evaluate: async () => ({
        summary: "Andromeda is a strong candidate; growth remains unverified.",
        candidates: [
          {
            person: "Grace Brown",
            company: "Andromeda Robotics",
            status: "candidate",
            rationale: "Evidence supports robotics hardware and AI commentary."
          }
        ],
        conditionMatrix: [
          {
            candidate: "Grace Brown / Andromeda Robotics",
            condition: "annual growth >= 30%",
            status: "unknown",
            evidence: "The read source did not prove annual growth.",
            sourceUrls: []
          }
        ],
        nextQueries: [],
        stopReason: "no_next_queries"
      }),
      generateReport: async () => ({
        content: "报告：Grace Brown / Andromeda Robotics 是候选，但增长率待验证。",
        model: "test-model"
      }),
      writeLog: async (log) => {
        capturedLog = log;
        return "F:\\research-runs\\run_test_deep_solve.json";
      }
    });

    expect(response.iterations).toHaveLength(1);
    expect(response.iterations?.[0].queries[0].query).toBe("Australian robotics hardware CEO AI article");
    expect(response.iterations?.[0].readSources.length).toBeGreaterThanOrEqual(1);
    expect(response.candidates?.[0].company).toBe("Andromeda Robotics");
    expect(response.conditionMatrix?.[0].status).toBe("unknown");
    expect(response.stopReason).toBe("no_next_queries");
    expect(response.searchLogPath).toBe("F:\\research-runs\\run_test_deep_solve.json");
    expect(capturedLog).toEqual(
      expect.objectContaining({
        runId: "run_test_deep_solve",
        iterations: expect.arrayContaining([
          expect.objectContaining({
            iteration: 1,
            summary: "Andromeda is a strong candidate; growth remains unverified."
          })
        ]),
        conditionMatrix: expect.arrayContaining([
          expect.objectContaining({
            condition: "annual growth >= 30%",
            status: "unknown"
          })
        ])
      })
    );
  });
});

function result(id: string, titlePrefix: string): SearchResult {
  return {
    title: `${titlePrefix} ${id}`,
    url: `https://${titlePrefix.toLowerCase()}.example/${id}`
  };
}

function plan(query: string): SearchQueryPlan {
  return {
    query,
    keywords: query.split(/\s+/),
    rationale: `Search for ${query}`
  };
}
