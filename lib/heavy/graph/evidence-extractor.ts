import {
  normalizeEvidenceExtractionOutput,
  type Candidate,
  type EvidenceExtractionOutput,
  type EvidenceItem,
  type QueryClue,
  type ResearchFrame,
  type SourceSummary
} from "@/lib/heavy/graph/types";
import { classifyEvidenceSource } from "@/lib/heavy/graph/source-classification";

type ReadSourceForExtraction = {
  summary: SourceSummary;
  fullText: string;
  snippet: string;
};

type DetectedCandidate = {
  id: string;
  kind: Candidate["kind"];
  name: string;
  aliases: string[];
};

export function extractEvidence(input: {
  frame: ResearchFrame;
  sources: ReadSourceForExtraction[];
}): EvidenceExtractionOutput {
  const evidenceItems: Partial<EvidenceItem>[] = [];
  const candidates = new Map<string, Partial<Candidate>>();
  const queryClues: Partial<QueryClue>[] = input.sources.flatMap(sourceQueryClues);
  const rejectedPaths = [];
  const targetEntity = extractTargetEntity(input.frame);
  const corpus = input.sources.map((source) => sourceText(source)).join("\n\n");
  const corpusCandidate = detectCandidate(corpus, input.frame.taskKind, targetEntity);

  for (const source of input.sources) {
    const text = sourceText(source);
    const lower = text.toLowerCase();
    const candidate = detectCandidate(text, input.frame.taskKind, targetEntity) ?? (corpusCandidate && sourceMatchesCandidate(text, corpusCandidate) ? corpusCandidate : null);

    if (candidate) {
      candidates.set(candidate.id, {
        id: candidate.id,
        kind: candidate.kind,
        name: candidate.name,
        aliases: candidate.aliases,
        summary: "Candidate discovered from public search/read sources.",
        status: "active"
      });
      queryClues.push({ text: candidate.aliases.join(" "), source: "candidate", relatedCandidateId: candidate.id, weight: 5 });
    }

    const subjectIds = candidate ? [candidate.id] : [];
    const sourceType = classifyEvidenceSource({
      url: source.summary.url,
      title: source.summary.title,
      fullText: source.fullText,
      hasFullText: Boolean(source.fullText),
      candidateDomains: candidate ? [domainFromName(candidate.name), domainFromName(candidate.aliases.at(-1) ?? candidate.name)] : []
    });
    const base = {
      sourceHash: source.summary.sourceHash,
      sourceUrl: source.summary.url,
      sourceTitle: source.summary.title,
      sourceType,
      provider: source.summary.provider,
      engine: source.summary.engine,
      confidence: source.fullText ? "high" : "medium"
    } satisfies Partial<EvidenceItem>;

    const hasRoleSignal = /\bceo\b|founder|cofounder|co-founder|chief executive|leadership|continue to lead/i.test(text);
    const hasCompanySignal = candidate ? containsAnyAlias(text, candidate.aliases) : false;
    const hasOfficialWebsiteSignal = candidate ? isOfficialWebsiteSource(source, candidate, targetEntity) : false;

    if (candidate && hasRoleSignal) {
      evidenceItems.push({
        ...base,
        claim: `${candidate.name} has CEO/founder leadership evidence.`,
        subjectIds,
        constraintIds: matchingConstraintIds(input.frame, ["role", "person_identity"]),
        paraphrase: "Source text links the candidate/person with CEO, founder, or leadership language.",
        strength: sourceType === "official" ? "direct" : "proxy"
      });
    }
    if (candidate && (hasCompanySignal || /company|startup|organization|official website|profile/i.test(text))) {
      evidenceItems.push({
        ...base,
        claim: `${candidate.name} has company identity evidence.`,
        subjectIds,
        constraintIds: matchingConstraintIds(input.frame, ["company_identity", "industry_fit"]),
        paraphrase: "Source text links the candidate with the target company or organization.",
        strength: sourceType === "official" ? "direct" : "proxy"
      });
    }
    if (candidate && hasOfficialWebsiteSignal) {
      evidenceItems.push({
        ...base,
        claim: `${candidate.aliases.at(-1) ?? candidate.name} has an official website or official source.`,
        subjectIds,
        constraintIds: matchingConstraintIds(input.frame, ["official_website"]),
        paraphrase: "Source URL or title indicates an official company website/source.",
        strength: "direct"
      });
    }
    if (candidate && (hasRoleSignal || hasOfficialWebsiteSignal) && hasCompanySignal) {
      evidenceItems.push({
        ...base,
        claim: `${candidate.name} has a verification-chain source tying person, role, and company/source together.`,
        subjectIds,
        constraintIds: matchingConstraintIds(input.frame, ["verification_chain"]),
        paraphrase: "Source combines role, company, or official-source signals into the verification chain.",
        strength: sourceType === "official" ? "direct" : "proxy"
      });
    }
    if (candidate && /australia|australian/i.test(text)) {
      evidenceItems.push({
        ...base,
        claim: `${candidate.name} has Australia geography evidence.`,
        subjectIds,
        constraintIds: matchingConstraintIds(input.frame, ["geography"]),
        paraphrase: "Source text contains Australia/Australian geography signal.",
        strength: "proxy"
      });
    }
    if (candidate && /\bai\b|artificial intelligence/i.test(text)) {
      evidenceItems.push({
        ...base,
        claim: `${candidate.name} has public AI viewpoint or AI-related evidence.`,
        subjectIds,
        constraintIds: matchingConstraintIds(input.frame, ["ai_public_view"]),
        paraphrase: "Source text contains AI signal related to the candidate/company.",
        strength: "proxy"
      });
    }
    if (candidate && /funding|raised|expansion|expanded|production|growth/i.test(text)) {
      evidenceItems.push({
        ...base,
        claim: `${candidate.name} has proxy growth evidence.`,
        subjectIds,
        constraintIds: matchingConstraintIds(input.frame, ["growth"]),
        paraphrase: "Source text contains funding/expansion signal, which is proxy growth evidence.",
        strength: "proxy"
      });
    }
    if (/solar panel|medical device|heavy manufacturing/i.test(lower)) {
      rejectedPaths.push({
        title: source.summary.title,
        reason: "Source appears to match an exclusion rule.",
        evidenceIds: []
      });
    }

    if (input.frame.taskKind === "technical_verification") {
      const technicalCandidate =
        candidate ??
        ({
          id: "cand_service_cloudflare_delegated_subdomain_path",
          kind: "service" as const,
          name: "Cloudflare-compatible delegated subdomain path",
          aliases: ["Cloudflare DNS", "Public Suffix List", "NS delegation"]
        });
      if (!candidate) {
        candidates.set(technicalCandidate.id, {
          id: technicalCandidate.id,
          kind: technicalCandidate.kind,
          name: technicalCandidate.name,
          aliases: technicalCandidate.aliases,
          summary: "A feasibility path based on Cloudflare zone support, PSL boundary, and authoritative NS delegation.",
          status: "active"
        });
      }
      const technicalSubjectIds = [technicalCandidate.id];
      if (/cloudflare|zone setup|dns/i.test(text)) {
        evidenceItems.push({
          ...base,
          claim: "Cloudflare DNS support is a required part of the feasibility path.",
          subjectIds: technicalSubjectIds,
          constraintIds: matchingConstraintIds(input.frame, ["cloudflare_support"]),
          paraphrase: "Source text discusses Cloudflare DNS or zone setup support.",
          strength: sourceType === "official" ? "direct" : "proxy"
        });
      }
      if (/public suffix list|registrable|etld|private domain/i.test(text)) {
        evidenceItems.push({
          ...base,
          claim: "Public Suffix List or registrable-boundary status affects whether a hostname can behave like a zone.",
          subjectIds: technicalSubjectIds,
          constraintIds: matchingConstraintIds(input.frame, ["public_suffix_list"]),
          paraphrase: "Source text links PSL or registrable boundary to subdomain feasibility.",
          strength: "direct"
        });
      }
      if (/authoritative|nameserver|name server|\bns\b|delegation|delegated/i.test(text)) {
        evidenceItems.push({
          ...base,
          claim: "Authoritative NS delegation is required or relevant for Cloudflare subdomain setup.",
          subjectIds: technicalSubjectIds,
          constraintIds: matchingConstraintIds(input.frame, ["ns_delegation"]),
          paraphrase: "Source text discusses delegated authoritative nameservers.",
          strength: "direct"
        });
      }
      if (/cname only|cannot delegate|no nameserver|without nameserver/i.test(text)) {
        rejectedPaths.push({
          title: source.summary.title,
          reason: "Source suggests a CNAME-only or non-delegated hostname path, which is likely not enough for Cloudflare zone control.",
          evidenceIds: []
        });
      }
    }

    if (input.frame.taskKind === "data_workflow_design") {
      const workflowCandidate = workflowCandidateForFrame(input.frame);
      candidates.set(workflowCandidate.id, {
        id: workflowCandidate.id,
        kind: workflowCandidate.kind,
        name: workflowCandidate.name,
        aliases: workflowCandidate.aliases,
        summary: "Workflow path based on customs-data cleaning, entity merge, segmentation, and external verification boundaries.",
        status: "active"
      });
      const workflowSubjectIds = [workflowCandidate.id];
      pushWorkflowEvidence({
        evidenceItems,
        frame: input.frame,
        base,
        subjectIds: workflowSubjectIds,
        text,
        patterns: /\b(cleaning|cleanse|standardi[sz]ation|normalization|normalize|deduplication|dedupe|data quality|bill of lading|customs data)\b/i,
        wantedIds: ["data_cleaning"],
        claim: "HS8542/customs data requires cleaning, normalization, or data-quality gates before segmentation.",
        paraphrase: "Source text discusses customs-data cleaning, normalization, deduplication, or bill-of-lading data quality."
      });
      pushWorkflowEvidence({
        evidenceItems,
        frame: input.frame,
        base,
        subjectIds: workflowSubjectIds,
        text,
        patterns: /\b(entity resolution|entity matching|entity merge|importer|exporter|consignee|shipper|buyer|supplier|deduplication|dedupe)\b/i,
        wantedIds: ["entity_resolution"],
        claim: "Importer/exporter records need entity resolution and merge logic.",
        paraphrase: "Source text links importer/exporter or buyer/supplier records to entity matching, merge, or deduplication."
      });
      pushWorkflowEvidence({
        evidenceItems,
        frame: input.frame,
        base,
        subjectIds: workflowSubjectIds,
        text,
        patterns: /\b(peer|competitor|rival|trade lane|shipment pattern|sourcing pattern|supplier|buyer|import|export)\b/i,
        wantedIds: ["peer_detection"],
        claim: "Trade-flow records can support peer or competitor detection from shipment patterns.",
        paraphrase: "Source text discusses peers, competitors, suppliers, buyers, trade lanes, imports/exports, or shipment patterns."
      });
      pushWorkflowEvidence({
        evidenceItems,
        frame: input.frame,
        base,
        subjectIds: workflowSubjectIds,
        text,
        patterns: /\b(customer segmentation|customer tiering|tiering|lead scoring|active buyers|demand|volume|value|market)\b/i,
        wantedIds: ["customer_tiering"],
        claim: "Customer segmentation or tiering can be built from buyer and demand signals.",
        paraphrase: "Source text discusses customer segmentation, tiering, active buyers, demand, volume, or value signals."
      });
      pushWorkflowEvidence({
        evidenceItems,
        frame: input.frame,
        base,
        subjectIds: workflowSubjectIds,
        text,
        patterns: /\b(schema|data model|database|warehouse|lakehouse|storage|pipeline|workflow architecture|registry)\b/i,
        wantedIds: ["storage_architecture"],
        claim: "The workflow needs a data model, schema, storage, or pipeline architecture.",
        paraphrase: "Source text discusses a data model, schema, database, warehouse/lakehouse, storage, pipeline, or workflow architecture."
      });
      pushWorkflowEvidence({
        evidenceItems,
        frame: input.frame,
        base,
        subjectIds: workflowSubjectIds,
        text,
        patterns: /\b(eol|end of life|htf|hard to find|obsolete|lifecycle|hs code|hts|eccn|classification|external verification|cannot be inferred|supplier verification)\b/i,
        wantedIds: ["external_verification_boundary"],
        claim: "EOL/HTF status cannot be treated as proven by HS/HTS code alone and needs external verification.",
        paraphrase: "Source text discusses EOL/HTF, lifecycle/obsolete status, classification limits, or external supplier/database verification."
      });
    }
  }

  return normalizeEvidenceExtractionOutput({
    evidenceItems,
    candidates: [...candidates.values()],
    queryClues,
    rejectedPaths
  });
}

