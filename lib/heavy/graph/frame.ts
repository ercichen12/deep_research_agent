import { DEFAULT_GRAPH_BUDGET, normalizeResearchFrame, type GraphBudgetState, type ResearchFrame, type TaskKind } from "@/lib/heavy/graph/types";

export function createResearchFrame(prompt: string, budget: GraphBudgetState = DEFAULT_GRAPH_BUDGET): ResearchFrame {
  const taskKind = inferTaskKind(prompt);
  const lower = prompt.toLowerCase();

  if (taskKind === "find_person_company") {
    return normalizeResearchFrame(
      {
        taskKind,
        userGoal: prompt,
        deliverable: "最大可能候选人 / company match with evidence matrix",
        hardConstraints: [
          { id: "person_identity", label: "person identity", core: true },
          { id: "company_identity", label: "company identity", core: true },
          { id: "role", label: "CEO founder senior leadership", core: true },
          { id: "industry_fit", label: "innovative robotics AI hardware company", core: true },
          { id: "geography", label: lower.includes("australia") || prompt.includes("澳大利亚") ? "Australia" : "target geography", core: true },
          { id: "ai_public_view", label: "recent public AI viewpoint" }
        ],
        softPreferences: lower.includes("growth") || prompt.includes("增长")
          ? [{ id: "growth", label: "30% annual growth or credible proxy growth evidence" }]
          : [],
        exclusionRules: [
          ...(prompt.includes("太阳能") || lower.includes("solar") ? [{ id: "no_solar", label: "not solar panels" }] : []),
          ...(prompt.includes("医疗") || lower.includes("medical") ? [{ id: "no_medical", label: "not medical devices" }] : []),
          ...(prompt.includes("重工") || lower.includes("heavy") ? [{ id: "no_heavy", label: "not heavy manufacturing" }] : [])
        ],
        initialAngles: [
          {
            id: "broad_candidate_search",
            title: "Broad candidate search",
            priority: "high",
            querySeeds: [
              "Australian robotics AI hardware CEO founder interview",
              "Australia innovative hardware robotics CEO AI article"
            ]
          },
          {
            id: "growth_signal_search",
            title: "Growth signal search",
            priority: "medium",
            querySeeds: ["Australian robotics hardware startup funding expansion CEO"]
          }
        ],
        stopCriteria: ["rank best candidate when core constraints have direct or proxy evidence"]
      },
      budget
    );
  }

  return normalizeResearchFrame(
    {
      taskKind,
      userGoal: prompt,
      deliverable: "Evidence-backed markdown report",
      hardConstraints: [{ id: "answerable", label: "answerable with public evidence", core: true }],
      initialAngles: [{ id: "broad_search", title: "Broad search", priority: "high", querySeeds: [promptToEnglishFallback(prompt)] }]
    },
    budget
  );
}

function inferTaskKind(prompt: string): TaskKind {
  const lower = prompt.toLowerCase();
  if (/cloudflare|dns|subdomain|子域名|域名/.test(lower)) {
    return "technical_verification";
  }
  if (/hs8542|customs|海关|清洗|分级|workflow/.test(lower)) {
    return "data_workflow_design";
  }
  if (/distributor|分销商|名单|b2b|supplier/.test(lower)) {
    return "market_list_building";
  }
  if (/eol|sales|销售|库存/.test(lower)) {
    return "sales_strategy";
  }
  if (/website|网站|考试|license|许可/.test(lower)) {
    return "find_website";
  }
  if (/ceo|founder|公司|company|person|人/.test(lower)) {
    return "find_person_company";
  }
  return "general_research";
}

function promptToEnglishFallback(prompt: string): string {
  const stripped = prompt.replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ").replace(/\s+/g, " ").trim();
  return stripped || "public evidence research";
}
