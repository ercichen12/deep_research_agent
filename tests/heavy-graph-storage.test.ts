import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendTurnEvent,
  createInquiry,
  listInquiries,
  loadGraphState,
  loadSearchBatchArtifact,
  loadSourceArtifact,
  saveGraphState,
  saveSearchBatchArtifact,
  saveSourceArtifact
} from "@/lib/heavy/storage";
import { DEFAULT_GRAPH_BUDGET, createResearchState, normalizeResearchFrame } from "@/lib/heavy/graph/types";
import type { SearchBatchArtifact, SourceArtifact } from "@/lib/heavy/graph/types";

describe("Graph Heavy storage and artifacts", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "heavy-graph-storage-"));
  });

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true });
  });

  it("saves and reloads graph state outside the inquiry directory", async () => {
    const { inquiry, turn } = await createInquiry("验证 Cloudflare 子域名", { rootDir });
    const frame = normalizeResearchFrame({
      taskKind: "technical_verification",
      userGoal: turn.prompt,
      deliverable: "可行性结论",
      hardConstraints: [{ id: "ns_delegation", label: "authoritative NS delegation", core: true }]
    });
    const state = createResearchState({ inquiryId: inquiry.id, turnId: turn.id, frame, budget: DEFAULT_GRAPH_BUDGET });
    state.cycleIndex = 2;

    await saveGraphState(state, { rootDir });
    const loaded = await loadGraphState(turn.id, { rootDir });
    const listed = await listInquiries({ rootDir });

    expect(loaded?.turnId).toBe(turn.id);
    expect(loaded?.cycleIndex).toBe(2);
    expect(listed.map((item) => item.id)).toEqual([inquiry.id]);
    expect(await readFile(join(rootDir, "graph-state", `${turn.id}.json`), "utf8")).toContain("technical_verification");
  });

  it("stores search batch artifacts with full provider call results", async () => {
    const artifact: SearchBatchArtifact = {
      id: "batch_turn_1_1_act_1_abc123",
      inquiryId: "inquiry_1",
      turnId: "turn_1",
      actionId: "act_1",
      cycle: 1,
      queries: ["Grace Brown Andromeda Robotics CEO"],
      providerCalls: [
        {
          provider: "opencli",
          engine: "google",
          query: "Grace Brown Andromeda Robotics CEO",
          status: "done",
          durationMs: 123,
          results: [
            {
              title: "Andromeda Robotics Team",
              url: "https://andromedarobotics.example/team",
              snippet: "Grace Brown CEO",
              provider: "opencli",
              engine: "google"
            }
          ]
        },
        {
          provider: "relay",
          engine: "relay",
          query: "Grace Brown Andromeda Robotics CEO",
          status: "error",
          durationMs: 33,
          results: [],
          message: "provider rejected sk-test-secret-value"
        }
      ],
      dedupedResults: [
        {
          title: "Andromeda Robotics Team",
          url: "https://andromedarobotics.example/team",
          snippet: "Grace Brown CEO",
          provider: "opencli",
          engine: "google"
        }
      ],
      createdAt: "2026-07-02T00:00:00.000Z"
    };

    await saveSearchBatchArtifact(artifact, { rootDir });
    const loaded = await loadSearchBatchArtifact("batch_turn_1_1_act_1_abc123", { rootDir });
    const raw = await readFile(join(rootDir, "search-batches", "batch_turn_1_1_act_1_abc123.json"), "utf8");

    expect(loaded?.providerCalls[0].results).toHaveLength(1);
    expect(raw).not.toContain("sk-test-secret-value");
    expect(raw).toContain("[redacted-secret]");
  });

  it("stores source artifacts and returns safe excerpts instead of requiring full text in events", async () => {
    const artifact: SourceArtifact = {
      sourceHash: "abc123source",
      inquiryId: "inquiry_1",
      turnId: "turn_1",
      title: "Cloudflare DNS docs",
      url: "https://developers.cloudflare.com/dns/",
      provider: "opencli",
      engine: "google",
      status: "read",
      readCharCount: 20_000,
      fullText: "A".repeat(13_000),
      createdAt: "2026-07-02T00:00:00.000Z"
    };

    await saveSourceArtifact(artifact, { rootDir });
    const loaded = await loadSourceArtifact("abc123source", { rootDir });

    expect(loaded?.fullText).toBeUndefined();
    expect(loaded?.excerpt).toHaveLength(12_000);
    expect(loaded?.url).toBe("https://developers.cloudflare.com/dns/");
  });

  it("redacts graph events and keeps them as single-line summaries", async () => {
    await appendTurnEvent(
      {
        type: "cycle_started",
        inquiryId: "inquiry_1",
        turnId: "turn_1",
        cycle: 1,
        timestamp: "2026-07-02T00:00:00.000Z"
      },
      { rootDir }
    );
    await appendTurnEvent(
      {
        type: "search_batch_reported",
        inquiryId: "inquiry_1",
        turnId: "turn_1",
        cycle: 1,
        actionId: "act_1",
        batch: {
          id: "batch_1",
          actionId: "act_1",
          cycle: 1,
          queryCount: 1,
          providerCalls: [
            {
              provider: "relay",
              engine: "relay",
              query: "Cloudflare DNS delegation",
              status: "error",
              resultCount: 0,
              durationMs: 20,
              artifactId: "search_1",
              message: "sk-test-secret-value"
            }
          ],
          dedupedResultCount: 0,
          uniqueDomainCount: 0,
          expectedSignalHits: [],
          officialOrPrimaryCount: 0,
          candidateMentions: [],
          quality: "empty"
        },
        timestamp: "2026-07-02T00:00:01.000Z"
      },
      { rootDir }
    );

    const raw = await readFile(join(rootDir, "logs", "turn_1.ndjson"), "utf8");

    expect(raw.trim().split("\n")).toHaveLength(2);
    expect(raw).toContain("search_batch_reported");
    expect(raw).not.toContain("sk-test-secret-value");
    expect(raw).toContain("[redacted-secret]");
  });
});