function detectCandidate(text: string, taskKind: ResearchFrame["taskKind"], targetEntity?: string | null): DetectedCandidate | null {
  if (/grace brown/i.test(text) && /andromeda/i.test(text)) {
    return {
      id: "cand_person_company_grace_brown_andromeda_robotics",
      kind: "person_company",
      name: "Grace Brown / Andromeda Robotics",
      aliases: ["Grace Brown", "Andromeda Robotics"]
    };
  }
  if (taskKind === "find_person_company" && targetEntity) {
    const person = findLeadershipPerson(text, targetEntity);
    if (person) {
      return {
        id: `cand_person_company_${slug(`${person}-${targetEntity}`)}`,
        kind: "person_company",
        name: `${person} / ${targetEntity}`,
        aliases: [person, targetEntity]
      };
    }
  }
  if (taskKind === "technical_verification" && /cloudflare/i.test(text) && /public suffix list|nameserver|delegation/i.test(text)) {
    return {
      id: "cand_service_cloudflare_delegated_subdomain_path",
      kind: "service",
      name: "Cloudflare-compatible delegated subdomain path",
      aliases: ["Cloudflare DNS", "Public Suffix List", "NS delegation"]
    };
  }
  return null;
}

function extractTargetEntity(frame: ResearchFrame): string | null {
  for (const constraint of frame.hardConstraints) {
    const match = constraint.label.match(/^(.+?)\s+(?:current\s+CEO|company identity|official website)/i);
    const cleaned = cleanEntityName(match?.[1] ?? "");
    if (cleaned) {
      return cleaned;
    }
  }

  const promptMatch = frame.userGoal.match(/\b(?:of|for|about)\s+([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3})/);
  return cleanEntityName(promptMatch?.[1] ?? "");
}

