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

  return sourceTypeWeight(sourceType) + signalHits * 10 + candidateHits * 14 + Math.min(result.snippet?.length ?? 0, 240) / 80;
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
