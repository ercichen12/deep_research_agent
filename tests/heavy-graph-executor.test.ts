import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeSearchAction } from "@/lib/heavy/graph/executor";
import { createResearchFrame } from "@/lib/heavy/graph/frame";
import { createResearchState, type SearchWebAction } from "@/lib/heavy/graph/types";
import { loadSourceArtifact } from "@/lib/heavy/storage";
import type { HeavySearchProvider, HeavySearchResult, HeavySource, ReadAttemptLog } from "@/lib/heavy/types";

describe("Graph Heavy executor ledger", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "heavy-graph-executor-"));
  });

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true });
  });

  it("preserves result provider/engine when a mock provider has no trace drain", async () => {
    const state = createResearchState({
      inquiryId: "inquiry_exec",
      turnId: "turn_exec",
      frame: createResearchFrame("找澳大利亚创新硬件 CEO"),
      budget: { maxSourcesToReadPerCycle: 1, maxTotalSourcesToRead: 2 }
    });

    const execution = await executeSearchAction({
      state,
      action: action(["Grace Brown Andromeda Robotics CEO"]),
      provider: {
        async search() {
          return [
            {
              title: "OpenCLI Google Result",
              url: "https://example.com/google",
              snippet: "Grace Brown CEO",
              provider: "opencli",
              engine: "google"
            }
          ];
        },
        async read(result) {
          return { ...result, snippet: result.snippet ?? "", fullText: result.snippet ?? "", readCharCount: 20 };
        }
      },
      storage: { rootDir }
    });

    expect(execution.artifact.providerCalls[0]).toMatchObject({
      provider: "opencli",
      engine: "google",
      query: "Grace Brown Andromeda Robotics CEO"
    });
    expect(execution.batch.providerCalls[0]).toMatchObject({
      provider: "opencli",
      engine: "google",
      resultCount: 1
    });
  });

  it("selects official/high-signal sources before low-signal search results", async () => {
    const state = createResearchState({
      inquiryId: "inquiry_exec",
      turnId: "turn_exec",
      frame: createResearchFrame("找澳大利亚创新硬件 CEO"),
      budget: { maxSourcesToReadPerCycle: 2, maxTotalSourcesToRead: 2 }
    });
    const readUrls: string[] = [];
    const provider = providerWithResults([
      result("Random forum", "https://forum.example/random", "some unrelated discussion", "duckduckgo"),
      result("Andromeda Robotics official team", "https://andromedarobotics.example/team", "Grace Brown CEO Australian robotics AI hardware", "google"),
      result("Grace Brown AI robotics interview", "https://news.example/interview", "Grace Brown AI robotics interview Australia", "brave")
    ], readUrls);

    await executeSearchAction({
      state,
      action: action(["Grace Brown Andromeda Robotics CEO"]),
      provider,
      storage: { rootDir }
    });

    expect(readUrls).toEqual(["https://andromedarobotics.example/team", "https://news.example/interview"]);
  });

  it("stores provider read attempts in source artifacts so OpenCLI fallback is visible", async () => {
    const readLogs: ReadAttemptLog[] = [
      {
        provider: "opencli",
        status: "error",
        title: "Andromeda Robotics official team",
        url: "https://andromedarobotics.example/team",
        message: "OpenCLI read failed",
        timestamp: "2026-07-02T00:00:00.000Z",
        durationMs: 5
      },
      {
        provider: "fetch",
        status: "done",
        title: "Andromeda Robotics official team",
        url: "https://andromedarobotics.example/team",
        readCharCount: 1200,
        timestamp: "2026-07-02T00:00:01.000Z",
        durationMs: 10
      }
    ];
    const state = createResearchState({
      inquiryId: "inquiry_exec",
      turnId: "turn_exec",
      frame: createResearchFrame("找澳大利亚创新硬件 CEO"),
      budget: { maxSourcesToReadPerCycle: 1, maxTotalSourcesToRead: 1 }
    });

    const execution = await executeSearchAction({
      state,
      action: action(["Grace Brown Andromeda Robotics CEO"]),
      provider: {
        async search() {
          return [result("Andromeda Robotics official team", "https://andromedarobotics.example/team", "Grace Brown CEO", "google")];
        },
        async read(resultItem) {
          return { ...resultItem, snippet: resultItem.snippet ?? "", fullText: "Grace Brown CEO", readCharCount: 1200 };
        },
        drainReadLogs() {
          return readLogs.splice(0);
        }
      },
      storage: { rootDir }
    });

    const artifact = await loadSourceArtifact(execution.sources[0].summary.sourceHash, { rootDir });

    expect(artifact?.readLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "opencli", status: "error" }),
        expect.objectContaining({ provider: "fetch", status: "done", readCharCount: 1200 })
      ])
    );
  });
});

function action(queries: string[]): SearchWebAction {
  return {
    id: "act_exec",
    type: "search_web",
    purpose: "executor test",
    rationale: "exercise executor behavior",
    priority: "high",
    queries,
    expectedSignals: ["Grace Brown", "CEO", "robotics", "AI hardware"],
    maxResults: 30
  };
}

function providerWithResults(results: HeavySearchResult[], readUrls: string[]): HeavySearchProvider {
  return {
    async search() {
      return results;
    },
    async read(resultItem): Promise<HeavySource> {
      readUrls.push(resultItem.url);
      return { ...resultItem, snippet: resultItem.snippet ?? "", fullText: resultItem.snippet ?? "", readCharCount: resultItem.snippet?.length ?? 0 };
    }
  };
}

function result(title: string, url: string, snippet: string, engine: string): HeavySearchResult {
  return {
    title,
    url,
    snippet,
    provider: "opencli",
    engine
  };
}
