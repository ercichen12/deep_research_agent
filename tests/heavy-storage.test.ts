import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendTurnEvent,
  createInquiry,
  listInquiries,
  loadInquiry,
  readTurnEvents,
  saveInquiry
} from "@/lib/heavy/storage";

describe("Heavy file storage and events", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "heavy-storage-"));
  });

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true });
  });

  it("creates, saves, reloads, appends events, and lists inquiries", async () => {
    const { inquiry, turn } = await createInquiry("找一个澳大利亚创新硬件 CEO", { rootDir });
    inquiry.status = "running";
    turn.status = "running";
    await saveInquiry(inquiry, { rootDir });

    await appendTurnEvent(
      {
        type: "turn_started",
        inquiryId: inquiry.id,
        turnId: turn.id,
        timestamp: "2026-07-01T00:00:00.000Z"
      },
      { rootDir }
    );

    const loaded = await loadInquiry(inquiry.id, { rootDir });
    const listed = await listInquiries({ rootDir });
    const events = await readTurnEvents(turn.id, { rootDir });

    expect(loaded?.id).toBe(inquiry.id);
    expect(loaded?.turns[0].id).toBe(turn.id);
    expect(listed.map((item) => item.id)).toEqual([inquiry.id]);
    expect(events.map((event) => event.type)).toEqual(["turn_started"]);
  });

  it("stores events as single-line JSON and redacts secret-looking text", async () => {
    const { inquiry, turn } = await createInquiry("研究一个公司", { rootDir });
    await appendTurnEvent(
      {
        type: "error",
        inquiryId: inquiry.id,
        turnId: turn.id,
        timestamp: "2026-07-01T00:00:01.000Z",
        message: "provider rejected token sk-test-secret-value"
      },
      { rootDir }
    );

    const raw = await readFile(join(rootDir, "logs", `${turn.id}.ndjson`), "utf8");

    expect(raw.trim().split("\n")).toHaveLength(1);
    expect(raw).not.toContain("sk-test-secret-value");
    expect(raw).toContain("[redacted-secret]");
  });
});
