import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGraphHeavyInquiry, startGraphHeavyInquiry } from "@/lib/heavy/graph/graph-orchestrator";
import { loadGraphState, loadInquiry, loadSearchBatchArtifact, loadSourceArtifact, readTurnEvents } from "@/lib/heavy/storage";
import type { HeavySearchProvider, HeavySearchResult, HeavySource } from "@/lib/heavy/types";

describe("Graph Heavy orchestrator", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "heavy-graph-orchestrator-"));
  });

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true });
  });

  it("runs a real graph cycle and finalizes a maximum-likelihood candidate with artifacts", async () => {
    const provider = mockProvider();
    const inquiry = await runGraphHeavyInquiry(
      "我要找一个公司的CEO，这个公司是做有创新性的硬件，但是不能做太阳能板，也不能做医疗器械，也不能做重工制造。公司每年最好能增长30%。这个人最好在澳大利亚，在这个企业做了三年以上，并且最近发表过包含AI观点的文章。",
      {
        rootDir,
        awaitCompletion: true,
        provider,
        budget: {
          maxCycles: 3,
          maxActionsPerCycle: 3,
          maxSearchActionsPerCycle: 2,
          maxQueriesPerSearchAction: 2,
          maxResultsPerQuery: 30,
          maxSourcesToReadPerCycle: 4,
          maxTotalSourcesToRead: 8,
          maxPromotedCandidates: 4
        }
      }
    );

    const turn = inquiry.turns[0];
    const persisted = await loadInquiry(inquiry.id, { rootDir });
    const state = await loadGraphState(turn.id, { rootDir });
    const logRaw = await readFile(join(rootDir, "logs", `${turn.id}.ndjson`), "utf8");
    const events = logRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; batch?: { id: string }; source?: { sourceHash: string } });

    expect(persisted?.turns[0].status).toBe("completed");
    expect(persisted?.turns[0].finalReport?.markdown).toContain("Grace Brown / Andromeda Robotics");
    expect(state?.candidatePool[0]?.name).toBe("Grace Brown / Andromeda Robotics");
    expect(["promoted", "ranked"]).toContain(state?.candidatePool[0]?.status);
    expect(state?.evidenceMatrix.cells.some((cell) => cell.status === "direct")).toBe(true);
    expect(state?.evidenceMatrix.cells.some((cell) => cell.status === "proxy" || cell.status === "missing")).toBe(true);
    expect(state?.searchLedger[0].providerCalls.some((call) => call.provider === "opencli" && call.engine === "google")).toBe(true);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "frame_created",
        "cycle_started",
        "actions_planned",
        "search_batch_reported",
        "source_selected",
        "source_read",
        "evidence_extracted",
        "candidate_promoted",
        "state_evaluated",
        "ranking_completed",
        "graph_final_reported",
        "turn_completed"
      ])
    );
    expect(state?.sourceLedger.some((source) => source.evidenceIds.length > 0)).toBe(true);

    const batchId = events.find((event) => event.type === "search_batch_reported")?.batch?.id;
    expect(batchId).toBeTruthy();
    const batch = await loadSearchBatchArtifact(batchId ?? "", { rootDir });
    expect(batch?.providerCalls[0].results.length).toBeGreaterThan(0);

    const sourceHash = events.find((event) => event.type === "source_read")?.source?.sourceHash;
    expect(sourceHash).toBeTruthy();
    const source = await loadSourceArtifact(sourceHash ?? "", { rootDir });
    expect(source?.excerpt).toContain("Grace Brown");
    expect(source?.fullText).toBeUndefined();
  });

  it("emits search batch events before slow source reads finish", async () => {
    const readGate = deferred<void>();
    let readStarted = false;
    const provider: HeavySearchProvider = {
      async search(query) {
        return [
          {
            title: "Andromeda Robotics Team Grace Brown CEO",
            url: "https://andromedarobotics.example/team",
            snippet: `Grace Brown is CEO of Andromeda Robotics. Query: ${query}`,
            provider: "opencli",
            engine: "brave"
          }
        ];
      },
      async read(result) {
        readStarted = true;
        await readGate.promise;
        return {
          ...result,
          snippet: result.snippet ?? "",
          fullText: "Grace Brown is CEO of Andromeda Robotics. Andromeda Robotics builds Australian robotics AI hardware.",
          readCharCount: 96
        };
      }
    };

    const { turnId } = await startGraphHeavyInquiry("找澳大利亚创新硬件 CEO", {
      rootDir,
      awaitCompletion: false,
      provider,
      budget: {
        maxCycles: 1,
        maxActionsPerCycle: 1,
        maxSearchActionsPerCycle: 1,
        maxQueriesPerSearchAction: 1,
        maxResultsPerQuery: 30,
        maxSourcesToReadPerCycle: 1,
        maxTotalSourcesToRead: 1,
        maxPromotedCandidates: 2
      }
    });

    try {
      await waitUntil(() => readStarted, 1000);
      const eventsBeforeReadCompletes = await readTurnEvents(turnId, { rootDir });
      const eventTypes = eventsBeforeReadCompletes.map((event) => event.type);

      expect(eventTypes).toContain("search_batch_reported");
      expect(eventTypes).toContain("source_selected");
      expect(eventTypes).not.toContain("source_read");
    } finally {
      readGate.resolve();
      await waitForEvent(turnId, "turn_completed", rootDir, 1500).catch(() => undefined);
    }
  });

  it("fails clearly when no evidence is found and budget is exhausted", async () => {
    const inquiry = await runGraphHeavyInquiry("Find an impossible candidate with no public evidence", {
      rootDir,
      awaitCompletion: true,
      provider: emptyProvider(),
      budget: {
        maxCycles: 1,
        maxActionsPerCycle: 1,
        maxSearchActionsPerCycle: 1,
        maxQueriesPerSearchAction: 1,
        maxResultsPerQuery: 30,
        maxSourcesToReadPerCycle: 2,
        maxTotalSourcesToRead: 2,
        maxPromotedCandidates: 2
      }
    });

    const turn = inquiry.turns[0];
    const state = await loadGraphState(turn.id, { rootDir });

    expect(turn.status).toBe("failed");
    expect(turn.error).toContain("证据不足");
    expect(state?.status).toBe("failed");
  });

  it("does not finalize HS8542 workflow as a synthetic 100-point candidate", async () => {
    const inquiry = await runGraphHeavyInquiry(
      "用 HS8542 海关数据做客户分群，要包括清洗、实体合并、同行识别、客户分级、存储架构，以及 EOL/HTF 的外部验证边界。请用英文搜索关键词，不要用中文搜索关键词。",
      {
        rootDir,
        awaitCompletion: true,
        provider: customsWorkflowProvider(),
        budget: {
          maxCycles: 4,
          maxActionsPerCycle: 4,
          maxSearchActionsPerCycle: 2,
          maxQueriesPerSearchAction: 3,
          maxResultsPerQuery: 30,
          maxSourcesToReadPerCycle: 6,
          maxTotalSourcesToRead: 18,
          maxPromotedCandidates: 4
        }
      }
    );

    const turn = inquiry.turns[0];
    const state = await loadGraphState(turn.id, { rootDir });
    const events = await readTurnEvents(turn.id, { rootDir });
    const workflowArtifacts = (state as unknown as { workflowArtifacts?: Array<{ stage: string; title: string }> })?.workflowArtifacts ?? [];

    expect(turn.status).toBe("completed");
    expect(state?.frame.taskKind).toBe("data_workflow_design");
    expect(state?.cycleIndex).toBeGreaterThanOrEqual(2);
    expect(state?.candidatePool.some((candidate) => candidate.kind === "workflow")).toBe(false);
    expect(workflowArtifacts.map((artifact) => artifact.stage)).toEqual(expect.arrayContaining(["draft", "critique", "revision"]));
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["workflow_artifact_reported", "state_evaluated", "graph_final_reported"]));
    expect(turn.finalReport?.summary).not.toContain("候选");
    expect(turn.finalReport?.summary).toMatch(/workflow|路径|流程/i);
    expect(turn.finalReport?.markdown).toMatch(/HS code|HS8542/i);
    expect(turn.finalReport?.markdown).toMatch(/cannot be inferred|不能.*推断|外部验证/i);
    expect(turn.finalReport?.markdown).toMatch(/ordered gates|有序|gate|步骤/i);
  });
});