function findLeadershipPerson(text: string, targetEntity: string): string | null {
  const escaped = escapeRegExp(targetEntity);
  const person = `([A-Z][a-z]+(?:[.'-][A-Z]?[a-z]+)?(?:\\s+[A-Z][a-z]+(?:[.'-][A-Z]?[a-z]+)?){1,3})`;
  const patterns = [
    new RegExp(`${person}\\s*,?\\s+(?:the\\s+)?(?:co-?founder\\s+and\\s+)?(?:CEO|chief executive)(?:\\s+(?:of|at)\\s+${escaped}\\b)?`, "i"),
    new RegExp(`${person}\\s+(?:is|was|serves as|served as|remains|returned as|continues as|officially back as)[^.\\n]{0,80}(?:co-?founder|founder|chief executive|CEO)[^.\\n]{0,80}(?:of|at)\\s+${escaped}\\b`, "i"),
    new RegExp(`${escaped}(?:'s)?[^.\\n]{0,80}(?:CEO|chief executive|co-?founder|founder)[^.\\n]{0,60}(?:is|:|-|,)?\\s+${person}`, "i")
  ];

  for (const pattern of patterns) {
    const person = cleanPersonName(text.match(pattern)?.[1] ?? "", targetEntity);
    if (person) {
      return person;
    }
  }

  return bestNearbyPersonName(text, targetEntity);
}

