import { DEFAULT_GRAPH_BUDGET, normalizeResearchFrame, type GraphBudgetState, type ResearchFrame, type TaskKind } from "@/lib/heavy/graph/types";

export function createResearchFrame(prompt: string, budget: GraphBudgetState = DEFAULT_GRAPH_BUDGET): ResearchFrame {
  const taskKind = inferTaskKind(prompt);
  const lower = prompt.toLowerCase();
  const namedSubject = extractNamedSubject(prompt);

  if (taskKind === "find_person_company") {
    const isNamedEntityLookup = Boolean(namedSubject);
    return normalizeResearchFrame(
      {
        taskKind,
        userGoal: prompt,
        deliverable: "最大可能候选人 / company match with evidence matrix",
        hardConstraints: isNamedEntityLookup
          ? [
              { id: "person_identity", label: `${namedSubject} current CEO identity`, core: true },
              { id: "company_identity", label: `${namedSubject} company identity`, core: true },
              { id: "role", label: "current CEO founder senior leadership", core: true },
              { id: "official_website", label: `${namedSubject} official website`, core: true },
              { id: "verification_chain", label: "source chain verifying role and official website", core: true }
            ]
          : [
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
        initialAngles: isNamedEntityLookup
          ? [
              {
                id: "named_entity_leadership_search",
                title: "Named entity leadership search",
                priority: "high",
                querySeeds: [
                  `${namedSubject} current CEO official website`,
                  `${namedSubject} leadership CEO official site`,
                  `${namedSubject} company profile CEO official website`
                ]
              },
              {
                id: "named_entity_verification_search",
                title: "Named entity verification search",
                priority: "medium",
                querySeeds: [`${namedSubject} CEO source official newsroom profile`]
              }
            ]
          : [
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

  if (taskKind === "find_website") {
    return normalizeResearchFrame(
      {
        taskKind,
        userGoal: prompt,
        deliverable: "Candidate website with verification chain",
        hardConstraints: [
          { id: "entity_clues", label: "person product exam license AI clue extraction", core: true },
          { id: "website_candidate", label: "candidate website or web app", core: true },
          { id: "verification_chain", label: "source chain verifying the candidate website", core: true },
          { id: "free_or_ai_signal", label: "free AI exam or license signal" }
        ],
        initialAngles: [
          {
            id: "exam_license_website_search",
            title: "Exam/license website search",
            priority: "high",
            querySeeds: [
              "US exam license AI free website",
              "free AI practice exam license platform website",
              "person name exam license AI website"
            ]
          },
          {
            id: "entity_combo_search",
            title: "Discovered entity combination search",
            priority: "medium",
            querySeeds: ["AI certification exam free license website founder product"]
          }
        ],
        assumptions: [{ text: "The user may have partial clues; discovered entities should be recombined after weak searches." }]
      },
      budget
    );
  }

  if (taskKind === "technical_verification") {
    return normalizeResearchFrame(
      {
        taskKind,
        userGoal: prompt,
        deliverable: "Technical feasibility verdict with hidden criteria",
        hardConstraints: [
          { id: "cloudflare_support", label: "Cloudflare DNS support", core: true },
          { id: "public_suffix_list", label: "Public Suffix List registrable boundary", core: true },
          { id: "ns_delegation", label: "authoritative nameserver NS delegation", core: true },
          { id: "provider_control", label: "user can control DNS or nameserver records" }
        ],
        exclusionRules: [
          { id: "cname_only", label: "CNAME-only subdomain without nameserver delegation" },
          { id: "no_zone_boundary", label: "hostname cannot be added as an independent Cloudflare zone" }
        ],
        initialAngles: [
          {
            id: "cloudflare_subdomain_dns",
            title: "Cloudflare subdomain DNS criteria",
            priority: "high",
            querySeeds: [
              "Cloudflare free subdomain Public Suffix List authoritative nameserver delegation",
              "Cloudflare custom nameservers subdomain NS delegation Public Suffix List",
              "free subdomain provider NS delegation Cloudflare DNS support"
            ]
          },
          {
            id: "hidden_dns_criteria",
            title: "Hidden DNS success criteria",
            priority: "high",
            querySeeds: [
              "Public Suffix List private domain Cloudflare zone subdomain",
              "authoritative NS delegation subdomain DNS provider Cloudflare"
            ]
          }
        ],
        assumptions: [{ text: "The real success criterion is whether Cloudflare can treat the hostname as a zone with delegated authority." }]
      },
      budget
    );
  }

  if (taskKind === "market_list_building") {
    return normalizeResearchFrame(
      {
        taskKind,
        userGoal: prompt,
        deliverable: "Deduplicated market list strategy with public-source ceiling",
        hardConstraints: [
          { id: "regional_coverage", label: "North America Europe Asia Pacific regional coverage", core: true },
          { id: "source_diversity", label: "association directory B2B trade show customs source diversity", core: true },
          { id: "deduplication", label: "company deduplication and entity merge", core: true },
          { id: "sample_verification", label: "sample verification of distributor identity", core: true },
          { id: "market_ceiling", label: "public-channel list size and market ceiling" }
        ],
        softPreferences: [{ id: "buyer_precision", label: "separate precise buyers from broad funnel" }],
        initialAngles: [
          {
            id: "regional_distributor_directories",
            title: "Regional distributor directories",
            priority: "high",
            querySeeds: [
              "electronic components distributor directory North America Europe Asia Pacific",
              "electronics distributor association member directory North America",
              "electronic component distributors Europe Asia Pacific directory"
            ]
          },
          {
            id: "b2b_trade_show_sources",
            title: "B2B and trade show source expansion",
            priority: "high",
            querySeeds: [
              "electronic components distributor trade show exhibitor list",
              "electronics components B2B supplier directory distributor",
              "electronic component importer customs data distributor"
            ]
          },
          {
            id: "dedupe_sampling",
            title: "Deduplication and sample verification",
            priority: "medium",
            querySeeds: ["electronics distributor company database deduplication sample verification"]
          }
        ],
        assumptions: [{ text: "Public web sources can build a funnel, but precise buyer status requires sampling or paid data." }]
      },
      budget
    );
  }

  if (taskKind === "sales_strategy") {
    return normalizeResearchFrame(
      {
        taskKind,
        userGoal: prompt,
        deliverable: "Low-cost channel plan with risk controls",
        hardConstraints: [
          { id: "seller_status", label: "new seller no transaction history Hong Kong", core: true },
          { id: "channel_fit", label: "EOL surplus electronic components sales channel fit", core: true },
          { id: "platform_cost", label: "low-cost platform access and fees", core: true },
          { id: "transaction_risk", label: "escrow payment buyer trust and fraud risk", core: true },
          { id: "cold_start_path", label: "cold-start phased sales path" }
        ],
        exclusionRules: [
          { id: "requires_history", label: "channel requires strong trading history" },
          { id: "high_upfront_cost", label: "channel has high upfront listing or membership cost" }
        ],
        initialAngles: [
          {
            id: "eol_channel_fit",
            title: "EOL component channel fit",
            priority: "high",
            querySeeds: [
              "Hong Kong EOL surplus electronic components marketplace new seller escrow",
              "sell excess electronic components inventory Hong Kong low cost channel",
              "EOL obsolete electronic components marketplace seller requirements"
            ]
          },
          {
            id: "risk_and_fees",
            title: "Transaction risk and platform cost",
            priority: "high",
            querySeeds: [
              "electronic components marketplace escrow payment seller fees",
              "new seller electronic components marketplace no trading history"
            ]
          }
        ],
        assumptions: [{ text: "A cold-start seller should prioritize low-friction channels and risk-controlled transactions before scale." }]
      },
      budget
    );
  }

  if (taskKind === "data_workflow_design") {
    return normalizeResearchFrame(
      {
        taskKind,
        userGoal: prompt,
        deliverable: "Ordered HS8542 customs-data workflow with evidence boundaries",
        hardConstraints: [
          { id: "data_cleaning", label: "HS8542 customs data cleaning", core: true },
          { id: "entity_resolution", label: "importer exporter entity resolution and merge", core: true },
          { id: "peer_detection", label: "peer or competitor detection from trade patterns", core: true },
          { id: "customer_tiering", label: "customer segmentation and tiering", core: true },
          { id: "storage_architecture", label: "storage schema and workflow architecture" },
          { id: "external_verification_boundary", label: "EOL HTF cannot be inferred from HS code alone and needs external verification", core: true }
        ],
        softPreferences: [{ id: "ordered_gates", label: "ordered gates and next-step execution sequence" }],
        initialAngles: [
          {
            id: "hs8542_workflow",
            title: "HS8542 data workflow",
            priority: "high",
            querySeeds: [
              "HS8542 customs data cleaning entity resolution customer segmentation",
              "HS8542 import data peer detection customer tiering workflow",
              "customs data entity matching importer exporter storage schema"
            ]
          },
          {
            id: "eol_htf_boundary",
            title: "EOL HTF external verification boundary",
            priority: "high",
            querySeeds: [
              "HS code cannot determine EOL HTF electronic components external verification",
              "electronic components EOL HTF verification beyond customs HS code"
            ]
          }
        ],
        assumptions: [{ text: "HS code data supports trade-flow segmentation, not standalone EOL/HTF classification." }]
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
  if (/考试|license|许可|exam/.test(lower)) {
    return "find_website";
  }
  if (/ceo|founder|公司|company|person|人/.test(lower)) {
    return "find_person_company";
  }
  if (/website|网站/.test(lower)) {
    return "find_website";
  }
  return "general_research";
}

function promptToEnglishFallback(prompt: string): string {
  const stripped = prompt.replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ").replace(/\s+/g, " ").trim();
  return stripped || "public evidence research";
}

function extractNamedSubject(prompt: string): string | null {
  const ofMatch = prompt.match(/\b(?:of|for|about)\s+([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3})/);
  if (ofMatch?.[1]) {
    return cleanNamedSubject(ofMatch[1]);
  }

  const candidates = prompt.match(/\b[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,2}\b/g) ?? [];
  for (const candidate of candidates) {
    const cleaned = cleanNamedSubject(candidate);
    if (cleaned) {
      return cleaned;
    }
  }
  return null;
}

function cleanNamedSubject(value: string): string | null {
  const cleaned = value.replace(/[^\w&.\-\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || NAMED_SUBJECT_STOPWORDS.has(cleaned.toLowerCase())) {
    return null;
  }
  const words = cleaned.split(/\s+/).filter((word) => !NAMED_SUBJECT_STOPWORDS.has(word.toLowerCase()));
  const subject = words.join(" ").trim();
  return subject || null;
}

const NAMED_SUBJECT_STOPWORDS = new Set([
  "ai",
  "ceo",
  "english",
  "find",
  "official",
  "qa",
  "smoke",
  "test",
  "use",
  "website"
]);
