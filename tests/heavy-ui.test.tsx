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

  it("renders graph state summary for historical Graph Heavy inquiries", async () => {
    const inquiry = fixtureInquiry();
    inquiry.graphState = {
      frame: {
        taskKind: "find_person_company",
        userGoal: inquiry.prompt,
        deliverable: "最大可能候选人",
        hardConstraints: [{ id: "role", label: "CEO founder senior leadership", kind: "hard", core: true }],
        softPreferences: [{ id: "growth", label: "30% annual growth proxy", kind: "soft" }],
        exclusionRules: [{ id: "no_solar", label: "not solar panels", kind: "exclusion" }]
      },
      status: "completed",
      cycleIndex: 1,
      actionCount: 1,
      searchBatchCount: 1,
      sourceCount: 1,
      evidenceCount: 2,
      candidates: [
        {
          id: "cand_1",
          kind: "person_company",
          name: "Grace Brown / Andromeda Robotics",
          aliases: ["Grace Brown", "Andromeda Robotics"],
          summary: "Evidence-backed candidate",
          matchedConstraints: [{ constraintId: "role", status: "direct", evidenceIds: ["ev_1"] }],
          missingConstraints: [{ constraintId: "growth", reason: "Exact growth missing", neededEvidence: ["annual report"] }],
          score: 71,
          confidence: "medium",
          status: "ranked"
        }
      ],
      evidenceMatrix: {
        constraintIds: ["role", "growth"],
        candidateIds: ["cand_1"],
        cells: [
          {
            candidateId: "cand_1",
            constraintId: "role",
            status: "direct",
            evidenceIds: ["ev_1"],
            bestSourceUrls: ["https://example.com/a"],
            rationale: "Direct CEO evidence",
            updatedAt: "2026-07-02T00:00:00.000Z"
          },
          {
            candidateId: "cand_1",
            constraintId: "growth",
            status: "missing",
            evidenceIds: [],
            bestSourceUrls: [],
            rationale: "No exact growth source",
            updatedAt: "2026-07-02T00:00:00.000Z"
          }
        ]
      },
      rejectedPaths: [],
      evaluatorDecisions: [
        {
          id: "eval_1_finalize",
          cycle: 1,
          action: "finalize",
          reason: "候选证据足够",
          nextFocus: ["cand_1"],
          unresolvedQuestions: ["缺少 growth 的直接证据"],
          createdAt: "2026-07-02T00:00:00.000Z"
        }
      ],
      recentSearchBatches: [
        {
          id: "batch_1",
          actionId: "act_1",
          cycle: 1,
          queryCount: 1,
          providerCalls: [
            {
              provider: "opencli",
              engine: "google",
              query: "Australian robotics AI hardware CEO founder interview",
              status: "done",
              resultCount: 30,
              durationMs: 100,
              artifactId: "search_1"
            }
          ],
          dedupedResultCount: 30,
          uniqueDomainCount: 12,
          expectedSignalHits: ["CEO"],
          officialOrPrimaryCount: 2,
          candidateMentions: ["Grace Brown"],
          quality: "strong"
        }
      ],
      recentSources: [
        {
          sourceHash: "source_1",
          title: "Andromeda Robotics Team",
          url: "https://example.com/a",
          provider: "opencli",
          engine: "google",
          status: "read",
          readCharCount: 1200,
          evidenceIds: ["ev_1"]
        }
      ],
      updatedAt: "2026-07-02T00:00:00.000Z"
    };
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

    expect(await screen.findByText("Graph Research")).toBeInTheDocument();
    expect(screen.getByText("find_person_company")).toBeInTheDocument();
    expect(screen.getByText("Search Ledger")).toBeInTheDocument();
    expect(screen.getAllByText("opencli · google").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Candidate Pool")).toBeInTheDocument();
    expect(screen.getByText("Grace Brown / Andromeda Robotics")).toBeInTheDocument();
    expect(screen.getByText("Evidence Matrix")).toBeInTheDocument();
    expect(screen.getByText("role")).toBeInTheDocument();
    expect(screen.getAllByText("direct").length).toBeGreaterThanOrEqual(1);
  });

  it("expands graph search and source artifacts from the ledger", async () => {
    const inquiry = fixtureInquiry();
    inquiry.graphState = {
      frame: {
        taskKind: "technical_verification",
        userGoal: inquiry.prompt,
        deliverable: "Cloudflare feasibility",
        hardConstraints: [{ id: "ns_delegation", label: "authoritative NS delegation", kind: "hard", core: true }],
        softPreferences: [],
        exclusionRules: []
      },
      status: "completed",
      cycleIndex: 1,
      actionCount: 1,
      searchBatchCount: 1,
      sourceCount: 1,
      evidenceCount: 1,
      candidates: [],
      evidenceMatrix: { constraintIds: ["ns_delegation"], candidateIds: [], cells: [] },
      rejectedPaths: [],
      evaluatorDecisions: [],
      recentSearchBatches: [
        {
          id: "batch_artifact",
          actionId: "act_1",
          cycle: 1,
          queryCount: 1,
          providerCalls: [
            {
              provider: "opencli",
              engine: "google",
              query: "Cloudflare free subdomain NS delegation",
              status: "done",
              resultCount: 30,
              durationMs: 42,
              artifactId: "batch_artifact_call_1"
            }
          ],
          dedupedResultCount: 30,
          uniqueDomainCount: 12,
          expectedSignalHits: ["NS delegation"],
          officialOrPrimaryCount: 2,
          candidateMentions: [],
          quality: "strong"
        }
      ],
      recentSources: [
        {
          sourceHash: "source_artifact",
          title: "Cloudflare Docs",
          url: "https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/",
          provider: "opencli",
          engine: "google",
          status: "read",
          readCharCount: 9000,
          evidenceIds: ["ev_1"]
        }
      ],
      updatedAt: "2026-07-02T00:00:00.000Z"
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/health")) {
          return jsonResponse({ ok: true, configuredModel: "test-model", baseUrl: "https://relay.example", searchProvider: { provider: "relay" } });
        }
        if (url.includes(`/api/inquiries/${inquiry.id}/artifacts/search-batches/batch_artifact`)) {
          return jsonResponse({
            id: "batch_artifact",
            inquiryId: inquiry.id,
            turnId: inquiry.turns[0].id,
            actionId: "act_1",
            cycle: 1,
            queries: ["Cloudflare free subdomain NS delegation"],
            providerCalls: [
              {
                provider: "opencli",
                engine: "google",
                query: "Cloudflare free subdomain NS delegation",
                status: "done",
                durationMs: 42,
                results: [
                  {
                    title: "Cloudflare Subdomain Setup",
                    url: "https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/",
                    snippet: "Delegate authoritative nameservers for subdomain setup.",
                    provider: "opencli",
                    engine: "google"
                  }
                ]
              }
            ],
            dedupedResults: [
              {
                title: "Cloudflare Subdomain Setup",
                url: "https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/",
                snippet: "Delegate authoritative nameservers for subdomain setup.",
                provider: "opencli",
                engine: "google"
              }
            ],
            createdAt: "2026-07-02T00:00:00.000Z"
          });
        }
        if (url.includes(`/api/inquiries/${inquiry.id}/artifacts/sources/source_artifact`)) {
          return jsonResponse({
            sourceHash: "source_artifact",
            inquiryId: inquiry.id,
            turnId: inquiry.turns[0].id,
            title: "Cloudflare Docs",
            url: "https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/",
            provider: "opencli",
            engine: "google",
            status: "read",
            readCharCount: 9000,
            excerpt: "Cloudflare subdomain setup requires authoritative NS delegation for the subdomain.",
            readLogs: [
              { provider: "opencli", status: "error", title: "Cloudflare Docs", url: "https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/", message: "OpenCLI read failed", timestamp: "2026-07-02T00:00:00.000Z" },
              { provider: "fetch", status: "done", title: "Cloudflare Docs", url: "https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/", readCharCount: 9000, timestamp: "2026-07-02T00:00:01.000Z" }
            ],
            createdAt: "2026-07-02T00:00:00.000Z"
          });
        }
        if (url.includes(`/api/inquiries/${inquiry.id}`)) {
          return jsonResponse(inquiry);
        }
        return jsonResponse({ inquiries: [inquiry] });
      })
    );

    render(<Home />);

    fireEvent.click(await screen.findByRole("button", { name: "展开搜索结果" }));
    expect((await screen.findAllByText("Cloudflare Subdomain Setup")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("opencli · google · done · 1 results")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看网页内容" }));
    expect(await screen.findByText(/requires authoritative NS delegation/)).toBeInTheDocument();
    expect(screen.getByText(/opencli · error/)).toBeInTheDocument();
    expect(screen.getByText(/fetch · done · 9000 chars/)).toBeInTheDocument();
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