function mockProvider(): HeavySearchProvider {
  const searchLogs: ReturnType<NonNullable<HeavySearchProvider["drainSearchLogs"]>> = [];
  const readLogs: ReturnType<NonNullable<HeavySearchProvider["drainReadLogs"]>> = [];
  return {
    async search(query, limit = 30) {
      const results: HeavySearchResult[] = [
        {
          title: "Andromeda Robotics Team Grace Brown CEO",
          url: "https://andromedarobotics.example/team",
          snippet: "Grace Brown is CEO of Andromeda Robotics, an Australian robotics AI hardware company.",
          provider: "opencli" as const,
          engine: "google" as const
        },
        {
          title: "Grace Brown interview on AI robotics",
          url: "https://news.example/grace-brown-ai-robotics",
          snippet: "Grace Brown discussed AI in robotics and hardware deployment in Australia.",
          provider: "opencli" as const,
          engine: "brave" as const
        },
        {
          title: "Andromeda Robotics funding and expansion",
          url: "https://funding.example/andromeda-robotics-growth",
          snippet: "Andromeda Robotics raised funding and expanded manufacturing, a proxy for growth.",
          provider: "opencli" as const,
          engine: "duckduckgo" as const
        }
      ].slice(0, limit);
      searchLogs.push({
        provider: "opencli",
        engine: "google",
        query,
        status: "done",
        results,
        timestamp: "2026-07-02T00:00:00.000Z",
        durationMs: 10
      });
      return results;
    },
    async read(result) {
      const source: HeavySource = {
        ...result,
        snippet: result.snippet ?? "",
        fullText:
          result.url.includes("/team")
            ? "Grace Brown is CEO of Andromeda Robotics. Andromeda Robotics builds Australian robotics AI hardware."
            : result.url.includes("funding")
              ? "Andromeda Robotics raised funding and expanded production. This is proxy evidence for growth, not exact 30% annual growth."
              : "Grace Brown recently published views about AI and robotics hardware.",
        readCharCount: 160
      };
      readLogs.push({
        provider: "opencli",
        status: "done",
        title: source.title,
        url: source.url,
        readCharCount: source.fullText?.length,
        timestamp: "2026-07-02T00:00:01.000Z",
        durationMs: 10
      });
      return source;
    },
    drainSearchLogs() {
      return searchLogs.splice(0);
    },
    drainReadLogs() {
      return readLogs.splice(0);
    }
  };
}

