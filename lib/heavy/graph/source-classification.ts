import type { HeavySearchResult } from "@/lib/heavy/types";
import type { EvidenceSourceType, SearchBatchSummary } from "@/lib/heavy/graph/types";

type EvidenceSourceInput = {
  url: string;
  title?: string;
  candidateDomains?: string[];
  hasFullText?: boolean;
  fullText?: string;
};

type SearchProviderCall = {
  provider: "relay" | "opencli" | "web" | string;
  engine?: "google" | "brave" | "duckduckgo" | "bing" | "relay" | string;
  query: string;
  status: "done" | "empty" | "error" | "timeout";
  durationMs: number;
  results: HeavySearchResult[];
  message?: string;
};

type SummarizeSearchBatchInput = {
  id: string;
  actionId: string;
  cycle: number;
  queries: string[];
  expectedSignals?: string[];
  candidateAliases?: string[];
  providerCalls: SearchProviderCall[];
};

export function classifyEvidenceSource(input: EvidenceSourceInput): EvidenceSourceType {
  const title = normalizeText(input.title ?? "");
  const hostname = hostnameOf(input.url);
  const path = pathOf(input.url);
  const candidateDomains = (input.candidateDomains ?? []).map(normalizeDomain).filter(Boolean);

  if (input.hasFullText === false) {
    return "snippet";
  }

  if (candidateDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    return "official";
  }

  if (
    title.includes("official") ||
    title.includes("about page") ||
    path.includes("/about") ||
    path.includes("/team") ||
    path.includes("/company")
  ) {
    return "official";
  }

  if (
    hostname.includes("linkedin.com") ||
    hostname.includes("crunchbase.com") ||
    hostname.includes("angel.co") ||
    hostname.includes("wellfound.com") ||
    path.includes("/in/")
  ) {
    return "profile";
  }

  if (
    title.includes("database") ||
    title.includes("customs data") ||
    title.includes("import database") ||
    path.includes("database") ||
    path.includes("customs-data")
  ) {
    return "database";
  }

  if (
    title.includes("directory") ||
    title.includes("ranking") ||
    title.includes("rankings") ||
    hostname.includes("directory") ||
    path.includes("directory") ||
    path.includes("rankings")
  ) {
    return "directory";
  }

  if (hostname.includes("x.com") || hostname.includes("twitter.com") || hostname.includes("facebook.com") || hostname.includes("instagram.com")) {
    return "social";
  }

  if (hostname.includes("reddit.com") || hostname.includes("forum") || hostname.includes("quora.com")) {
    return "forum";
  }

  if (
    hostname.includes("news") ||
    hostname.includes("forbes.com") ||
    hostname.includes("techcrunch.com") ||
    hostname.includes("business") ||
    title.includes("news") ||
    title.includes("interview")
  ) {
    return "news";
  }

  return "other";
}

export function findExpectedSignalHits(expectedSignals: string[], texts: string[]): string[] {
  const haystack = normalizeSignalText(texts.join(" "));
  const hits: string[] = [];

  for (const signal of expectedSignals) {
    const normalizedSignal = normalizeSignalText(signal);
    if (normalizedSignal && haystack.includes(normalizedSignal) && !hits.includes(signal)) {
      hits.push(signal);
    }
  }

  return hits;
}

export function summarizeSearchBatch(input: SummarizeSearchBatchInput): SearchBatchSummary {
  const dedupedResults = dedupeResults(input.providerCalls.flatMap((call) => call.results ?? []));
  const textCorpus = [
    ...input.queries,
    ...dedupedResults.flatMap((result) => [result.title, result.snippet ?? "", result.url])
  ];
  const expectedSignalHits = findExpectedSignalHits(input.expectedSignals ?? [], textCorpus);
  const candidateMentions = findExpectedSignalHits(input.candidateAliases ?? [], textCorpus);
  const uniqueDomainCount = new Set(dedupedResults.map((result) => hostnameOf(result.url)).filter(Boolean)).size;
  const officialOrPrimaryCount = dedupedResults.filter((result) => classifyEvidenceSource({ url: result.url, title: result.title }) === "official").length;
  const doneResultCount = dedupedResults.length;

  return {
    id: input.id,
    actionId: input.actionId,
    cycle: input.cycle,
    queries: input.queries,
    queryCount: input.queries.length,
    providerCalls: input.providerCalls.map((call, index) => ({
      provider: normalizeSummaryProvider(call.provider),
      ...(normalizeSummaryEngine(call.engine) ? { engine: normalizeSummaryEngine(call.engine) } : {}),
      query: call.query,
      status: call.status,
      resultCount: call.results?.length ?? 0,
      durationMs: call.durationMs,
      artifactId: `${input.id}_call_${index + 1}`,
      ...(call.message ? { message: call.message } : {})
    })),
    dedupedResultCount: doneResultCount,
    uniqueDomainCount,
    expectedSignalHits,
    officialOrPrimaryCount,
    candidateMentions,
    quality: classifySearchQuality({
      doneResultCount,
      uniqueDomainCount,
      expectedSignalHitCount: expectedSignalHits.length,
      candidateMentionCount: candidateMentions.length,
      officialOrPrimaryCount
    })
  };
}

function classifySearchQuality(input: {
  doneResultCount: number;
  uniqueDomainCount: number;
  expectedSignalHitCount: number;
  candidateMentionCount: number;
  officialOrPrimaryCount: number;
}): SearchBatchSummary["quality"] {
  if (input.doneResultCount === 0) {
    return "empty";
  }

  if (
    input.doneResultCount >= 8 &&
    input.uniqueDomainCount >= 5 &&
    (input.expectedSignalHitCount >= 2 || input.candidateMentionCount >= 2) &&
    input.officialOrPrimaryCount >= 1
  ) {
    return "strong";
  }

  if (input.doneResultCount >= 3 || input.uniqueDomainCount >= 3 || input.expectedSignalHitCount >= 2 || input.officialOrPrimaryCount >= 1) {
    return "mixed";
  }

  return "weak";
}

function dedupeResults(results: HeavySearchResult[]): HeavySearchResult[] {
  const seen = new Set<string>();
  const deduped: HeavySearchResult[] = [];

  for (const result of results) {
    const key = normalizeUrl(result.url);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

function hostnameOf(value: string): string {
  try {
    return normalizeDomain(new URL(value).hostname);
  } catch {
    return "";
  }
}

function pathOf(value: string): string {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeDomain(value: string): string {
  return value.toLowerCase().replace(/^www\./, "").trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeSignalText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizeSummaryProvider(value: string): SearchBatchSummary["providerCalls"][number]["provider"] {
  return value === "relay" || value === "web" ? value : "opencli";
}

function normalizeSummaryEngine(value: string | undefined): SearchBatchSummary["providerCalls"][number]["engine"] | undefined {
  return value === "google" || value === "brave" || value === "duckduckgo" || value === "bing" || value === "relay" ? value : undefined;
}
