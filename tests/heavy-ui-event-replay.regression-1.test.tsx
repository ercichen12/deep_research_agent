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
      type: "workflow_artifact_reported",
      inquiryId: inquiry.id,
      turnId: inquiry.turns[0].id,
      cycle: 1,
      artifact: {
        id: "workflow_replay_draft",
        cycle: 1,
        stage: "draft",
        title: "Draft workflow from current evidence",
        summary: "Initial workflow draft is visible after reload.",
        findings: ["Search and source evidence produced a draft."],
        invalidAssumptions: [],
        orderedGates: ["Gate 1: verify official website"],
        sourceUrls: ["https://example.com/source"],
        createdAt: "2026-07-02T00:00:00.200Z"
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

    expect(await screen.findByText("workflow_artifact_reported")).toBeInTheDocument();
    expect(screen.getByText("2026-07-02T00:00:00.200Z")).toBeInTheDocument();
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getByText("Draft workflow from current evidence")).toBeInTheDocument();
    expect(screen.getByText("Initial workflow draft is visible after reload.")).toBeInTheDocument();
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
