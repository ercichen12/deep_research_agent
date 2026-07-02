import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRAPH_BUDGET,
  createEmptyEvidenceMatrix,
  createResearchState,
  normalizeEvidenceExtractionOutput,
  normalizeGraphBudget,
  normalizeResearchActions,
  normalizeResearchFrame,
  summarizeGraphState
} from "@/lib/heavy/graph/types";

describe("Graph Heavy type normalization", () => {
  it("uses Apodex-style graph budget defaults and allows env overrides", () => {
    expect(DEFAULT_GRAPH_BUDGET).toMatchObject({
      maxCycles: 8,
      maxActionsPerCycle: 6,
      maxSearchActionsPerCycle: 4,
      maxQueriesPerSearchAction: 4,
      maxResultsPerQuery: 30,
      maxSourcesToReadPerCycle: 12,
      maxTotalSourcesToRead: 80,
      maxPromotedCandidates: 8
    });

    expect(
      normalizeGraphBudget(
        {},
        {
          GRAPH_MAX_CYCLES: "12",
          GRAPH_MAX_RESULTS_PER_QUERY: "45",
          GRAPH_MAX_TOTAL_SOURCES_TO_READ: "120"
        }
      )
    ).toMatchObject({
      maxCycles: 12,
      maxResultsPerQuery: 45,
      maxTotalSourcesToRead: 120
    });
  });

  it("normalizes a research frame and preserves constraints while defaulting English search policy", () => {
    const frame = normalizeResearchFrame({
      taskKind: "find_person_company",
      userGoal: "找澳大利亚创新硬件 CEO",
      deliverable: "最大可能候选人",
      hardConstraints: [
        { id: "geo", label: "Australia", core: true },
        { id: "", label: "" },
        { id: "role", label: "CEO or founder", core: true }
      ],
      softPreferences: [{ id: "growth", label: "30% annual growth" }],
      exclusionRules: [{ id: "no_solar", label: "not solar panels" }],
      initialAngles: [
        { id: "broad", title: "Broad robotics CEO search", priority: "high", querySeeds: ["Australian robotics CEO AI hardware"] },
        { id: "", title: "", querySeeds: [] }
      ]
    });

    expect(frame.taskKind).toBe("find_person_company");
    expect(frame.searchPolicy.defaultLanguage).toBe("en");
    expect(frame.searchPolicy.maxResultsPerQuery).toBe(30);
    expect(frame.hardConstraints.map((constraint) => constraint.id)).toEqual(["geo", "role"]);
    expect(frame.hardConstraints.every((constraint) => constraint.kind === "hard")).toBe(true);
    expect(frame.exclusionRules[0]).toMatchObject({ id: "no_solar", kind: "exclusion" });
    expect(frame.initialAngles).toHaveLength(1);
  });

  it("filters and budget-truncates graph actions while removing Chinese search text", () => {
    const actions = normalizeResearchActions(
      [
        {
          type: "search_web",
          purpose: "broad candidate search",
          rationale: "Find likely candidates",
          priority: "high",
          queries: [
            "Grace Brown Andromeda Robotics CEO",
            "澳大利亚 创新硬件 CEO",
            "Australian robotics founder AI interview",
            "site:linkedin.com/in robotics CEO Australia",
            "extra query should be truncated"
          ],
          expectedSignals: ["CEO", "robotics", "AI"],
          maxResults: 99
        },
        {
          type: "read_source",
          purpose: "read official sources",
          rationale: "Need direct evidence",
          urls: ["https://example.com/a", "not-a-url"]
        },
        {
          type: "search_web",
          purpose: "overflow search",
          rationale: "Should be trimmed by search action budget",
          priority: "medium",
          queries: ["hardware startup Australia"],
          expectedSignals: ["hardware"]
        }
      ],
      2,
      { ...DEFAULT_GRAPH_BUDGET, maxActionsPerCycle: 2, maxSearchActionsPerCycle: 1, maxQueriesPerSearchAction: 3 }
    );

    expect(actions.map((action) => action.type)).toEqual(["search_web", "read_source"]);
    expect(actions[0]).toMatchObject({
      id: "act_2_search_web_broad-candidate-search_1",
      maxResults: 30
    });
    if (actions[0].type !== "search_web") {
      throw new Error("expected search action");
    }
    expect(actions[0].queries).toEqual([
      "Grace Brown Andromeda Robotics CEO",
      "Australian robotics founder AI interview",
      "site:linkedin.com/in robotics CEO Australia"
    ]);
    expect(actions[0].queries.every((query) => !/[\u3400-\u9fff\uf900-\ufaff]/.test(query))).toBe(true);
  });

  it("normalizes evidence extraction output and drops unsupported evidence", () => {
    const output = normalizeEvidenceExtractionOutput({
      evidenceItems: [
        {
          claim: "Grace Brown is CEO of Andromeda Robotics",
          subjectIds: ["cand_person_company_grace"],
          constraintIds: ["role"],
          sourceUrl: "https://andromedarobotics.example/team",
          sourceTitle: "Team",
          sourceType: "official",
          provider: "opencli",
          engine: "google",
          paraphrase: "The official team page lists Grace Brown as CEO.",
          strength: "direct",
          confidence: "high"
        },
        {
          claim: "No source claim",
          sourceUrl: "",
          sourceTitle: "Missing URL"
        }
      ],
      candidates: [
        {
          kind: "person_company",
          name: "Grace Brown / Andromeda Robotics",
          aliases: ["Grace Brown", "Andromeda Robotics"],
          summary: "Likely candidate",
          matchedConstraints: [{ constraintId: "role", status: "direct", evidenceIds: ["ev_missing"] }],
          score: 999,
          confidence: "certain",
          status: "promoted"
        },
        { name: "", kind: "person_company" }
      ],
      queryClues: [{ text: "Andromeda Robotics AI interview", source: "candidate", weight: 3 }, { text: "" }],
      rejectedPaths: [{ title: "Solar candidates", reason: "Excluded by no_solar", evidenceIds: ["ev_1"] }]
    });

    expect(output.evidenceItems).toHaveLength(1);
    expect(output.evidenceItems[0]).toMatchObject({
      sourceUrl: "https://andromedarobotics.example/team",
      strength: "direct",
      confidence: "high"
    });
    expect(output.candidates).toHaveLength(1);
    expect(output.candidates[0]).toMatchObject({
      id: expect.stringMatching(/^cand_person_company_/),
      score: 100,
      confidence: "low",
      status: "promoted"
    });
    expect(output.queryClues).toHaveLength(1);
    expect(output.rejectedPaths).toHaveLength(1);
  });

  it("creates graph state and exposes only summary data for API/UI hydration", () => {
    const frame = normalizeResearchFrame({
      taskKind: "technical_verification",
      userGoal: "验证免费子域名是否可接 Cloudflare",
      deliverable: "可行路径",
      hardConstraints: [{ id: "dns", label: "supports authoritative NS delegation", core: true }]
    });
    const state = createResearchState({
      inquiryId: "inquiry_1",
      turnId: "turn_1",
      frame,
      budget: DEFAULT_GRAPH_BUDGET
    });
    state.searchLedger.push({
      id: "batch_1",
      actionId: "act_1",
      cycle: 1,
      queryCount: 1,
      providerCalls: [],
      dedupedResultCount: 0,
      uniqueDomainCount: 0,
      expectedSignalHits: [],
      officialOrPrimaryCount: 0,
      candidateMentions: [],
      quality: "empty"
    });
    state.sourceLedger.push({
      sourceHash: "source_1",
      title: "Cloudflare Docs",
      url: "https://developers.cloudflare.com/dns/",
      provider: "opencli",
      engine: "google",
      status: "read",
      readCharCount: 1200,
      evidenceIds: []
    });
    state.workflowArtifacts.push({
      id: "workflow_1_draft",
      cycle: 1,
      stage: "draft",
      title: "Draft DNS workflow",
      summary: "Draft from source evidence.",
      findings: ["PSL and NS delegation are hidden criteria."],
      invalidAssumptions: [],
      orderedGates: [],
      sourceUrls: ["https://developers.cloudflare.com/dns/"],
      createdAt: "2026-07-02T00:00:00.000Z"
    });
    state.evidenceMatrix = createEmptyEvidenceMatrix(frame, []);

    const summary = summarizeGraphState(state);

    expect(summary).toMatchObject({
      status: "running",
      cycleIndex: 0,
      actionCount: 0,
      searchBatchCount: 1,
      sourceCount: 1,
      evidenceCount: 0
    });
    expect(summary.frame.hardConstraints[0].label).toBe("supports authoritative NS delegation");
    expect(summary.workflowArtifacts?.[0]).toMatchObject({ stage: "draft", title: "Draft DNS workflow" });
    expect(JSON.stringify(summary)).not.toContain("fullText");
  });
});
