import { describe, expect, it } from "vitest";
import { decodeStreamEvents } from "@/lib/research-stream";
import { POST } from "@/app/api/research/stream/route";

describe("/api/research/stream", () => {
  it("rejects short prompts before opening a stream", async () => {
    const response = await POST(
      new Request("http://localhost/api/research/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "short" })
      })
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

describe("decodeStreamEvents", () => {
  it("parses newline-delimited stream chunks", () => {
    const events = decodeStreamEvents(
      '{"type":"run_started","runId":"run_1","timestamp":"2026-06-30T13:00:00.000Z"}\n{"type":"log_saved","path":"x","timestamp":"2026-06-30T13:00:01.000Z"}\n'
    );

    expect(events.map((event) => event.type)).toEqual(["run_started", "log_saved"]);
  });
});
