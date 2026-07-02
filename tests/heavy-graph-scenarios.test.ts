import { describe, expect, it } from "vitest";
import { createResearchFrame } from "@/lib/heavy/graph/frame";
import { planGraphActions } from "@/lib/heavy/graph/planner";
import { extractEvidence } from "@/lib/heavy/graph/evidence-extractor";
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
    expect(report.summary).not.toBe("证据不足");
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
