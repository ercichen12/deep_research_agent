import { describe, expect, it } from "vitest";
import { encodeStreamEvent } from "@/lib/research-stream";
import type { ResearchStreamEvent } from "@/lib/types";

describe("encodeStreamEvent", () => {
  it("writes one JSON event per line for fetch body streaming", () => {
    const event: ResearchStreamEvent = {
      type: "run_started",
      runId: "run_test",
      timestamp: "2026-06-30T13:00:00.000Z"
    };

    expect(encodeStreamEvent(event)).toBe('{"type":"run_started","runId":"run_test","timestamp":"2026-06-30T13:00:00.000Z"}\n');
  });

  it("encodes heartbeat events so long tool calls keep the stream alive", () => {
    expect(
      encodeStreamEvent({
        type: "heartbeat",
        timestamp: "2026-06-30T13:00:10.000Z"
      })
    ).toBe('{"type":"heartbeat","timestamp":"2026-06-30T13:00:10.000Z"}\n');
  });
});
