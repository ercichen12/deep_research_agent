import { describe, expect, it } from "vitest";
import { applyResearchStreamEvent, emptyResearchResult } from "@/lib/research-stream-state";
import type { ResearchStreamEvent } from "@/lib/types";

describe("applyResearchStreamEvent", () => {
  it("merges streamed progress into a renderable research response", () => {
    let state = emptyResearchResult();

    state = applyResearchStreamEvent(state, {
      type: "search_done",
      iteration: 1,
      timestamp: "2026-06-30T13:00:00.000Z",
      log: {
        engine: "google",
        query: "Australian robotics hardware CEO AI article",
        keywords: ["Australian", "robotics", "CEO", "AI"],
        iteration: 1,
        status: "done",
        results: [{ title: "Result", url: "https://example.com/result" }],
        timestamp: "2026-06-30T13:00:00.000Z"
      }
    });

    state = applyResearchStreamEvent(state, {
      type: "read_done",
      iteration: 1,
      timestamp: "2026-06-30T13:00:01.000Z",
      source: {
        title: "Result",
        url: "https://example.com/result",
        snippet: "Evidence",
        evidenceCharCount: 8
      }
    });

    const final: ResearchStreamEvent = {
      type: "final",
      timestamp: "2026-06-30T13:00:02.000Z",
      result: {
        ...state,
        report: "Final report",
        model: "test-model"
      }
    };
    state = applyResearchStreamEvent(state, final);

    expect(state.searchLogs).toHaveLength(1);
    expect(state.queries[0].query).toBe("Australian robotics hardware CEO AI article");
    expect(state.sources[0].url).toBe("https://example.com/result");
    expect(state.report).toBe("Final report");
  });
});
