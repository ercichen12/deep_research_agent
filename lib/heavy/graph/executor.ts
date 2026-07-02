import { createHash } from "node:crypto";
import { saveSearchBatchArtifact, saveSourceArtifact, type HeavyStorageOptions } from "@/lib/heavy/storage";
import type { HeavySearchProvider, HeavySearchResult, HeavySource, SearchAttemptLog } from "@/lib/heavy/types";
import { summarizeSearchBatch } from "@/lib/heavy/graph/source-classification";
import type {
  ResearchState,
  SearchBatchArtifact,
  SearchBatchSummary,
  SearchWebAction,
  SourceArtifact,
  SourceSummary
} from "@/lib/heavy/graph/types";

export type GraphSearchExecution = {
  batch: SearchBatchSummary;
  artifact: SearchBatchArtifact;
  sources: Array<{ summary: SourceSummary; artifact: SourceArtifact; fullText: string; snippet: string }>;
};

export async function executeSearchAction(input: {
  state: ResearchState;
  action: SearchWebAction;
  provider: HeavySearchProvider;
  storage: HeavyStorageOptions;
}): Promise<GraphSearchExecution> {
  const providerCalls: SearchBatchArtifact["providerCalls"] = [];
  const allResults: HeavySearchResult[] = [];

  for (const query of input.action.queries) {
    const results = await input.provider.search(query, input.action.maxResults).catch(() => []);
    allResults.push(...results);
    const logs = input.provider.drainSearchLogs?.() ?? [];
    if (logs.length) {
      providerCalls.push(...logs.map(toProviderCall));
    } else {
      providerCalls.push({
        provider: "web",
        engine: "bing",
        query,
        status: results.length ? "done" : "empty",
        durationMs: 0,
        results
      });
    }
  }

  const dedupedResults = dedupeResults(allResults);
  const artifact: SearchBatchArtifact = {
    id: createBatchId(input.state.turnId, input.state.cycleIndex + 1, input.action.id, input.action.queries),
    inquiryId: input.state.inquiryId,
    turnId: input.state.turnId,
    actionId: input.action.id,
    cycle: input.state.cycleIndex + 1,
    queries: input.action.queries,
    providerCalls,
    dedupedResults,
    createdAt: new Date().toISOString()
  };
  await saveSearchBatchArtifact(artifact, input.storage);

  const batch = summarizeSearchBatch({
    id: artifact.id,
    actionId: input.action.id,
    cycle: artifact.cycle,
    queries: input.action.queries,
    providerCalls,
    expectedSignals: input.action.expectedSignals,
    candidateAliases: input.state.candidatePool.flatMap((candidate) => [candidate.name, ...candidate.aliases])
  });

  const selectedResults = dedupedResults.slice(0, input.state.budgets.maxSourcesToReadPerCycle);
  const sources = [];
  for (const result of selectedResults) {
    const read = await input.provider.read(result).catch(() => null);
    const source = read ?? fallbackSource(result);
    const fullText = source.fullText ?? source.snippet ?? result.snippet ?? "";
    const sourceHash = sourceHashFor(source.url);
    const artifact: SourceArtifact = {
      sourceHash,
      inquiryId: input.state.inquiryId,
      turnId: input.state.turnId,
      title: source.title,
      url: source.url,
      provider: source.provider,
      ...(source.engine ? { engine: String(source.engine) } : {}),
      status: fullText ? "read" : "snippet_only",
      readCharCount: source.readCharCount ?? fullText.length,
      fullText,
      createdAt: new Date().toISOString()
    };
    await saveSourceArtifact(artifact, input.storage);
    sources.push({
      summary: {
        sourceHash,
        title: artifact.title,
        url: artifact.url,
        provider: artifact.provider,
        ...(artifact.engine ? { engine: artifact.engine } : {}),
        status: artifact.status,
        readCharCount: artifact.readCharCount,
        evidenceIds: []
      },
      artifact,
      fullText,
      snippet: source.snippet ?? result.snippet ?? ""
    });
  }

  input.provider.drainReadLogs?.();

  return { batch, artifact, sources };
}

function toProviderCall(log: SearchAttemptLog): SearchBatchArtifact["providerCalls"][number] {
  return {
    provider: log.provider === "relay" || log.provider === "opencli" ? log.provider : "web",
    engine: log.engine,
    query: log.query,
    status: log.status,
    durationMs: log.durationMs ?? 0,
    results: log.results,
    ...(log.message ? { message: log.message } : {})
  };
}

function fallbackSource(result: HeavySearchResult): HeavySource {
  return {
    ...result,
    snippet: result.snippet ?? "",
    fullText: result.snippet ?? "",
    readCharCount: result.snippet?.length ?? 0
  };
}

function dedupeResults(results: HeavySearchResult[]): HeavySearchResult[] {
  const seen = new Set<string>();
  const deduped = [];
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

function createBatchId(turnId: string, cycle: number, actionId: string, queries: string[]): string {
  return `batch_${turnId}_${cycle}_${actionId}_${hash(queries.join("\n"), 12)}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function sourceHashFor(url: string): string {
  return hash(normalizeUrl(url), 32);
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return value.trim();
  }
}

function hash(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}
