import { existsSync, readFileSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildResearchLogPath } from "@/lib/research-log";
import { runResearch } from "@/lib/research";
import type { ResearchSource, SearchQueryPlan, SearchResult } from "@/lib/types";

const RUN_ID = "run_test_e2e_deep_solve_loop";

describe("research endpoint core flow", () => {
  afterEach(() => {
    const logPath = buildResearchLogPath(RUN_ID);
    if (existsSync(logPath)) {
      rmSync(logPath);
    }
  });

  it("writes an auditable Deep Solve Loop log with iterations and condition matrix", async () => {
    const response = await runResearch("find Australian innovative hardware chief executive with recent AI article and 30 percent growth", {
      createRunId: () => RUN_ID,
      buildInitialQueries: () => [plan("Australian robotics hardware CEO AI article")],
      maxIterations: 2,
      search: async (query, iteration) =>
        iteration === 1
          ? [result("Grace Brown Andromeda Robotics CEO AI")]
          : [result("Andromeda Robotics revenue growth rate")],
      read: async (_prompt, item, iteration) => source(item, iteration),
      evaluate: async ({ iteration, readSources }) => ({
        summary: iteration === 1 ? "找到 Grace Brown / Andromeda 线索，但增长率未证实。" : "第二轮仍未找到直接 30% 增长证据。",
        candidates: [
          {
            person: "Grace Brown",
            company: "Andromeda Robotics",
            status: "candidate",
            rationale: "本轮来源支持其 CEO 身份与机器人硬件方向。"
          }
        ],
        conditionMatrix: [
          {
            candidate: "Grace Brown / Andromeda Robotics",
            condition: "innovative hardware",
            status: "confirmed",
            evidence: readSources[0]?.snippet ?? "Robotics evidence",
            sourceUrls: readSources.map((source) => source.url)
          },
          {
            candidate: "Grace Brown / Andromeda Robotics",
            condition: "annual growth >= 30%",
            status: "unknown",
            evidence: "No direct annual growth percentage found.",
            sourceUrls: []
          }
        ],
        nextQueries: iteration === 1 ? [plan("Andromeda Robotics revenue growth rate 2025")] : [],
        nextQueryReason: iteration === 1 ? "增长率仍缺直接证据。" : "",
        stopReason: iteration === 2 ? "no_new_high_value_leads" : undefined
      }),
      generateReport: async ({ iterations, conditionMatrix }) => ({
        content: `报告生成，轮次=${iterations.length}，矩阵=${conditionMatrix.length}`,
        model: "test-model"
      })
    });

    const logPath = buildResearchLogPath(RUN_ID);
    expect(response.iterations).toHaveLength(2);
    expect(response.stopReason).toBe("no_new_high_value_leads");
    expect(response.searchLogPath).toBe(logPath);
    expect(existsSync(logPath)).toBe(true);

    const log = JSON.parse(readFileSync(logPath, "utf8")) as {
      iterations?: unknown[];
      conditionMatrix?: unknown[];
      selectedSources?: unknown[];
      stopReason?: string;
    };

    expect(log.iterations).toHaveLength(2);
    expect(log.conditionMatrix).toHaveLength(2);
    expect(log.selectedSources).toHaveLength(2);
    expect(log.stopReason).toBe("no_new_high_value_leads");
  });
});

function plan(query: string): SearchQueryPlan {
  return {
    query,
    keywords: query.split(/\s+/),
    rationale: `Search for ${query}`
  };
}

function result(id: string): SearchResult {
  return {
    title: `Result ${id}`,
    url: `https://example.com/${id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
  };
}

function source(item: SearchResult, iteration: number): ResearchSource {
  return {
    ...item,
    snippet: `Iteration ${iteration} evidence from ${item.title}`,
    fullText: `Iteration ${iteration} full evidence from ${item.title}`,
    rawCharCount: 5000,
    readCharCount: 4500,
    evidenceCharCount: 240,
    extractionMethod: "opencli"
  };
}
