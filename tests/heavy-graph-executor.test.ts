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

  it("caps workflow reads to keep Apodex-style workflow runs from stalling on too many sources", async () => {
    const state = createResearchState({
      inquiryId: "inquiry_exec",
      turnId: "turn_exec",
      frame: createResearchFrame("用 HS8542 海关数据做客户分群，要包括清洗、实体合并、同行识别、客户分级、存储架构，以及 EOL/HTF 的外部验证边界。"),
      budget: { maxSourcesToReadPerCycle: 12, maxTotalSourcesToRead: 12 }
    });
    const readUrls: string[] = [];
    const results = Array.from({ length: 12 }, (_, index) =>
      result(`HS8542 customs data source ${index}`, `https://trade.example/source-${index}`, "customs data entity resolution customer segmentation", "google")
    );

    const execution = await executeSearchAction({
      state,
      action: action(["HS8542 customs data entity resolution customer segmentation"]),
      provider: providerWithResults(results, readUrls),
      storage: { rootDir }
    });

    expect(readUrls).toHaveLength(6);
    expect(execution.sources).toHaveLength(6);
  });

  it("runs independent query searches and source reads concurrently", async () => {
    const state = createResearchState({
      inquiryId: "inquiry_exec",
      turnId: "turn_exec",
      frame: createResearchFrame("用 HS8542 海关数据做客户分群，要包括清洗、实体合并、同行识别、客户分级、存储架构，以及 EOL/HTF 的外部验证边界。"),
      budget: { maxSourcesToReadPerCycle: 6, maxTotalSourcesToRead: 6 }
    });
    let activeSearches = 0;
    let maxActiveSearches = 0;
    let activeReads = 0;
    let maxActiveReads = 0;

    await executeSearchAction({
      state,
      action: action(["HS8542 customs data", "semiconductor shipment entity resolution", "EOL HTF inventory verification"]),
      provider: {
        async search(query) {
          activeSearches += 1;
          maxActiveSearches = Math.max(maxActiveSearches, activeSearches);
          await delay(20);
          activeSearches -= 1;
          return [
            result(`${query} source 1`, `https://trade.example/${encodeURIComponent(query)}-1`, "customs data entity resolution", "google"),
            result(`${query} source 2`, `https://trade.example/${encodeURIComponent(query)}-2`, "customer segmentation lifecycle verification", "brave")
          ];
        },
        async read(resultItem): Promise<HeavySource> {
          activeReads += 1;
          maxActiveReads = Math.max(maxActiveReads, activeReads);
          await delay(20);
          activeReads -= 1;
          return { ...resultItem, snippet: resultItem.snippet ?? "", fullText: resultItem.snippet ?? "", readCharCount: resultItem.snippet?.length ?? 0 };
        }
      },
      storage: { rootDir }
    });

    expect(maxActiveSearches).toBeGreaterThan(1);
    expect(maxActiveReads).toBeGreaterThan(1);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
