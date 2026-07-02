import { describe, expect, it } from "vitest";
import { runDeepResearchLoop } from "@/lib/deep-research-loop";
import type { ResearchSource, SearchQueryPlan, SearchResult } from "@/lib/types";

describe("runDeepResearchLoop", () => {
  it("reads sources immediately after each search iteration before planning the next query", async () => {
    const events: string[] = [];

    await runDeepResearchLoop({
      prompt: "find Australian hardware CEO",
      initialQueries: [plan("first query")],
      maxIterations: 2,
      resultsPerIteration: 1,
      search: async (query) => {
        events.push(`search:${query.query}`);
        return [result(query.query)];
      },
      read: async (item) => {
        events.push(`read:${item.url}`);
        return source(item);
      },
      evaluate: async ({ iteration }) => {
        events.push(`evaluate:${iteration}`);
        return {
          summary: iteration === 1 ? "Need another query" : "No new high-value leads",
          candidates: [],
          conditionMatrix: [],
          nextQueries: iteration === 1 ? [plan("second query")] : [],
          stopReason: iteration === 2 ? "no_new_high_value_leads" : undefined
        };
      }
    });

    expect(events).toEqual([
      "search:first query",
      "read:https://example.com/first-query",
      "evaluate:1",
      "search:second query",
      "read:https://example.com/second-query",
      "evaluate:2"
    ]);
  });

  it("records per-iteration query, search, read, summary, and next-query logs", async () => {
    const loop = await runDeepResearchLoop({
      prompt: "find Australian hardware CEO",
      initialQueries: [plan("Australian robotics hardware CEO AI article")],
      maxIterations: 1,
      resultsPerIteration: 2,
      search: async (query) => [result(`${query.query} one`), result(`${query.query} two`)],
      read: async (item) => source(item),
      evaluate: async () => ({
        summary: "Andromeda is promising; growth still needs proof.",
        candidates: [
          {
            person: "Grace Brown",
            company: "Andromeda Robotics",
            status: "candidate",
            rationale: "Innovative robotics hardware; CEO and AI article evidence found."
          }
        ],
        conditionMatrix: [
          {
            candidate: "Grace Brown / Andromeda Robotics",
            condition: "annual growth >= 30%",
            status: "unknown",
            evidence: "No direct growth percentage found in this wave.",
            sourceUrls: []
          }
        ],
        nextQueries: [plan("Andromeda Robotics revenue growth rate 2025")],
        nextQueryReason: "Growth percentage remains unverified."
      })
    });

    expect(loop.iterations).toHaveLength(1);
    expect(loop.iterations[0]).toEqual(
      expect.objectContaining({
        iteration: 1,
        summary: "Andromeda is promising; growth still needs proof.",
        nextQueryReason: "Growth percentage remains unverified."
      })
    );
    expect(loop.iterations[0].queries[0].query).toBe("Australian robotics hardware CEO AI article");
    expect(loop.iterations[0].searchResults).toHaveLength(2);
    expect(loop.iterations[0].readSources).toHaveLength(2);
    expect(loop.candidates[0].company).toBe("Andromeda Robotics");
    expect(loop.conditionMatrix[0].status).toBe("unknown");
  });

  it("stops when evaluation returns no next queries", async () => {
    const loop = await runDeepResearchLoop({
      prompt: "find Australian hardware CEO",
      initialQueries: [plan("first query")],
      maxIterations: 5,
      search: async (query) => [result(query.query)],
      read: async (item) => source(item),
      evaluate: async () => ({
        summary: "No further useful search path.",
        candidates: [],
        conditionMatrix: [],
        nextQueries: [],
        stopReason: "no_new_high_value_leads"
      })
    });

    expect(loop.iterations).toHaveLength(1);
    expect(loop.stopReason).toBe("no_new_high_value_leads");
  });

  it("dedupes already-read URLs across iterations", async () => {
    const readUrls: string[] = [];

    const loop = await runDeepResearchLoop({
      prompt: "find Australian hardware CEO",
      initialQueries: [plan("first query")],
      maxIterations: 2,
      search: async () => [
        {
          title: "Same Result",
          url: "https://example.com/same"
        }
      ],
      read: async (item) => {
        readUrls.push(item.url);
        return source(item);
      },
      evaluate: async ({ iteration }) => ({
        summary: iteration === 1 ? "Try one more angle." : "No unread sources remain.",
        candidates: [],
        conditionMatrix: [],
        nextQueries: iteration === 1 ? [plan("second query")] : [],
        stopReason: iteration === 2 ? "no_unread_results" : undefined
      })
    });

    expect(readUrls).toEqual(["https://example.com/same"]);
    expect(loop.iterations).toHaveLength(2);
    expect(loop.iterations[1].readSources).toHaveLength(0);
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

function source(item: SearchResult): ResearchSource {
  return {
    ...item,
    snippet: `Evidence from ${item.title}`,
    fullText: `Full evidence from ${item.title}`,
    readCharCount: 1200,
    rawCharCount: 1400,
    evidenceCharCount: 200,
    extractionMethod: "opencli"
  };
}
