import { describe, expect, it } from "vitest";
import { createResearchFrame } from "@/lib/heavy/graph/frame";
import { planGraphActions } from "@/lib/heavy/graph/planner";
import { extractEvidence } from "@/lib/heavy/graph/evidence-extractor";
import { evaluateGraphState } from "@/lib/heavy/graph/evaluator";
import { finalizeGraphReport } from "@/lib/heavy/graph/finalizer";
import { buildEvidenceMatrix, hardConstraintsEnough } from "@/lib/heavy/graph/evidence-matrix";
import { scoreCandidate } from "@/lib/heavy/graph/candidate-pool";
import {
  DEFAULT_GRAPH_BUDGET,
  createResearchState,
  normalizeEvidenceExtractionOutput,
  type Candidate,
  type EvidenceItem,
  type ResearchState
} from "@/lib/heavy/graph/types";

describe("Graph Heavy Apodex-derived scenarios", () => {
  it("Grace / Andromeda keeps English query ladder and treats exact growth as an unknown soft preference", () => {
    const state = stateFor(
      "我要找一个公司的CEO，这个公司是做有创新性的硬件，但是不能做太阳能板，也不能做医疗器械，也不能做重工制造。公司每年最好能增长30%。这个人最好在澳大利亚，在这个企业做了三年以上，并且最近发表过包含AI观点的文章。"
    );

    const actions = planGraphActions(state);
    const queries = searchQueries(actions);

    expect(state.frame.taskKind).toBe("find_person_company");
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.every((query) => !/[\u3400-\u9fff\uf900-\ufaff]/.test(query))).toBe(true);
    expect(queries.join(" ")).toMatch(/Australian|Australia/i);
    expect(state.frame.softPreferences.map((constraint) => constraint.id)).toContain("growth");
    expect(state.frame.hardConstraints.map((constraint) => constraint.id)).not.toContain("growth");
  });

  it("US exam/license website tasks extract clue constraints and compose English website search", () => {
    const state = stateFor("帮我根据一个人的名字和 AI 免费考试许可线索，找到美国考试或 license 网站。");
    const queries = searchQueries(planGraphActions(state)).join(" ");

    expect(state.frame.taskKind).toBe("find_website");
    expect(state.frame.hardConstraints.map((constraint) => constraint.id)).toEqual(
      expect.arrayContaining(["entity_clues", "website_candidate", "verification_chain"])
    );
    expect(queries).toMatch(/exam|license/i);
    expect(queries).toMatch(/AI|free|website/i);
    expect(queries).not.toMatch(/[\u3400-\u9fff\uf900-\ufaff]/);
  });

  it("CEO plus official website tasks keep the named entity instead of using the exam/license template", () => {
    const state = stateFor("QA smoke test: find the current CEO and official website of OpenAI. Use English search keywords only.");
    const queries = searchQueries(planGraphActions(state));
    const queryText = queries.join(" ");

    expect(state.frame.taskKind).toBe("find_person_company");
    expect(queryText).toMatch(/OpenAI/i);
    expect(queryText).toMatch(/CEO|official website/i);
    expect(queryText).not.toMatch(/exam|license|practice/i);
    expect(queries.every((query) => !/[\u3400-\u9fff\uf900-\ufaff]/.test(query))).toBe(true);
  });

  it("OpenAI CEO and official website sources produce a maximum-likelihood named candidate", () => {
    const frame = createResearchFrame("QA smoke test: find the current CEO and official website of OpenAI. Use English search keywords only.");
    const output = extractEvidence({
      frame,
      sources: [
        {
          summary: source("https://www.businessinsider.com/sam-altman", "Meet Sam Altman, OpenAI's Cofounder and CEO"),
          snippet: "The career rise of OpenAI's billionaire CEO, Sam Altman.",
          fullText: "Sam Altman is the cofounder and CEO of OpenAI. OpenAI is the company behind ChatGPT."
        },
        {
          summary: source("https://openai.com/", "OpenAI"),
          snippet: "Official OpenAI website.",
          fullText: "OpenAI official website. OpenAI creates AI products and research for everyone."
        },
        {
          summary: source("https://openai.com/index/review-completed-altman-brockman-to-continue-to-lead-openai/", "Review completed & Altman, Brockman to continue to lead OpenAI | OpenAI"),
          snippet: "Altman and Brockman continue to lead OpenAI.",
          fullText: "OpenAI announced that Sam Altman and Greg Brockman continue to lead OpenAI."
        }
      ]
    });

    expect(output.candidates.map((candidate) => candidate.name)).toContain("Sam Altman / OpenAI");
    expect(output.evidenceItems.flatMap((item) => item.constraintIds)).toEqual(
      expect.arrayContaining(["person_identity", "company_identity", "role", "official_website", "verification_chain"])
    );
    expect(output.evidenceItems.every((item) => item.sourceUrl.startsWith("https://"))).toBe(true);
  });

  it("Cloudflare/free subdomain verification models PSL and NS delegation as hidden success criteria", () => {
    const state = stateFor("验证哪些免费子域名可以接入 Cloudflare DNS，重点是能不能设置 authoritative nameservers。");
    const queries = searchQueries(planGraphActions(state)).join(" ");

    expect(state.frame.taskKind).toBe("technical_verification");
    expect(state.frame.hardConstraints.map((constraint) => constraint.id)).toEqual(
      expect.arrayContaining(["cloudflare_support", "public_suffix_list", "ns_delegation"])
    );
    expect(queries).toMatch(/Cloudflare/i);
    expect(queries).toMatch(/Public Suffix List|authoritative nameserver|NS delegation/i);
  });

  it("electronics distributor list tasks split public source strategies before searching", () => {
    const state = stateFor("我要找电子元器件 distributor 大名单，北美、欧洲、亚太都要，最好能用公开渠道去重和抽样核验。");
    const actions = planGraphActions(state);
    const queryText = searchQueries(actions).join(" ");

    expect(state.frame.taskKind).toBe("market_list_building");
    expect(actions.filter((action) => action.type === "search_web").length).toBeGreaterThanOrEqual(2);
    expect(queryText).toMatch(/North America|Europe|Asia Pacific/i);
    expect(queryText).toMatch(/association|directory|trade show|B2B|customs/i);
    expect(state.frame.hardConstraints.map((constraint) => constraint.id)).toEqual(
      expect.arrayContaining(["regional_coverage", "source_diversity", "deduplication", "sample_verification"])
    );
  });

  it("Hong Kong EOL sales tasks model cold-start channels, platform cost, and transaction risk", () => {
    const state = stateFor("我是香港新卖家，没有交易历史，要卖 EOL 电子元器件库存，低成本冷启动，帮我规划销售渠道。");
    const queries = searchQueries(planGraphActions(state)).join(" ");

    expect(state.frame.taskKind).toBe("sales_strategy");
    expect(state.frame.hardConstraints.map((constraint) => constraint.id)).toEqual(
      expect.arrayContaining(["seller_status", "channel_fit", "platform_cost", "transaction_risk"])
    );
    expect(queries).toMatch(/EOL|surplus|electronic components/i);
    expect(queries).toMatch(/Hong Kong|escrow|new seller|marketplace/i);
  });

  it("HS8542 workflow tasks keep cleaning, entity merge, peer detection, customer tiering, and evidence boundaries", () => {
    const state = stateFor("用 HS8542 海关数据做客户分群，要包括清洗、实体合并、同行识别、客户分级、存储架构，以及 EOL/HTF 的外部验证边界。");
    const queries = searchQueries(planGraphActions(state)).join(" ");

    expect(state.frame.taskKind).toBe("data_workflow_design");
    expect(state.frame.hardConstraints.map((constraint) => constraint.id)).toEqual(
      expect.arrayContaining(["data_cleaning", "entity_resolution", "peer_detection", "customer_tiering", "external_verification_boundary"])
    );
    expect(queries).toMatch(/HS8542|customs data/i);
    expect(queries).toMatch(/entity resolution|customer segmentation|EOL|HTF/i);
  });

  it("HS8542 revised searches use compact English keywords instead of replaying raw source excerpts", () => {
    const state = stateFor("用 HS8542 海关数据做客户分群，要包括清洗、实体合并、同行识别、客户分级、存储架构，以及 EOL/HTF 的外部验证边界。");
    state.searchLedger.push({
      id: "batch_rich_no_workflow_evidence",
      actionId: "act_1",
      cycle: 1,
      queries: searchQueries(planGraphActions(state)),
      queryCount: 3,
      providerCalls: [],
      dedupedResultCount: 81,
      uniqueDomainCount: 65,
      expectedSignalHits: [],
      officialOrPrimaryCount: 2,
      candidateMentions: [],
      quality: "mixed"
    });
    state.sourceLedger.push({
      sourceHash: "source_long_linkedin_post",
      title:
        "semiconductor integratedcircuits customsdata tradedata supplychainintelligence icindustry b2bleadgeneration exportdata importdata hs8542 1 Who s really buying ICs HS 8542 in your target market right now If you re in the semiconductor space you know the challenge trade fairs are great but real demand leaves a trail no fluff just actionable insights",
      url: "https://www.linkedin.com/posts/example",
      provider: "opencli",
      engine: "google",
      status: "read",
      readCharCount: 1200,
      evidenceIds: []
    });
    state.cycleIndex = 1;
    state.budgets.cyclesUsed = 1;
    state.evaluatorDecisions.push(evaluateGraphState(state));

    const queries = searchQueries(planGraphActions(state));

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((query) => query.length <= 140)).toBe(true);
    expect(queries.join(" ")).not.toMatch(/Who s really buying|no fluff|actionable insights/i);
    expect(queries.some((query) => /HS8542|customs data|entity resolution|EOL|HTF/i.test(query))).toBe(true);
  });

  it("HS8542 workflow sources extract constraint-level evidence without synthetic workflow candidates", () => {
    const frame = createResearchFrame("用 HS8542 海关数据做客户分群，要包括清洗、实体合并、同行识别、客户分级、存储架构，以及 EOL/HTF 的外部验证边界。");
    const output = extractEvidence({
      frame,
      sources: [
        {
          summary: source("https://www.wcoomd.org/datamodel", "WCO Data Model - World Customs Organization"),
          snippet: "Customs data model and trade data records for importer/exporter workflows.",
          fullText:
            "HS8542 customs data and bill of lading records need data cleaning, standardization, importer exporter entity resolution, deduplication, peer and competitor detection from shipment patterns, customer segmentation and tiering by volume/value, and a warehouse schema or workflow architecture."
        },
        {
          summary: source("https://example.com/eol-htf", "Electronic components EOL HTF verification beyond HS code"),
          snippet: "HS and HTS codes classify goods but do not prove lifecycle status.",
          fullText:
            "EOL and HTF status cannot be inferred from HS code or HTS classification alone. Electronic component lifecycle, obsolete status, hard-to-find availability, and allocation risk need external supplier or lifecycle database verification."
        }
      ]
    });
    const constraintIds = output.evidenceItems.flatMap((item) => item.constraintIds);

    expect(output.candidates.some((candidate) => candidate.kind === "workflow")).toBe(false);
    expect(constraintIds).toEqual(
      expect.arrayContaining([
        "data_cleaning",
        "entity_resolution",
        "peer_detection",
        "customer_tiering",
        "storage_architecture",
        "external_verification_boundary"
      ])
    );
  });

  it("weak or empty search results force revised English queries using discovered clues", () => {
    const state = stateFor("找澳大利亚创新硬件 CEO");
    state.searchLedger.push({
      id: "batch_weak",
      actionId: "act_1",
      cycle: 1,
      queryCount: 1,
      providerCalls: [],
      dedupedResultCount: 1,
      uniqueDomainCount: 1,
      expectedSignalHits: [],
      officialOrPrimaryCount: 0,
      candidateMentions: [],
      quality: "weak"
    });
    state.queryClues.push({ id: "clue_1", text: "Andromeda Robotics CEO AI interview", source: "search_result", weight: 5 });

    const queries = searchQueries(planGraphActions(state));

    expect(queries).toEqual(expect.arrayContaining(["Andromeda Robotics CEO AI interview"]));
    expect(queries.some((query) => /official|profile|interview|funding/i.test(query))).toBe(true);
    expect(queries.every((query) => !/[\u3400-\u9fff\uf900-\ufaff]/.test(query))).toBe(true);
  });

  it("rich search with zero extracted evidence triggers extraction-focused revision instead of repeating the same queries", () => {
    const state = stateFor("QA smoke test: find the current CEO and official website of OpenAI. Use English search keywords only.");
    const initialQueries = searchQueries(planGraphActions(state));
    state.searchLedger.push({
      id: "batch_rich_no_evidence",
      actionId: "act_1",
      cycle: 1,
      queryCount: initialQueries.length,
      providerCalls: [],
      dedupedResultCount: 33,
      uniqueDomainCount: 21,
      expectedSignalHits: ["OpenAI company identity", "current CEO founder senior leadership"],
      officialOrPrimaryCount: 1,
      candidateMentions: [],
      quality: "mixed"
    });
    state.sourceLedger.push({
      sourceHash: "source_sam_altman",
      title: "Meet Sam Altman, OpenAI's Cofounder and CEO",
      url: "https://www.businessinsider.com/sam-altman",
      provider: "opencli",
      engine: "brave",
      status: "read",
      readCharCount: 12000,
      evidenceIds: []
    });
    state.cycleIndex = 1;
    state.budgets.cyclesUsed = 1;

    const decision = evaluateGraphState(state);
    state.evaluatorDecisions.push(decision);
    const nextQueries = searchQueries(planGraphActions(state));

    expect(decision.action).toBe("revise_query");
    expect(decision.reason).toMatch(/抽取|候选|extraction/i);
    expect(nextQueries).not.toEqual(initialQueries);
    expect(nextQueries.every((query) => !/[\u3400-\u9fff\uf900-\ufaff]/.test(query))).toBe(true);
    expect(nextQueries.some((query) => /Sam Altman|Business Insider|OpenAI CEO/i.test(query))).toBe(true);
  });

  it("revised search never replays the same queries when every base query was already used", () => {
    const state = stateFor("QA smoke test: find the current CEO and official website of OpenAI. Use English search keywords only.");
    state.budgets.maxQueriesPerSearchAction = 1;
    const initialQueries = searchQueries(planGraphActions(state));
    state.searchLedger.push({
      id: "batch_all_used",
      actionId: "act_1",
      cycle: 1,
      queries: initialQueries,
      queryCount: initialQueries.length,
      providerCalls: [],
      dedupedResultCount: 1,
      uniqueDomainCount: 1,
      expectedSignalHits: [],
      officialOrPrimaryCount: 0,
      candidateMentions: [],
      quality: "weak"
    });
    state.cycleIndex = 1;
    const firstRevisionQueries = searchQueries(planGraphActions(state));
    state.searchLedger.push({
      id: "batch_revision_used",
      actionId: "act_2",
      cycle: 2,
      queries: firstRevisionQueries,
      queryCount: firstRevisionQueries.length,
      providerCalls: [],
      dedupedResultCount: 1,
      uniqueDomainCount: 1,
      expectedSignalHits: [],
      officialOrPrimaryCount: 0,
      candidateMentions: [],
      quality: "weak"
    });
    state.cycleIndex = 2;

    const nextQueries = searchQueries(planGraphActions(state));

    expect(nextQueries.length).toBeGreaterThan(0);
    expect(nextQueries.every((query) => ![...initialQueries, ...firstRevisionQueries].includes(query))).toBe(true);
    expect(nextQueries.some((query) => /source verification|official source|news profile|primary evidence/i.test(query))).toBe(true);
  });

  it("third-party pages with official in the title do not create official website evidence without a matching domain", () => {
    const frame = createResearchFrame("QA smoke test: find the current CEO and official website of OpenAI. Use English search keywords only.");
    const output = extractEvidence({
      frame,
      sources: [
        {
          summary: source("https://profiles.example/openai-ceo", "Official profile of OpenAI CEO Sam Altman"),
          snippet: "Sam Altman is the CEO of OpenAI.",
          fullText: "Sam Altman is the cofounder and CEO of OpenAI. This is a third-party profile."
        }
      ]
    });

    expect(output.candidates.map((candidate) => candidate.name)).toContain("Sam Altman / OpenAI");
    expect(output.evidenceItems.flatMap((item) => item.constraintIds)).not.toContain("official_website");
  });

  it("noisy OpenAI search titles do not become person candidates when Sam Altman evidence exists", () => {
    const frame = createResearchFrame("QA smoke test: find the current CEO and official website of OpenAI. Use English search keywords only.");
    const output = extractEvidence({
      frame,
      sources: [
        {
          summary: source("https://www.wired.com/story/sam-altman-openai-back/", "Sam Altman to Return as CEO of OpenAI | WIRED"),
          snippet: "Sam Altman will return as CEO of OpenAI.",
          fullText: "Sam Altman is the cofounder and CEO of OpenAI."
        },
        {
          summary: source("https://example.com/openai-capabilities", "Remarkable Step Function Capabilities at OpenAI"),
          snippet: "OpenAI leadership discussed product capabilities.",
          fullText: "OpenAI has remarkable step function capabilities and public leadership pages, but this title is not a person."
        },
        {
          summary: source("https://websets.example/openai-executives", "Meet the Visionary OpenAI, Inc. Leadership Team"),
          snippet: "OpenAI leadership team directory.",
          fullText: "OpenAI leadership team directory and executive overview."
        },
        {
          summary: source("https://theorg.example/openai-leadership", "Partnerships Sam Altman OpenAI Leadership Team"),
          snippet: "Partnerships Sam Altman is listed near OpenAI CEO evidence.",
          fullText: "Partnerships Sam Altman is the CEO of OpenAI."
        },
        {
          summary: source("https://forbes.example/openai", "Forbes Sam Altman Feb OpenAI CEO"),
          snippet: "Forbes profile: Sam Altman, CEO of OpenAI.",
          fullText: "Sam Altman is CEO of OpenAI."
        }
      ]
    });
    const names = output.candidates.map((candidate) => candidate.name);

    expect(names).toContain("Sam Altman / OpenAI");
    expect(names.some((name) => /remarkable|leadership team|wired|partnerships|forbes/i.test(name))).toBe(false);
  });

  it("technical verification evidence extraction creates constraint-level evidence for PSL and NS delegation", () => {
    const frame = createResearchFrame("验证免费子域名是否支持 Cloudflare authoritative NS delegation 和 Public Suffix List。");
    const output = extractEvidence({
      frame,
      sources: [
        {
          summary: source("https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/", "Cloudflare subdomain setup"),
          snippet: "Cloudflare requires delegated nameservers for a subdomain setup.",
          fullText:
            "Cloudflare DNS can work when the subdomain has authoritative NS delegation. Public Suffix List entries affect whether a hostname can be treated as an registrable boundary."
        }
      ]
    });

    expect(output.evidenceItems.map((item) => item.constraintIds).flat()).toEqual(
      expect.arrayContaining(["cloudflare_support", "public_suffix_list", "ns_delegation"])
    );
    expect(output.candidates.some((candidate) => candidate.kind === "service" || candidate.kind === "workflow")).toBe(true);
  });

  it("core hard constraints can rank a candidate while one non-core hard constraint remains missing", () => {
    const frame = createResearchFrame("找澳大利亚创新硬件 CEO，最好最近发表 AI 观点。");
    const candidate = candidateFixture("cand_1", "Candidate One / HardwareCo");
    const coreConstraintIds = frame.hardConstraints.filter((constraint) => constraint.core).map((constraint) => constraint.id);
    const evidenceItems = coreConstraintIds.map((constraintId, index) =>
      evidence(`ev_${constraintId}`, candidate.id, constraintId, index % 2 === 0 ? "direct" : "proxy")
    );
    const matrix = buildEvidenceMatrix(frame, [candidate], evidenceItems);
    const scored = scoreCandidate(candidate, frame, matrix, []);

    expect(frame.hardConstraints.some((constraint) => !constraint.core)).toBe(true);
    expect(hardConstraintsEnough(scored, frame, matrix)).toBe(true);
  });

  it("workflow-style tasks finalize a maximum-likelihood path instead of saying no candidate was found", () => {
    const state = stateFor("HS8542 customs data workflow for customer segmentation and external EOL verification.");
    state.evidenceItems.push(
      evidence("ev_cleaning", "workflow_hs8542", "data_cleaning", "direct"),
      evidence("ev_entity", "workflow_hs8542", "entity_resolution", "proxy"),
      evidence("ev_boundary", "workflow_hs8542", "external_verification_boundary", "direct")
    );
    state.evidenceMatrix = buildEvidenceMatrix(state.frame, [], state.evidenceItems);
    state.workflowArtifacts.push(
      workflowArtifact("draft"),
      workflowArtifact("critique"),
      workflowArtifact("revision", [
        "Gate 1: clean and normalize HS8542 customs records.",
        "Gate 2: merge importer/exporter entities.",
        "Gate 3: verify EOL/HTF externally."
      ])
    );
    state.evaluatorDecisions.push({
      id: "eval_1_finalize",
      cycle: 1,
      action: "finalize",
      reason: "Workflow path evidence exists.",
      nextFocus: ["HS8542 workflow"],
      unresolvedQuestions: ["EOL/HTF status needs external verification"],
      createdAt: "2026-07-02T00:00:00.000Z"
    });

    const report = finalizeGraphReport(state);

    expect(report.markdown).toMatch(/最大可能|workflow|路径|HS8542/i);
    expect(report.markdown).toMatch(/清洗|entity|外部验证|EOL|HTF/i);
    expect(report.markdown).toMatch(/raw_shipments|normalized_shipments|entity_aliases|customer_scores|external_verifications/i);
    expect(report.markdown).toMatch(/客户分级规则|近 12 个月|EOL \/ HTF 边界/i);
    expect(report.unknowns).not.toContain("workflow 还没有完成校验挑错");
    expect(report.unknowns).not.toContain("workflow 还没有重建为有序 gates");
    expect(report.summary).not.toBe("证据不足");
  });

  it("workflow tasks switch from more searching to internal draft/critique/revision actions once evidence exists", () => {
    const state = stateFor("用 HS8542 海关数据做客户分群，要包括清洗、实体合并、同行识别、客户分级、存储架构，以及 EOL/HTF 的外部验证边界。");
    state.evidenceItems.push(evidence("ev_cleaning", "workflow_hs8542", "data_cleaning", "direct"));
    state.sourceLedger.push({
      sourceHash: "source_trade",
      title: "Customs workflow source",
      url: "https://trade.example/workflow",
      provider: "opencli",
      engine: "google",
      status: "read",
      readCharCount: 1000,
      evidenceIds: ["ev_cleaning"]
    });

    const draftActions = planGraphActions(state);
    state.workflowArtifacts.push({
      id: "workflow_draft",
      cycle: 1,
      stage: "draft",
      title: "Draft workflow",
      summary: "Draft",
      findings: [],
      invalidAssumptions: [],
      orderedGates: [],
      sourceUrls: [],
      createdAt: "2026-07-02T00:00:00.000Z"
    });
    const critiqueActions = planGraphActions(state);

    expect(draftActions.every((action) => action.type !== "search_web")).toBe(true);
    expect(draftActions[0]?.purpose).toMatch(/draft workflow/i);
    expect(critiqueActions.every((action) => action.type !== "search_web")).toBe(true);
    expect(critiqueActions[0]?.purpose).toMatch(/critique workflow/i);
  });
});

