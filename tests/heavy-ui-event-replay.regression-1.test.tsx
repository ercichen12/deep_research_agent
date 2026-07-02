// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import type { Inquiry } from "@/lib/heavy/types";

describe("QA regression: event replay for selected inquiries", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("replays NDJSON events when a running inquiry is loaded from the local list", async () => {
    const inquiry = runningInquiry();
    const streamEvent = {
      type: "action_started",
      inquiryId: inquiry.id,
      turnId: inquiry.turns[0].id,
      cycle: 1,
      action: {
        id: "act_1_search_web",
        type: "search_web",
        purpose: "initial search",
        rationale: "show visible progress after reload",
        priority: "high",
        queries: ["OpenAI current CEO official website"],
        expectedSignals: ["official website"],
        maxResults: 30
      },
      timestamp: "2026-07-02T00:00:00.200Z"
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/health")) {
          return jsonResponse({ ok: true, configuredModel: "test-model", baseUrl: "https://relay.example", searchProvider: { provider: "relay" } });
        }
        if (url.includes(`/api/inquiries/${inquiry.id}/stream`)) {
          return ndjsonResponse([streamEvent]);
        }
        if (url.includes(`/api/inquiries/${inquiry.id}`)) {
          return jsonResponse(inquiry);
        }
        return jsonResponse({ inquiries: [inquiry] });
      })
    );

    render(<Home />);

    expect(await screen.findByText("action_started")).toBeInTheDocument();
    expect(screen.getByText("2026-07-02T00:00:00.200Z")).toBeInTheDocument();
  });
});

function runningInquiry(): Inquiry {
  return {
    id: "inquiry_running_replay",
    prompt: "QA smoke test 2: find the current CEO and official website of OpenAI. Use English search keywords only.",
    mode: "heavy",
    status: "running",
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:01.000Z",
    turns: [
      {
        id: "turn_running_replay",
        inquiryId: "inquiry_running_replay",
        mode: "heavy",
        prompt: "QA smoke test 2: find the current CEO and official website of OpenAI. Use English search keywords only.",
        status: "running",
        budget: { maxRuns: 3, maxAgentsPerRun: 6, maxTotalAgents: 14, maxSourcesPerAgent: 30, agentConcurrency: 3 },
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:01.000Z",
        startedAt: "2026-07-02T00:00:00.000Z",
        runs: []
      }
    ],
    graphState: {
      frame: {
        taskKind: "find_website",
        userGoal: "Find OpenAI CEO and official website",
        deliverable: "Evidence-backed website",
        hardConstraints: [{ id: "official_website", label: "official website", kind: "hard", core: true }],
        softPreferences: [],
        exclusionRules: []
      },
      status: "running",
      cycleIndex: 0,
      actionCount: 1,
      searchBatchCount: 0,
      sourceCount: 0,
      evidenceCount: 0,
      candidates: [],
      evidenceMatrix: { constraintIds: ["official_website"], candidateIds: [], cells: [] },
      rejectedPaths: [],
      evaluatorDecisions: [],
      recentSearchBatches: [],
      recentSources: [],
      updatedAt: "2026-07-02T00:00:01.000Z"
    }
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function ndjsonResponse(lines: unknown[]): Response {
  return new Response(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" }
  });
}
