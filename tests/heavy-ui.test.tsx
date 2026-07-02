// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import type { Inquiry } from "@/lib/heavy/types";

describe("Heavy console UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders real Inquiry runs, agents, verifier, and final markdown from API data", async () => {
    const inquiry = fixtureInquiry();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/health")) {
          return jsonResponse({ ok: true, configuredModel: "test-model", baseUrl: "https://relay.example", searchProvider: { provider: "relay" } });
        }
        if (url.includes(`/api/inquiries/${inquiry.id}`)) {
          return jsonResponse(inquiry);
        }
        return jsonResponse({ inquiries: [inquiry] });
      })
    );

    render(<Home />);

    expect(await screen.findByText("Run 1")).toBeInTheDocument();
    expect(screen.getByText("身份核验")).toBeInTheDocument();
    expect(screen.getByText("核验：needs_more_research")).toBeInTheDocument();
    expect(screen.getByText("抓到的网页")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.com/a" })).toHaveAttribute("href", "https://example.com/a");
    expect(screen.getAllByRole("link", { name: "Source A" }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("搜索日志")).toBeInTheDocument();
    expect(screen.getByText("研究过程")).toBeInTheDocument();
    expect(screen.getByText("识别任务意图")).toBeInTheDocument();
    expect(screen.getByText("调整关键词")).toBeInTheDocument();
    expect(screen.getByText("Need condition-level evidence.")).toBeInTheDocument();
    expect(screen.getByText("Grace Brown Andromeda Robotics over the last three years")).toBeInTheDocument();
    expect(screen.getAllByText("relay").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("opencli · google").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("网页读取")).toBeInTheDocument();
    expect(screen.getAllByText("最终报告").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("证据链")).toBeInTheDocument();
  });

  it("renders legacy Inquiry data that does not have per-agent logs yet", async () => {
    const inquiry = fixtureInquiry();
    delete (inquiry.turns[0].runs[0].agentReports[0] as Partial<(typeof inquiry.turns)[0]["runs"][0]["agentReports"][number]>).searchLogs;
    delete (inquiry.turns[0].runs[0].agentReports[0] as Partial<(typeof inquiry.turns)[0]["runs"][0]["agentReports"][number]>).readLogs;
    delete (inquiry.turns[0].runs[0].agentReports[0] as Partial<(typeof inquiry.turns)[0]["runs"][0]["agentReports"][number]>).researchSteps;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/health")) {
          return jsonResponse({ ok: true, configuredModel: "test-model", baseUrl: "https://relay.example", searchProvider: { provider: "relay" } });
        }
        if (url.includes(`/api/inquiries/${inquiry.id}`)) {
          return jsonResponse(inquiry);
        }
        return jsonResponse({ inquiries: [inquiry] });
      })
    );

    render(<Home />);

    expect(await screen.findByText("Run 1")).toBeInTheDocument();
    expect(screen.getByText("暂无搜索日志。")).toBeInTheDocument();
    expect(screen.getByText("暂无网页读取日志。")).toBeInTheDocument();
    expect(screen.getByText("暂无研究过程日志。")).toBeInTheDocument();
  });

  it("renders duplicate research process queries without React key warnings", async () => {
    const inquiry = fixtureInquiry();
    const duplicateStep = inquiry.turns[0].runs[0].agentReports[0].researchSteps[1];
    duplicateStep.queries = ["Grace Brown Andromeda Robotics CEO", "Grace Brown Andromeda Robotics CEO"];
    duplicateStep.selectedUrls = ["https://example.com/repeated", "https://example.com/repeated"];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/health")) {
          return jsonResponse({ ok: true, configuredModel: "test-model", baseUrl: "https://relay.example", searchProvider: { provider: "relay" } });
        }
        if (url.includes(`/api/inquiries/${inquiry.id}`)) {
          return jsonResponse(inquiry);
        }
        return jsonResponse({ inquiries: [inquiry] });
      })
    );

    render(<Home />);

    expect(await screen.findByText("Run 1")).toBeInTheDocument();
    expect(consoleError.mock.calls.some((call) => call.join(" ").includes("Encountered two children with the same key"))).toBe(false);
  });

  it("renders live stream search event details so a running click does not look idle", async () => {
    const inquiry = fixtureInquiry();
    inquiry.status = "running";
    inquiry.turns[0].status = "running";
    inquiry.turns[0].runs[0].status = "running";
    inquiry.turns[0].runs[0].agentReports = [];
    inquiry.turns[0].runs[0].verificationReport = undefined;
    inquiry.turns[0].runs[0].decision = undefined;
    inquiry.turns[0].finalReport = undefined;

    const streamEvent = {
      type: "agent_search_log",
      inquiryId: inquiry.id,
      turnId: inquiry.turns[0].id,
      runId: inquiry.turns[0].runs[0].id,
      taskId: "identity_research",
      log: {
        provider: "opencli",
        engine: "google",
        query: "Grace Brown Andromeda Robotics CEO",
        status: "done",
        results: [
          { title: "Source A", url: "https://example.com/a", snippet: "CEO evidence", provider: "opencli", engine: "google" },
          { title: "Source B", url: "https://example.com/b", snippet: "AI article evidence", provider: "opencli", engine: "google" }
        ],
        timestamp: "2026-07-01T00:00:00.200Z"
      },
      timestamp: "2026-07-01T00:00:00.200Z"
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/health")) {
          return jsonResponse({ ok: true, configuredModel: "test-model", baseUrl: "https://relay.example", searchProvider: { provider: "relay" } });
        }
        if (url === "/api/inquiries" && init?.method === "POST") {
          return jsonResponse({ inquiryId: inquiry.id, turnId: inquiry.turns[0].id });
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

    fireEvent.click(await screen.findByRole("button", { name: "启动 Heavy" }));

    expect(await screen.findByText("agent_search_log")).toBeInTheDocument();
    expect(screen.getAllByText("identity_research").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("opencli · google")).toBeInTheDocument();
    expect(screen.getByText("done · 2 results")).toBeInTheDocument();
    expect(screen.getByText("Grace Brown Andromeda Robotics CEO")).toBeInTheDocument();
  });
});

