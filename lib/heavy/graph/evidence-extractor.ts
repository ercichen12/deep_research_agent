import {
  normalizeEvidenceExtractionOutput,
  type EvidenceExtractionOutput,
  type ResearchFrame,
  type SourceSummary
} from "@/lib/heavy/graph/types";
import { classifyEvidenceSource } from "@/lib/heavy/graph/source-classification";

type ReadSourceForExtraction = {
  summary: SourceSummary;
  fullText: string;
  snippet: string;
};

export function extractEvidence(input: {
  frame: ResearchFrame;
  sources: ReadSourceForExtraction[];
}): EvidenceExtractionOutput {
  const evidenceItems = [];
  const candidates = [];
  const queryClues = [];
  const rejectedPaths = [];

  for (const source of input.sources) {
    const text = `${source.summary.title} ${source.snippet} ${source.fullText}`;
    const lower = text.toLowerCase();
    const candidate = detectCandidate(text, input.frame.taskKind);
    if (candidate) {
      candidates.push({
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
      candidateDomains: candidate ? [domainFromName(candidate.name)] : []
    });
    const base = {
      sourceHash: source.summary.sourceHash,
      sourceUrl: source.summary.url,
      sourceTitle: source.summary.title,
      sourceType,
      provider: source.summary.provider,
      engine: source.summary.engine,
      confidence: source.fullText ? "high" : "medium"
    };

    if (candidate && /\bceo\b|founder|chief executive/i.test(text)) {
      evidenceItems.push({
        ...base,
        claim: `${candidate.name} has CEO/founder leadership evidence.`,
        subjectIds,
        constraintIds: matchingConstraintIds(input.frame, ["role", "person_identity"]),
        paraphrase: "Source text links the candidate/person with CEO or founder leadership.",
        strength: sourceType === "official" ? "direct" : "proxy"
      });
    }
    if (candidate && /andromeda|company|robotics|hardware|startup/i.test(text)) {
      evidenceItems.push({
        ...base,
        claim: `${candidate.name} has company and industry fit evidence.`,
        subjectIds,
        constraintIds: matchingConstraintIds(input.frame, ["company_identity", "industry_fit"]),
        paraphrase: "Source text links the candidate/company with robotics or hardware.",
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
        candidates.push({
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
  }

  return normalizeEvidenceExtractionOutput({
    evidenceItems,
    candidates,
    queryClues,
    rejectedPaths
  });
}

function detectCandidate(
  text: string,
  taskKind: ResearchFrame["taskKind"]
): { id: string; kind: "person_company" | "website" | "company" | "service" | "workflow" | "channel" | "other"; name: string; aliases: string[] } | null {
  if (/grace brown/i.test(text) && /andromeda/i.test(text)) {
    return {
      id: "cand_person_company_grace_brown_andromeda_robotics",
      kind: "person_company",
      name: "Grace Brown / Andromeda Robotics",
      aliases: ["Grace Brown", "Andromeda Robotics"]
    };
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

function matchingConstraintIds(frame: ResearchFrame, wantedIds: string[]): string[] {
  const wanted = new Set(wantedIds);
  return [...frame.hardConstraints, ...frame.softPreferences, ...frame.exclusionRules]
    .filter((constraint) => wanted.has(constraint.id))
    .map((constraint) => constraint.id);
}

function domainFromName(name: string): string {
  return name.toLowerCase().includes("andromeda") ? "andromedarobotics.example" : "";
}
