import type { HeavySearchResult } from "@/lib/heavy/types";
import { classifyEvidenceSource, findExpectedSignalHits } from "@/lib/heavy/graph/source-classification";

export function selectSourcesForRead(input: {
  results: HeavySearchResult[];
  expectedSignals?: string[];
  candidateAliases?: string[];
  limit: number;
}): HeavySearchResult[] {
  return [...input.results]
    .map((result, index) => ({
      result,
      index,
      score: scoreResult(result, input.expectedSignals ?? [], input.candidateAliases ?? [])
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, input.limit))
    .map((item) => item.result);
}

function scoreResult(result: HeavySearchResult, expectedSignals: string[], candidateAliases: string[]): number {
  const text = [result.title, result.snippet ?? "", result.url].join(" ");
  const sourceType = classifyEvidenceSource({
    url: result.url,
    title: result.title,
    hasFullText: Boolean(result.snippet)
  });
  const signalHits = findExpectedSignalHits(expectedSignals, [text]).length;
  const candidateHits = findExpectedSignalHits(candidateAliases, [text]).length;

  return sourceTypeWeight(sourceType) + signalHits * 10 + candidateHits * 14 + taskFitWeight(text, expectedSignals) + Math.min(result.snippet?.length ?? 0, 240) / 80;
}

function taskFitWeight(text: string, expectedSignals: string[]): number {
  const normalizedText = text.toLowerCase();
  const normalizedSignals = expectedSignals.join(" ").toLowerCase();
  if (!/hs8542|customs|importer|exporter|hs code|hts|trade data|bill of lading/.test(normalizedSignals)) {
    return 0;
  }

  let score = 0;
  for (const term of ["hs8542", "hs 8542", "customs", "importer", "exporter", "trade data", "import data", "bill of lading", "harmonized system", "hs code", "hts code"]) {
    if (normalizedText.includes(term)) {
      score += 12;
    }
  }
  for (const term of ["electronic component", "integrated circuit", "semiconductor", "lifecycle", "obsolete", "eol", "hard to find", "htf"]) {
    if (normalizedText.includes(term)) {
      score += 6;
    }
  }
  if (/(customer data platform|marketing automation|crm|customer\\.io|gartner peer insights|customer journey)/.test(normalizedText) && !/(customs|import|export|hs8542|hs code|trade data)/.test(normalizedText)) {
    score -= 45;
  }
  return score;
}

function sourceTypeWeight(sourceType: ReturnType<typeof classifyEvidenceSource>): number {
  if (sourceType === "official") {
    return 80;
  }
  if (sourceType === "profile") {
    return 64;
  }
  if (sourceType === "news" || sourceType === "database" || sourceType === "directory") {
    return 52;
  }
  if (sourceType === "social") {
    return 28;
  }
  if (sourceType === "forum") {
    return -20;
  }
  if (sourceType === "snippet") {
    return 8;
  }
  return 16;
}
