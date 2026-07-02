import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEAVY_BUDGET,
  normalizeBudget,
  normalizeAgentReport,
  normalizeCoordinatorPlan,
  normalizeVerificationReport,
  parseJsonObject
} from "@/lib/heavy/types";
import type { AgentResearchStep } from "@/lib/heavy/types";

describe("Heavy type normalization", () => {
  it("defaults to wide search with 30 sources per agent", () => {
    expect(DEFAULT_HEAVY_BUDGET.maxSourcesPerAgent).toBe(30);
  });

  it("allows wide maxSourcesPerAgent values from environment", () => {
    expect(normalizeBudget({}, { NODE_ENV: "test", HEAVY_MAX_SOURCES_PER_AGENT: "60" } as NodeJS.ProcessEnv).maxSourcesPerAgent).toBe(60);
  });

  it("extracts fenced JSON objects", () => {
    expect(parseJsonObject('```json\n{"summary":"ok"}\n```')).toEqual({ summary: "ok" });
  });

  it("filters bad coordinator tasks while preserving valid tasks", () => {
    const plan = normalizeCoordinatorPlan(
      {
        objective: "拆分找人找公司任务",
        tasks: [
          { id: "bad-url", title: "", objective: "", role: "x" },
          {
            id: "identity_research",
            role: "identity_research",
            title: "身份核验",
            objective: "确认候选人的公司、职位和所在地",
            questions: ["候选人是否仍在任？"],
            searchHints: ["CEO Australia AI hardware"]
          },
          {
            id: "company-fit_research",
            role: "company-fit_research",
            title: "公司画像",
            objective: "确认公司是否属于创新硬件且不在排除行业",
            questions: ["公司是否做医疗器械？"],
            searchHints: ["company hardware product"]
          },
          {
            id: "overflow",
            role: "overflow",
            title: "预算外任务",
            objective: "这个任务应被预算截断",
            questions: ["extra"],
            searchHints: ["extra"]
          }
        ]
      },
      1,
      { ...DEFAULT_HEAVY_BUDGET, maxAgentsPerRun: 2 }
    );

    expect(plan.tasks.map((task) => task.id)).toEqual(["identity_research", "company-fit_research"]);
    expect(plan.tasks[0].questions).toEqual(["候选人是否仍在任？"]);
  });

  it("filters bad sources and findings without crashing the agent report", () => {
    const report = normalizeAgentReport({
      taskId: "identity_research",
      agentId: "agent_identity_research",
      role: "identity_research",
      status: "completed",
      summary: "找到一个候选证据",
      queries: ["CEO Australia AI hardware"],
      sources: [
        { title: "", url: "not-a-url", snippet: "bad" },
        { title: "Source A", url: "https://example.com/a", snippet: "CEO evidence" }
      ],
      findings: [
        { claim: "", support: "supported", sourceUrls: ["https://example.com/a"] },
        {
          claim: "候选人是该公司的 CEO",
          support: "supported",
          confidence: "very-high",
          sourceUrls: ["not-a-url", "https://example.com/a"]
        }
      ]
    });

    expect(report.sources).toHaveLength(1);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      claim: "候选人是该公司的 CEO",
      confidence: "medium",
      sourceUrls: ["https://example.com/a"]
    });
  });

  it("normalizes valid agent research steps and removes invalid entries", () => {
    const report = normalizeAgentReport({
      taskId: "identity_research",
      agentId: "agent_identity_research",
      role: "identity_research",
      status: "completed",
      summary: "研究完成",
      queries: ["Grace Brown Andromeda Robotics CEO"],
      researchSteps: [
        {
          id: "step_1",
          type: "intent",
          title: "识别任务意图",
          detail: "Need to verify CEO identity and tenure.",
          decision: "continue",
          timestamp: "2026-07-01T00:00:00.000Z"
        },
        {
          id: "step_2",
          type: "keyword_revision",
          title: "调整关键词",
          detail: "Initial search did not prove tenure, so add candidate and company names.",
          round: 2,
          queries: [
            "Grace Brown Andromeda Robotics over the last three years",
            "site:andromedarobotics.ai Grace Brown CEO",
            "Grace Brown 中文关键词 Andromeda Robotics CEO"
          ],
          selectedUrls: ["https://andromedarobotics.ai/post/series-a-funding-news-fuel-for-our-zero-loneliness-vision"],
          decision: "revise_query",
          reason: "The first search found a candidate but did not verify the 3+ year condition.",
          timestamp: "2026-07-01T00:00:01.000Z"
        },
        {
          id: "",
          type: "search",
          title: "",
          detail: "",
          queries: ["中文关键词不应该保留"],
          timestamp: "2026-07-01T00:00:02.000Z"
        }
      ] satisfies AgentResearchStep[],
      sources: [{ title: "Source A", url: "https://example.com/a", snippet: "CEO evidence", provider: "test" }],
      findings: []
    });

    expect(report.researchSteps).toHaveLength(2);
    expect(report.researchSteps[0]).toMatchObject({
      id: "step_1",
      type: "intent",
      decision: "continue"
    });
    expect(report.researchSteps[1].queries).toEqual([
      "Grace Brown Andromeda Robotics over the last three years",
      "site:andromedarobotics.ai Grace Brown CEO",
      "Grace Brown Andromeda Robotics CEO"
    ]);
    expect(report.researchSteps[1].queries?.every((query) => !/[\u3400-\u9fff\uf900-\ufaff]/.test(query))).toBe(true);
  });

  it("defaults missing agent research steps to an empty array", () => {
    const report = normalizeAgentReport({
      taskId: "identity_research",
      agentId: "agent_identity_research",
      role: "identity_research",
      status: "completed",
      summary: "legacy report",
      queries: ["CEO Australia"],
      sources: [],
      findings: []
    });

    expect(report.researchSteps).toEqual([]);
  });

  it("normalizes verifier output and keeps recommended next tasks", () => {
    const verification = normalizeVerificationReport({
      status: "needs_more_research",
      summary: "增长率缺少证据",
      issues: [{ type: "missing_source", severity: "high", message: "无来源结论", relatedTaskId: "growth" }],
      recommendedNextTasks: [
        {
          id: "growth_research",
          role: "growth_research",
          title: "增长率补查",
          objective: "确认年度增长率是否达到 30%",
          questions: ["是否有公开增长数据？"],
          searchHints: ["annual growth revenue"]
        },
        { id: "", objective: "" }
      ],
      missingEvidence: ["annual growth"]
    });

    expect(verification.status).toBe("needs_more_research");
    expect(verification.issues).toHaveLength(1);
    expect(verification.recommendedNextTasks).toHaveLength(1);
    expect(verification.missingEvidence).toEqual(["annual growth"]);
  });
});