function stateFor(prompt: string): ResearchState {
  const frame = createResearchFrame(prompt, {
    ...DEFAULT_GRAPH_BUDGET,
    maxActionsPerCycle: 6,
    maxSearchActionsPerCycle: 4,
    maxQueriesPerSearchAction: 4
  });
  return createResearchState({
    inquiryId: "inquiry_scenario",
    turnId: "turn_scenario",
    frame,
    budget: {
      ...DEFAULT_GRAPH_BUDGET,
      maxActionsPerCycle: 6,
      maxSearchActionsPerCycle: 4,
      maxQueriesPerSearchAction: 4
    }
  });
}

function searchQueries(actions: ReturnType<typeof planGraphActions>): string[] {
  return actions.flatMap((action) => (action.type === "search_web" ? action.queries : []));
}

function workflowArtifact(stage: "draft" | "critique" | "revision", orderedGates: string[] = []) {
  return {
    id: `workflow_${stage}`,
    cycle: stage === "draft" ? 1 : stage === "critique" ? 2 : 3,
    stage,
    title: `${stage} workflow`,
    summary: `${stage} summary`,
    findings: [],
    invalidAssumptions: stage === "draft" ? [] : ["HS code cannot prove EOL/HTF by itself."],
    orderedGates,
    sourceUrls: [],
    createdAt: "2026-07-02T00:00:00.000Z"
  };
}

function source(url: string, title: string) {
  return {
    sourceHash: `source_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    title,
    url,
    provider: "opencli" as const,
    engine: "google",
    status: "read" as const,
    readCharCount: 1000,
    evidenceIds: []
  };
}

function candidateFixture(id: string, name: string): Candidate {
  return normalizeEvidenceExtractionOutput({
    candidates: [
      {
        id,
        kind: "person_company",
        name,
        aliases: [name],
        summary: "Scenario candidate"
      }
    ]
  }).candidates[0];
}

function evidence(id: string, subjectId: string, constraintId: string, strength: EvidenceItem["strength"]): EvidenceItem {
  return normalizeEvidenceExtractionOutput({
    evidenceItems: [
      {
        id,
        claim: `${constraintId} evidence`,
        subjectIds: [subjectId],
        constraintIds: [constraintId],
        sourceUrl: `https://evidence.example/${id}`,
        sourceTitle: `${constraintId} source`,
        sourceType: "official",
        provider: "opencli",
        engine: "google",
        paraphrase: `${constraintId} evidence`,
        strength
      }
    ]
  }).evidenceItems[0];
}