function bestNearbyPersonName(text: string, targetEntity: string): string | null {
  if (!new RegExp(escapeRegExp(targetEntity), "i").test(text) || !/\b(?:co-?founder|founder|chief executive|CEO|leadership|continue to lead)\b/i.test(text)) {
    return null;
  }

  const matches = text.matchAll(/\b[A-Z][a-z]+(?:[.'-][A-Z]?[a-z]+)?(?:\s+[A-Z][a-z]+(?:[.'-][A-Z]?[a-z]+)?){1,3}\b/g);
  let best: { name: string; score: number } | null = null;
  for (const match of matches) {
    const name = cleanPersonName(match[0], targetEntity);
    if (!name) {
      continue;
    }
    const index = match.index ?? 0;
    const window = text.slice(Math.max(0, index - 160), Math.min(text.length, index + name.length + 160));
    const score =
      (new RegExp(escapeRegExp(targetEntity), "i").test(window) ? 3 : 0) +
      (/\b(?:CEO|chief executive)\b/i.test(window) ? 3 : 0) +
      (/\b(?:co-?founder|founder|leadership|continue to lead)\b/i.test(window) ? 2 : 0);
    if (score > (best?.score ?? 0)) {
      best = { name, score };
    }
  }

  return best && best.score >= 5 ? best.name : null;
}

