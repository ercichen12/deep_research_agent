import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInquiryGetHandler, createInquiryPostHandler } from "@/app/api/inquiries/route";
import { createSearchBatchArtifactGetHandler } from "@/app/api/inquiries/[id]/artifacts/search-batches/[batchId]/route";
import { createSourceArtifactGetHandler } from "@/app/api/inquiries/[id]/artifacts/sources/[sourceHash]/route";
import { createInquiryByIdGetHandler } from "@/app/api/inquiries/[id]/route";
import { createInquiryStreamGetHandler } from "@/app/api/inquiries/[id]/stream/route";
import { appendTurnEvent, createInquiry, saveGraphState, saveInquiry, saveSearchBatchArtifact, saveSourceArtifact } from "@/lib/heavy/storage";
import { DEFAULT_GRAPH_BUDGET, createResearchState, normalizeResearchFrame } from "@/lib/heavy/graph/types";

describe("Heavy inquiry API routes", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "heavy-api-"));
  });

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true });
  });

  it("POST /api/inquiries returns inquiryId and turnId", async () => {
    const handler = createInquiryPostHandler({
      start: async () => ({ inquiryId: "inquiry_1", turnId: "turn_1" })
    });

    const response = await handler(
      new Request("http://localhost/api/inquiries", {
        method: "POST",
        body: JSON.stringify({ prompt: "请研究一个足够完整的问题" })
      })
    );

    await expect(response.json()).resolves.toEqual({ inquiryId: "inquiry_1", turnId: "turn_1" });
  });

  it("GET /api/inquiries and GET /api/inquiries/:id return stored inquiry JSON", async () => {
    const { inquiry } = await createInquiry("请研究一个公司", { rootDir });
    inquiry.status = "completed";
    await saveInquiry(inquiry, { rootDir });

    const listResponse = await createInquiryGetHandler({ rootDir })();
    const itemResponse = await createInquiryByIdGetHandler({ rootDir })(
      new Request(`http://localhost/api/inquiries/${inquiry.id}`),
      { params: { id: inquiry.id } }
    );

    const listJson = await listResponse.json();
    const itemJson = await itemResponse.json();

    expect(listJson.inquiries[0].id).toBe(inquiry.id);
    expect(itemJson.id).toBe(inquiry.id);
    expect(itemJson.turns[0].runs).toEqual([]);
  });

  it("GET /api/inquiries/:id hydrates latest graphState summary when graph-state exists", async () => {
    const { inquiry, turn } = await createInquiry("请验证 Cloudflare 子域名", { rootDir });
    const frame = normalizeResearchFrame({
      taskKind: "technical_verification",
      userGoal: turn.prompt,
      deliverable: "可行性结论",
      hardConstraints: [{ id: "dns", label: "authoritative NS delegation", core: true }]
    });
    const state = createResearchState({ inquiryId: inquiry.id, turnId: turn.id, frame, budget: DEFAULT_GRAPH_BUDGET });
    state.cycleIndex = 1;
    await saveGraphState(state, { rootDir });

    const response = await createInquiryByIdGetHandler({ rootDir })(
      new Request(`http://localhost/api/inquiries/${inquiry.id}`),
      { params: { id: inquiry.id } }
    );
    const json = await response.json();

    expect(json.graphState).toMatchObject({
      status: "running",
      cycleIndex: 1,
      frame: {
        taskKind: "technical_verification"
      }
    });
  });

  it("artifact endpoints return graph artifacts without full source text", async () => {
    const { inquiry, turn } = await createInquiry("请研究一个公司", { rootDir });
    const frame = normalizeResearchFrame({ userGoal: turn.prompt, deliverable: "report" });
    const state = createResearchState({ inquiryId: inquiry.id, turnId: turn.id, frame, budget: DEFAULT_GRAPH_BUDGET });
    state.searchLedger.push({
      id: "batch_1",
      actionId: "act_1",
      cycle: 1,
      queryCount: 1,
      providerCalls: [],
      dedupedResultCount: 1,
      uniqueDomainCount: 1,
      expectedSignalHits: [],
      officialOrPrimaryCount: 0,
      candidateMentions: [],
      quality: "weak"
    });
    state.sourceLedger.push({
      sourceHash: "source_1",
      title: "Source",
      url: "https://example.com/source",
      provider: "opencli",
      engine: "google",
      status: "read",
      readCharCount: 13_000,
      evidenceIds: []
    });
    await saveGraphState(state, { rootDir });
    await saveSearchBatchArtifact(
      {
        id: "batch_1",
        inquiryId: inquiry.id,
        turnId: turn.id,
        actionId: "act_1",
        cycle: 1,
        queries: ["example company"],
        providerCalls: [],
        dedupedResults: [{ title: "Source", url: "https://example.com/source", snippet: "snippet", provider: "opencli", engine: "google" }],
        createdAt: "2026-07-02T00:00:00.000Z"
      },
      { rootDir }
    );
    await saveSourceArtifact(
      {
        sourceHash: "source_1",
        inquiryId: inquiry.id,
        turnId: turn.id,
        title: "Source",
        url: "https://example.com/source",
        provider: "opencli",
        engine: "google",
        status: "read",
        readCharCount: 13_000,
        fullText: "A".repeat(13_000),
        createdAt: "2026-07-02T00:00:00.000Z"
      },
      { rootDir }
    );

    const batchResponse = await createSearchBatchArtifactGetHandler({ rootDir })(
      new Request(`http://localhost/api/inquiries/${inquiry.id}/artifacts/search-batches/batch_1`),
      { params: { id: inquiry.id, batchId: "batch_1" } }
    );
    const sourceResponse = await createSourceArtifactGetHandler({ rootDir })(
      new Request(`http://localhost/api/inquiries/${inquiry.id}/artifacts/sources/source_1`),
      { params: { id: inquiry.id, sourceHash: "source_1" } }
    );

    const batchJson = await batchResponse.json();
    const sourceJson = await sourceResponse.json();

    expect(batchJson.dedupedResults).toHaveLength(1);
    expect(sourceJson.excerpt).toHaveLength(12_000);
    expect(sourceJson.fullText).toBeUndefined();
  });

  it("GET /api/inquiries/:id/stream replays NDJSON events", async () => {
    const { inquiry, turn } = await createInquiry("请研究一个公司", { rootDir });
    inquiry.status = "completed";
    turn.status = "completed";
    await saveInquiry(inquiry, { rootDir });
    await appendTurnEvent(
      {
        type: "turn_completed",
        inquiryId: inquiry.id,
        turnId: turn.id,
        timestamp: "2026-07-01T00:00:00.000Z"
      },
      { rootDir }
    );

    const response = await createInquiryStreamGetHandler({ rootDir, pollIntervalMs: 1 })(
      new Request(`http://localhost/api/inquiries/${inquiry.id}/stream`),
      { params: { id: inquiry.id } }
    );
    const text = await response.text();

    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(text).toContain('"type":"turn_completed"');
  });
});
