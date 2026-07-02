import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInquiryPostHandler } from "@/app/api/inquiries/route";
import { startGraphHeavyInquiry } from "@/lib/heavy/graph/graph-orchestrator";
import { loadGraphState, readTurnEvents } from "@/lib/heavy/storage";
import type { HeavySearchProvider, HeavySearchResult, HeavySource } from "@/lib/heavy/types";

describe("QA regression: live Graph Heavy startup", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "heavy-live-start-"));
  });

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true });
  });

  it("POST /api/inquiries starts Heavy in the background instead of waiting for completion", async () => {
    let receivedOptions: Record<string, unknown> | undefined;
    const handler = createInquiryPostHandler({
      start: async (_prompt, options) => {
        receivedOptions = options as Record<string, unknown>;
        return { inquiryId: "inquiry_background", turnId: "turn_background" };
      }
    });

    const response = await handler(
      new Request("http://localhost/api/inquiries", {
        method: "POST",
        body: JSON.stringify({
          prompt: "QA smoke test: find OpenAI CEO and official website with concise evidence."
        })
      })
    );

    await expect(response.json()).resolves.toEqual({ inquiryId: "inquiry_background", turnId: "turn_background" });
    expect(receivedOptions).toMatchObject({ awaitCompletion: false });
  });

  it("persists planned graph actions before a long search provider call settles", async () => {
    const { turnId } = await startGraphHeavyInquiry(
      "QA smoke test: find the current CEO and official website of OpenAI. Use English search keywords only.",
      {
        rootDir,
        awaitCompletion: false,
        provider: hangingProvider(),
        budget: {
          maxCycles: 1,
          maxActionsPerCycle: 1,
          maxSearchActionsPerCycle: 1,
          maxQueriesPerSearchAction: 1,
          maxResultsPerQuery: 30,
          maxSourcesToReadPerCycle: 1,
          maxTotalSourcesToRead: 1
        }
      }
    );

    const state = await waitFor(async () => {
      const nextState = await loadGraphState(turnId, { rootDir });
      return nextState && nextState.actions.length > 0 && nextState.budgets.actionsUsed > 0 ? nextState : undefined;
    });
    const events = await readTurnEvents(turnId, { rootDir });

    expect(state.actions[0]).toMatchObject({ type: "search_web", maxResults: 30 });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["actions_planned", "action_started"]));
  });
});

function hangingProvider(): HeavySearchProvider {
  return {
    search: () => new Promise<HeavySearchResult[]>(() => undefined),
    read: async (result): Promise<HeavySource> => ({
      ...result,
      snippet: result.snippet ?? "",
      fullText: result.snippet ?? ""
    })
  };
}

async function waitFor<T>(callback: () => Promise<T | undefined>, timeoutMs = 10000): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await callback();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for planned graph actions to persist");
}
