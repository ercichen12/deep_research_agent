import type {
  ConditionMatrixEntry,
  DeepResearchLoopResult,
  ResearchCandidate,
  ResearchIteration,
  ResearchSource,
  SearchQueryPlan,
  SearchResult
} from "@/lib/types";

export type DeepResearchEvaluationInput = {
  prompt: string;
  iteration: number;
  queries: SearchQueryPlan[];
  searchResults: SearchResult[];
  readSources: ResearchSource[];
  previousCandidates: ResearchCandidate[];
  previousConditionMatrix: ConditionMatrixEntry[];
};

export type DeepResearchEvaluation = {
  summary: string;
  candidates: ResearchCandidate[];
  conditionMatrix: ConditionMatrixEntry[];
  nextQueries: SearchQueryPlan[];
  nextQueryReason?: string;
  stopReason?: string;
};

export type RunDeepResearchLoopOptions = {
  prompt: string;
  initialQueries: SearchQueryPlan[];
  maxIterations?: number;
  queriesPerIteration?: number;
  resultsPerIteration?: number;
  search: (query: SearchQueryPlan, iteration: number) => Promise<SearchResult[]>;
  read: (result: SearchResult, iteration: number) => Promise<ResearchSource>;
  evaluate: (input: DeepResearchEvaluationInput) => Promise<DeepResearchEvaluation>;
  now?: () => Date;
};

const DEFAULT_MAX_ITERATIONS = 4;
const DEFAULT_QUERIES_PER_ITERATION = 3;
const DEFAULT_RESULTS_PER_ITERATION = 12;

export async function runDeepResearchLoop(options: RunDeepResearchLoopOptions): Promise<DeepResearchLoopResult> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const queriesPerIteration = options.queriesPerIteration ?? DEFAULT_QUERIES_PER_ITERATION;
  const resultsPerIteration = options.resultsPerIteration ?? DEFAULT_RESULTS_PER_ITERATION;
  const now = options.now ?? (() => new Date());
  const pendingQueries = dedupeQueries(options.initialQueries);
  const iterations: ResearchIteration[] = [];
  const readUrlKeys = new Set<string>();
  const allSources: ResearchSource[] = [];
  let candidates: ResearchCandidate[] = [];
  let conditionMatrix: ConditionMatrixEntry[] = [];
  let stopReason = "max_iterations_reached";

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const queries = pendingQueries.splice(0, queriesPerIteration);
    if (queries.length === 0) {
      stopReason = "no_next_queries";
      break;
    }

    const startedAt = now().toISOString();
    const searchResults = await searchIteration(queries, iteration, options.search);
    const unreadResults = uniqueResults(searchResults).filter((result) => {
      const key = resultKey(result);
      if (readUrlKeys.has(key)) {
        return false;
      }
      return true;
    });
    const selectedResults = unreadResults.slice(0, resultsPerIteration);
    const readSources: ResearchSource[] = [];

    for (const result of selectedResults) {
      const source = await options.read(result, iteration);
      readUrlKeys.add(resultKey(result));
      readSources.push(source);
      allSources.push(source);
    }

    const evaluation = await options.evaluate({
      prompt: options.prompt,
      iteration,
      queries,
      searchResults,
      readSources,
      previousCandidates: candidates,
      previousConditionMatrix: conditionMatrix
    });

    candidates = evaluation.candidates;
    conditionMatrix = evaluation.conditionMatrix;

    const nextQueries = dedupeQueries(evaluation.nextQueries);
    const completedAt = now().toISOString();
    const iterationLog: ResearchIteration = {
      iteration,
      queries,
      searchResults,
      readSources,
      summary: evaluation.summary,
      candidates,
      conditionMatrix,
      nextQueries,
      ...(evaluation.nextQueryReason ? { nextQueryReason: evaluation.nextQueryReason } : {}),
      ...(evaluation.stopReason ? { stopReason: evaluation.stopReason } : {}),
      startedAt,
      completedAt
    };

    iterations.push(iterationLog);

    if (evaluation.stopReason) {
      stopReason = evaluation.stopReason;
      break;
    }

    if (nextQueries.length === 0) {
      stopReason = "no_next_queries";
      break;
    }

    pendingQueries.push(...nextQueries);

    if (selectedResults.length === 0) {
      stopReason = "no_unread_results";
      continue;
    }
  }

  return {
    iterations,
    sources: allSources,
    candidates,
    conditionMatrix,
    nextQueries: iterations.at(-1)?.nextQueries ?? [],
    stopReason
  };
}

async function searchIteration(
  queries: SearchQueryPlan[],
  iteration: number,
  search: (query: SearchQueryPlan, iteration: number) => Promise<SearchResult[]>
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  for (const query of queries) {
    results.push(...(await search(query, iteration)));
  }

  return uniqueResults(results);
}

export function uniqueResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = resultKey(result);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeQueries(queries: SearchQueryPlan[]): SearchQueryPlan[] {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = query.query.toLowerCase().trim();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function resultKey(result: SearchResult): string {
  try {
    const url = new URL(result.url);
    return `${url.hostname}${url.pathname}`.toLowerCase();
  } catch {
    return result.url.toLowerCase();
  }
}