function fixtureInquiry(): Inquiry {
  return {
    id: "inquiry_ui",
    prompt: "找澳大利亚创新硬件 CEO",
    mode: "heavy",
    status: "completed",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:03.000Z",
    turns: [
      {
        id: "turn_ui",
        inquiryId: "inquiry_ui",
        mode: "heavy",
        prompt: "找澳大利亚创新硬件 CEO",
        status: "completed",
        budget: { maxRuns: 3, maxAgentsPerRun: 6, maxTotalAgents: 14, maxSourcesPerAgent: 30, agentConcurrency: 3 },
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:03.000Z",
        startedAt: "2026-07-01T00:00:00.000Z",
        completedAt: "2026-07-01T00:00:03.000Z",
        runs: [
          {
            id: "run_1",
            index: 1,
            status: "completed",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:02.000Z",
            coordinatorPlan: {
              runIndex: 1,
              objective: "查找候选人",
              tasks: [
                {
                  id: "identity_research",
                  role: "identity_research",
                  title: "身份核验",
                  objective: "确认候选人的公司和职位",
                  questions: ["是否仍任 CEO"],
                  searchHints: ["CEO Australia"]
                }
              ]
            },
            agentReports: [
              {
                taskId: "identity_research",
                agentId: "agent_identity_research",
                role: "identity_research",
                status: "completed",
                summary: "找到身份证据",
                queries: ["CEO Australia"],
                searchLogs: [
                  {
                    provider: "relay",
                    query: "CEO Australia",
                    status: "done",
                    results: [{ title: "Source A", url: "https://example.com/a", snippet: "CEO evidence", provider: "relay" }],
                    timestamp: "2026-07-01T00:00:00.100Z"
                  },
                  {
                    provider: "opencli",
                    engine: "google",
                    query: "CEO Australia",
                    status: "empty",
                    results: [],
                    message: "0 results",
                    timestamp: "2026-07-01T00:00:00.200Z"
                  }
                ],
                readLogs: [
                  {
                    provider: "opencli",
                    status: "done",
                    url: "https://example.com/a",
                    title: "Source A",
                    readCharCount: 1200,
                    timestamp: "2026-07-01T00:00:00.300Z"
                  }
                ],
                researchSteps: [
                  {
                    id: "step_1",
                    type: "intent",
                    title: "识别任务意图",
                    detail: "Verify Grace Brown against the CEO, company fit, tenure, geography, growth, and AI-publication conditions.",
                    decision: "continue",
                    timestamp: "2026-07-01T00:00:00.050Z"
                  },
                  {
                    id: "step_2",
                    type: "keyword_revision",
                    title: "调整关键词",
                    detail: "Initial broad search found company identity but not the tenure condition, so refine around named candidate and company.",
                    round: 2,
                    queries: ["Grace Brown Andromeda Robotics over the last three years"],
                    selectedUrls: ["https://example.com/research-step"],
                    provider: "opencli",
                    engine: "google",
                    resultCount: 1,
                    decision: "revise_query",
                    reason: "Need condition-level evidence.",
                    timestamp: "2026-07-01T00:00:00.250Z"
                  }
                ],
                sources: [{ title: "Source A", url: "https://example.com/a", snippet: "CEO evidence", provider: "relay" }],
                findings: [
                  {
                    claim: "候选人是 CEO",
                    support: "supported",
                    confidence: "high",
                    sourceUrls: ["https://example.com/a"]
                  }
                ],
                startedAt: "2026-07-01T00:00:00.000Z",
                completedAt: "2026-07-01T00:00:01.000Z"
              }
            ],
            verificationReport: {
              status: "needs_more_research",
              summary: "还缺增长率证据",
              issues: [{ type: "missing_evidence", severity: "medium", message: "缺增长率" }],
              contradictions: [],
              missingEvidence: ["annual growth"],
              recommendedNextTasks: [],
              unknowns: ["annual growth"]
            },
            decision: {
              action: "finalize_with_uncertainty",
              reason: "预算耗尽"
            }
          }
        ],
        finalReport: {
          markdown: "# 最终报告\n\n## 证据链\n\n[Source A](https://example.com/a)",
          summary: "未完全确认",
          sourceUrls: ["https://example.com/a"],
          unknowns: ["annual growth"],
          completedAt: "2026-07-01T00:00:03.000Z"
        }
      }
    ]
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
