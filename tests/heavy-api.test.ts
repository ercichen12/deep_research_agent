import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInquiryGetHandler, createInquiryPostHandler } from "@/app/api/inquiries/route";
import { createInquiryByIdGetHandler } from "@/app/api/inquiries/[id]/route";
import { createInquiryStreamGetHandler } from "@/app/api/inquiries/[id]/stream/route";
import { appendTurnEvent, createInquiry, saveInquiry } from "@/lib/heavy/storage";

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