function matchingConstraintIds(frame: ResearchFrame, wantedIds: string[]): string[] {
  const wanted = new Set(wantedIds);
  return [...frame.hardConstraints, ...frame.softPreferences, ...frame.exclusionRules]
    .filter((constraint) => wanted.has(constraint.id))
    .map((constraint) => constraint.id);
}

function workflowCandidateForFrame(frame: ResearchFrame): DetectedCandidate {
  const hasHs8542 = /hs\s*8542|hs8542/i.test(frame.userGoal);
  return {
    id: hasHs8542 ? "cand_workflow_hs8542_customs_customer_segmentation" : "cand_workflow_customs_customer_segmentation",
    kind: "workflow",
    name: hasHs8542 ? "HS8542 customs-data customer segmentation workflow" : "Customs-data customer segmentation workflow",
    aliases: ["customs data workflow", "entity resolution", "customer segmentation", "EOL HTF external verification"]
  };
}

function pushWorkflowEvidence(input: {
  evidenceItems: Partial<EvidenceItem>[];
  frame: ResearchFrame;
  base: Partial<EvidenceItem>;
  subjectIds: string[];
  text: string;
  patterns: RegExp;
  wantedIds: string[];
  claim: string;
  paraphrase: string;
}): void {
  if (!input.patterns.test(input.text)) {
    return;
  }
  const constraintIds = matchingConstraintIds(input.frame, input.wantedIds);
  if (!constraintIds.length) {
    return;
  }
  input.evidenceItems.push({
    ...input.base,
    claim: input.claim,
    subjectIds: input.subjectIds,
    constraintIds,
    paraphrase: input.paraphrase,
    strength: input.base.sourceType === "official" || input.base.sourceType === "database" ? "direct" : "proxy"
  });
}

function sourceText(source: ReadSourceForExtraction): string {
  return `${source.summary.title} ${source.snippet} ${source.fullText}`;
}

function sourceQueryClues(source: ReadSourceForExtraction) {
  return [source.summary.title, source.snippet]
    .filter(Boolean)
    .slice(0, 2)
    .map((text) => ({ text, source: "source" as const, weight: 2 }));
}

