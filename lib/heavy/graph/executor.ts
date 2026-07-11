import { createHash } from "node:crypto";
import { saveSearchBatchArtifact, saveSourceArtifact, type HeavyStorageOptions } from "@/lib/heavy/storage";
import type { HeavySearchProvider, HeavySearchResult, HeavySource, SearchAttemptLog } from "@/lib/heavy/types";
import { summarizeSearchBatch } from "@/lib/heavy/graph/source-classification";
import { selectSourcesForRead } from "@/lib/heavy/graph/source-selector";
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
  selectedUrls: string[];
  sources: Array<{ summary: SourceSummary; artifact: SourceArtifact; fullText: string; snippet: string }>;
};

export type GraphSearchExecutionCallbacks = {
  onSearchBatch?: (batch: SearchBatchSummary, artifact: SearchBatchArtifact) => Promise<void>;
  onSourceSelected?: (urls: string[], batch: SearchBatchSummary) => Promise<void>;
  onSourceRead?: (
    source: { summary: SourceSummary; artifact: SourceArtifact; fullText: string; snippet: string },
    batch: SearchBatchSummary
  ) => Promise<void>;
};

export async function executeSearchAction(input: {
  state: ResearchState;
  action: SearchWebAction;
  provider: HeavySearchProvider;
  storage: HeavyStorageOptions;
  callbacks?: GraphSearchExecutionCallbacks;
}): Promise<GraphSearchExecution> {
  const providerCalls: SearchBatchArtifact["providerCalls"] = [];
  const allResults: HeavySearchResult[] = [];

  const searchExecutions = await Promise.all(
    input.action.queries.map(async (query) => {
      const provider = forkProvider(input.provider);
      const results = await provider.search(query, input.action.maxResults).catch(() => []);
      const logs = provider.drainSearchLogs?.() ?? [];
      return { query, results, logs };
    })
  );

  for (const execution of searchExecutions) {
    allResults.push(...execution.results);
    if (execution.logs.length) {
      providerCalls.push(...execution.logs.map(toProviderCall));
    } else {
      providerCalls.push(...providerCallsFromResults(execution.query, execution.results));
    }
  }

  const parentSearchLogs = input.provider.drainSearchLogs?.() ?? [];
  if (parentSearchLogs.length) {
    providerCalls.push(...parentSearchLogs.map(toProviderCall));
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
  await input.callbacks?.onSearchBatch?.(batch, artifact);

  const candidateAliases = input.state.candidatePool.flatMap((candidate) => [candidate.name, ...candidate.aliases]);
  const remainingTotalReads = Math.max(0, input.state.budgets.maxTotalSourcesToRead - input.state.budgets.sourcesRead);
  const readLimit = Math.min(effectiveReadLimit(input.state), remainingTotalReads);
  const selectedResults = selectSourcesForRead({
    results: dedupedResults,
    expectedSignals: input.action.expectedSignals,
    candidateAliases,
    limit: readLimit
  });
  const selectedUrls = selectedResults.map((result) => result.url);
  if (selectedUrls.length) {
    await input.callbacks?.onSourceSelected?.(selectedUrls, batch);
  }

  const sourceRecords = await mapWithConcurrency(selectedResults, readConcurrency(input.state), async (result) => {
    const provider = forkProvider(input.provider);
    const read = await provider.read(result).catch(() => null);
    const readLogs = provider.drainReadLogs?.() ?? [];
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
      ...(readLogs.length ? { readLogs } : {}),
      createdAt: new Date().toISOString()
    };
    await saveSourceArtifact(artifact, input.storage);
    return {
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
    };
  });

  const sources = [];
  for (const sourceRecord of sourceRecords) {
    sources.push(sourceRecord);
    await input.callbacks?.onSourceRead?.(sourceRecord, batch);
  }

  const parentReadLogs = input.provider.drainReadLogs?.() ?? [];
  if (parentReadLogs.length && sources[0]) {
    sources[0].artifact.readLogs = [...(sources[0].artifact.readLogs ?? []), ...parentReadLogs];
  }

  return { batch, artifact, selectedUrls, sources };
}

function effectiveReadLimit(state: ResearchState): number {
  const configured = state.budgets.maxSourcesToReadPerCycle;
  if (isWorkflowLikeTask(state.frame.taskKind)) {
    return Math.min(configured, 6);
  }
  return configured;
}

function readConcurrency(state: ResearchState): number {
  if (isWorkflowLikeTask(state.frame.taskKind)) {
    return 6;
  }
  return 4;
}

function forkProvider(provider: HeavySearchProvider): HeavySearchProvider {
  return provider.forkTrace?.() ?? provider;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await run(items[index], index);
      }
    })
  );

  return results;
}

function isWorkflowLikeTask(taskKind: ResearchState["frame"]["taskKind"]): boolean {
  return taskKind === "data_workflow_design" || taskKind === "sales_strategy" || taskKind === "market_list_building" || taskKind === "technical_verification";
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

function providerCallsFromResults(query: string, results: HeavySearchResult[]): SearchBatchArtifact["providerCalls"] {
  if (!results.length) {
    return [
      {
        provider: "web",
        engine: "bing",
        query,
        status: "empty",
        durationMs: 0,
        results: []
      }
    ];
  }

  const groups = new Map<string, HeavySearchResult[]>();
  for (const result of results) {
    const provider = result.provider === "relay" || result.provider === "opencli" || result.provider === "web" ? result.provider : "web";
    const engine = result.engine ? String(result.engine) : provider === "relay" ? "relay" : provider === "web" ? "bing" : undefined;
    const key = `${provider}:${engine ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  return [...groups.entries()].map(([key, groupedResults]) => {
    const [provider, engine] = key.split(":");
    return {
      provider: provider === "relay" || provider === "opencli" ? provider : "web",
      ...(engine ? { engine } : {}),
      query,
      status: groupedResults.length ? "done" : "empty",
      durationMs: 0,
      results: groupedResults
    };
  });
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