function emptyProvider(): HeavySearchProvider {
  return {
    async search() {
      return [];
    },
    async read(result) {
      return { ...result, snippet: result.snippet ?? "", fullText: "" };
    }
  };
}

function customsWorkflowProvider(): HeavySearchProvider {
  const searchLogs: ReturnType<NonNullable<HeavySearchProvider["drainSearchLogs"]>> = [];
  const readLogs: ReturnType<NonNullable<HeavySearchProvider["drainReadLogs"]>> = [];
  const sources: HeavySearchResult[] = [
    {
      title: "Customs data cleaning and importer exporter entity resolution workflow",
      url: "https://trade.example/customs-data-entity-resolution",
      snippet:
        "Customs data workflows require data cleaning, importer exporter entity resolution, deduplication, peer detection, customer segmentation, and storage schema design.",
      provider: "opencli",
      engine: "google"
    },
    {
      title: "HS and HTS codes classify goods but cannot prove EOL HTF lifecycle status",
      url: "https://lifecycle.example/hs-code-eol-htf-boundary",
      snippet:
        "HS code and HTS classification identify product categories, but EOL, HTF, obsolete status, allocation risk, and lifecycle fit require external supplier or lifecycle database verification.",
      provider: "opencli",
      engine: "brave"
    },
    {
      title: "Customer tiering from trade data needs ordered gates",
      url: "https://analytics.example/trade-data-customer-tiering-gates",
      snippet:
        "An ordered workflow should clean records, merge entities, exclude manufacturers, verify external EOL HTF signals, score demand, and tier customers with A/B/C/D/E grades.",
      provider: "opencli",
      engine: "duckduckgo"
    }
  ];

  return {
    async search(query, limit = 30) {
      const results = sources.slice(0, limit);
      searchLogs.push({
        provider: "opencli",
        engine: "google",
        query,
        status: "done",
        results,
        timestamp: "2026-07-02T00:00:00.000Z",
        durationMs: 10
      });
      return results;
    },
    async read(result) {
      const fullText = [
        result.snippet ?? "",
        "Workflow draft: clean HS8542 customs records, normalize descriptions, merge importer/exporter entities, detect peers from shipment patterns, segment customers by volume/value and recency, and store a schema with raw records, normalized entities, evidence, scores, and audit logs.",
        "Critique: HS code alone cannot prove EOL or HTF status. Product description alone cannot prove obsolete inventory. FOR MANUFACTURING can be a manufacturer exclusion signal and should not be scored as a buyer signal without verification.",
        "Revision: use ordered gates: data cleaning, entity merge, manufacturer exclusion, external lifecycle verification, demand scoring, customer tiering, storage/audit outputs."
      ].join("\n");
      const source: HeavySource = {
        ...result,
        snippet: result.snippet ?? "",
        fullText,
        readCharCount: fullText.length
      };
      readLogs.push({
        provider: "opencli",
        status: "done",
        title: source.title,
        url: source.url,
        readCharCount: source.fullText?.length,
        timestamp: "2026-07-02T00:00:01.000Z",
        durationMs: 10
      });
      return source;
    },
    drainSearchLogs() {
      return searchLogs.splice(0);
    },
    drainReadLogs() {
      return readLogs.splice(0);
    }
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

async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

async function waitForEvent(turnId: string, type: string, rootDir: string, timeoutMs: number): Promise<void> {
  await waitUntil(async () => (await readTurnEvents(turnId, { rootDir })).some((event) => event.type === type), timeoutMs);
}