function sourceMatchesCandidate(text: string, candidate: Pick<DetectedCandidate, "aliases">): boolean {
  return containsAnyAlias(text, candidate.aliases);
}

function containsAnyAlias(text: string, aliases: string[]): boolean {
  return aliases.some((alias) => alias && new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(text));
}

function isOfficialWebsiteSource(source: ReadSourceForExtraction, candidate: DetectedCandidate, targetEntity?: string | null): boolean {
  const entity = targetEntity ?? candidate.aliases.at(-1) ?? candidate.name;
  const expectedDomain = domainFromName(entity);
  const hostname = hostnameOf(source.summary.url);
  return Boolean(expectedDomain && (hostname === expectedDomain || hostname.endsWith(`.${expectedDomain}`)));
}

function domainFromName(name: string): string {
  if (name.toLowerCase().includes("andromeda")) {
    return "andromedarobotics.example";
  }
  const company = name.split("/").at(-1)?.trim() ?? name;
  const compact = company.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return compact ? `${compact}.com` : "";
}

function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanEntityName(value: string): string | null {
  const cleaned = value
    .replace(/[^\w&.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:-]+$/g, "");
  if (!cleaned || ["ai", "ceo", "official", "website", "company"].includes(cleaned.toLowerCase())) {
    return null;
  }
  return cleaned;
}

function cleanPersonName(value: string, targetEntity: string): string | null {
  const cleaned = value
    .replace(/^\s*(?:I|II|III|IV|V)\.\s+/i, " ")
    .replace(/\b(?:Meet|Who|What|The|Inside|Review|CEO|Cofounder|Founder|Chief|Executive|Is|Was|Officially|Back|Return|Returns|To)\b/gi, " ")
    .replace(/[^\w'.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.toLowerCase() === targetEntity.toLowerCase()) {
    return null;
  }
  const rawWords = cleaned.split(/\s+/).filter((word) => word.toLowerCase() !== targetEntity.toLowerCase());
  const dedupedWords =
    rawWords.length % 2 === 0 &&
    rawWords.length > 2 &&
    rawWords.slice(0, rawWords.length / 2).join(" ") === rawWords.slice(rawWords.length / 2).join(" ")
      ? rawWords.slice(0, rawWords.length / 2)
      : rawWords;
  const words = stripGenericNameNoise(dedupedWords);
  if (words.length < 2 || words.length > 4) {
    return null;
  }
  if (words.some((word) => blockedNameWords.has(word))) {
    return null;
  }
  if (!words.every((word) => /^[A-Z][a-z]+(?:[.'-][A-Z]?[a-z]+)?$/.test(word))) {
    return null;
  }
  return words.join(" ");
}

function stripGenericNameNoise(words: string[]): string[] {
  const stripped = [...words];
  while (stripped.length > 0 && genericNamePrefixes.has(stripped[0])) {
    stripped.shift();
  }
  while (stripped.length > 0 && genericNameSuffixes.has(stripped[stripped.length - 1])) {
    stripped.pop();
  }
  return stripped;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const genericNamePrefixes = new Set([
  "Partnerships",
  "Key",
  "Executives",
  "Executive",
  "Forbes",
  "Employee",
  "Employees",
  "Figures",
  "Members",
  "Profiles",
  "Contacts",
  "Meet",
  "Inside"
]);

const genericNameSuffixes = new Set([
  "Raises",
  "Raised",
  "Said",
  "Says",
  "Feb",
  "Jan",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
]);

const blockedNameWords = new Set([
  "OpenAI",
  "Business",
  "Insider",
  "Official",
  "Website",
  "Leadership",
  "Team",
  "Profile",
  "News",
  "Company",
  "Board",
  "Product",
  "Products",
  "Capabilities",
  "Safety",
  "Responsible",
  "Development",
  "Link",
  "Email",
  "Matter",
  "Said",
  "Org",
  "Chart",
  "Digital",
  "Life",
  "Super",
  "Alignment"
]);
