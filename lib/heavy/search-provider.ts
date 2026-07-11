import { isOpenCliBridgeError, readWithOpenCli, searchWithOpenCli } from "@/lib/opencli";
import { searchWeb } from "@/lib/search";
import { fetchSource } from "@/lib/source";
import type { ResearchSource, SearchResult } from "@/lib/types";
import {
  compactError,
  normalizeHeavySearchResult,
  normalizeHeavySource,
  type HeavySearchProvider,
  type HeavySearchResult,
  type HeavySource,
  type ReadAttemptLog,
  type SearchAttemptLog
} from "@/lib/heavy/types";

type SearchProviderDeps = {
  env?: NodeJS.ProcessEnv;
  relayFetch?: typeof fetch;
  openCliSearch?: (query: string, limit: number) => Promise<SearchResult[]>;
  openCliSearchByEngine?: (engine: "google" | "brave" | "duckduckgo", query: string, limit: number) => Promise<SearchResult[]>;
  openCliRead?: (result: SearchResult) => Promise<ResearchSource>;
  webSearch?: (query: string, limit: number) => Promise<SearchResult[]>;
  fetchRead?: (result: SearchResult) => Promise<ResearchSource>;
  timeoutMs?: number;
  trace?: SearchAttemptLog[];
  readTrace?: ReadAttemptLog[];
  openCliBridgeState?: { unavailable: boolean };
};

const DEFAULT_RELAY_TIMEOUT_MS = 20_000;
const OPENCLI_ENGINE_LIMITS = {
  google: 10,
  brave: 18,
  duckduckgo: 10
} as const;

export function createHeavySearchProvider(deps: SearchProviderDeps = {}): HeavySearchProvider {
  const env = deps.env ?? process.env;
  const trace = deps.trace ?? [];
  const readTrace = deps.readTrace ?? [];
  const openCliBridgeState = deps.openCliBridgeState ?? { unavailable: false };
  const scopedDeps: SearchProviderDeps = {
    ...deps,
    trace,
    readTrace,
    openCliBridgeState
  };

  return {
    async search(query, limit = 8) {
      const relayTrace: SearchAttemptLog[] = [];
      const openCliTrace: SearchAttemptLog[] = [];
      const webTrace: SearchAttemptLog[] = [];
      const relayPromise =
        (env.SEARCH_PROVIDER ?? "relay") === "relay"
          ? searchRelay(query, limit, { ...scopedDeps, trace: relayTrace }).catch((error) => {
              pushSearchTrace(
                { ...scopedDeps, trace: relayTrace },
                {
                  provider: "relay",
                  query,
                  status: "error",
                  results: [],
                  message: compactError(error instanceof Error ? error.message : "Relay search failed")
                }
              );
              return [];
            })
          : Promise.resolve([]);
      const openCliPromise = searchOpenCli(query, limit, { ...scopedDeps, trace: openCliTrace }).catch(() => []);
      const webPromise = searchWebFallback(query, limit, { ...scopedDeps, trace: webTrace }).catch((error) => {
        pushSearchTrace(
          { ...scopedDeps, trace: webTrace },
          {
            provider: "web",
            engine: "bing",
            query,
            status: "error",
            results: [],
            message: compactError(error instanceof Error ? error.message : "Web fallback failed")
          }
        );
        return [];
      });

      const [relayResults, openCliResults, webResults] = await Promise.all([relayPromise, openCliPromise, webPromise]);
      trace.push(...relayTrace, ...openCliTrace, ...webTrace);
      return dedupeSearchResults([...relayResults, ...openCliResults, ...webResults]).slice(0, limit);
    },
    async read(result) {
      const openCliRead = scopedDeps.openCliRead ?? readWithOpenCli;
      const fetchRead = scopedDeps.fetchRead ?? fetchSource;

      try {
        const startedAt = Date.now();
        const source = normalizeReadSource(await openCliRead(result), "opencli");
        pushReadTrace(scopedDeps, {
          provider: "opencli",
          status: "done",
          title: source.title,
          url: source.url,
          readCharCount: source.readCharCount ?? source.fullText?.length ?? source.snippet.length,
          durationMs: Date.now() - startedAt
        });
        return source;
      } catch (error) {
        pushReadTrace(scopedDeps, {
          provider: "opencli",
          status: "error",
          title: result.title,
          url: result.url,
          message: compactError(error instanceof Error ? error.message : "OpenCLI read failed")
        });
        const startedAt = Date.now();
        const source = normalizeReadSource(await fetchRead(result), "fetch");
        pushReadTrace(scopedDeps, {
          provider: "fetch",
          status: "done",
          title: source.title,
          url: source.url,
          readCharCount: source.readCharCount ?? source.fullText?.length ?? source.snippet.length,
          durationMs: Date.now() - startedAt
        });
        return source;
      }
    },
    drainSearchLogs() {
      return trace.splice(0);
    },
    drainReadLogs() {
      return readTrace.splice(0);
    },
    forkTrace() {
      return createHeavySearchProvider({
        ...deps,
        trace: [],
        readTrace: [],
        openCliBridgeState
      });
    }
  };
}

export async function searchRelay(query: string, limit: number, deps: SearchProviderDeps = {}): Promise<HeavySearchResult[]> {
  const env = deps.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY;
  const url = env.SEARCH_RELAY_URL;

  if (!apiKey || !url) {
    pushSearchTrace(deps, {
      provider: "relay",
      engine: "relay",
      query,
      status: "error",
      results: [],
      message: "not_configured",
      durationMs: 0
    });
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_RELAY_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const relayFetch = deps.relayFetch ?? fetch;
    const response = await relayFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(buildRelaySearchBody(query, limit, env)),
      signal: controller.signal
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Relay HTTP ${response.status}`);
    }

    const results = parseRelaySearchResults(json).slice(0, limit);
    pushSearchTrace(deps, {
      provider: "relay",
      query,
      status: results.length > 0 ? "done" : "empty",
      results,
      durationMs: Date.now() - startedAt
    });
    return results;
  } catch (error) {
    throw new Error(compactError(error instanceof Error ? error.message : "Relay search failed"));
  } finally {
    clearTimeout(timer);
  }
}

export function buildRelaySearchBody(query: string, limit: number, env: NodeJS.ProcessEnv = process.env) {
  return {
    model: env.OPENAI_MODEL ?? "gpt-5.5",
    input: `Search the web for this research task and return strict JSON only:
{ "results": [{ "title": "...", "url": "https://...", "snippet": "..." }] }

Rules:
- Return at most ${limit} results.
- Prefer primary sources, company pages, official profiles, reputable news, documents, and data pages.
- Do not include any prose outside JSON.

Query: ${query}`,
    tools: [{ type: "web_search_preview" }],
    tool_choice: { type: "web_search_preview" },
    include: ["output[*].content[*].annotations"]
  };
}

export function parseRelaySearchResults(json: unknown): HeavySearchResult[] {
  const outputText = extractRelayText(json);
  const jsonResults = outputText ? parseJsonResults(outputText) : [];
  const annotationResults = extractAnnotationResults(json);
  return dedupeSearchResults([...jsonResults, ...annotationResults]);
}

async function searchOpenCli(query: string, limit: number, deps: SearchProviderDeps): Promise<HeavySearchResult[]> {
  if (deps.openCliBridgeState?.unavailable) {
    pushSearchTrace(deps, {
      provider: "opencli",
      query,
      status: "error",
      results: [],
      message: "OpenCLI Browser Bridge extension is not connected; skipped OpenCLI search for this query.",
      durationMs: 0
    });
    return [];
  }

  if (deps.openCliSearch) {
    const startedAt = Date.now();
    const results = (await deps.openCliSearch(query, limit))
      .map((result) => normalizeHeavySearchResult(result, "opencli"))
      .filter((result): result is HeavySearchResult => Boolean(result));
    pushSearchTrace(deps, {
      provider: "opencli",
      query,
      status: results.length > 0 ? "done" : "empty",
      results,
      durationMs: Date.now() - startedAt
    });
    return results;
  }

  const engines = ["google", "brave", "duckduckgo"] as const;
  const engineRuns = await Promise.all(
    engines.map(async (engine) => {
      const engineTrace: SearchAttemptLog[] = [];
      const engineDeps = { ...deps, trace: engineTrace };
      const rows: SearchResult[] = [];
      let bridgeUnavailable = false;
      const startedAt = Date.now();
      try {
        const engineSearch = deps.openCliSearchByEngine ?? searchWithOpenCli;
        const engineResults = (await engineSearch(engine, query, openCliEngineLimit(engine, limit))).map((result) => ({
          ...result,
          engine
        }));
        rows.push(...engineResults);
        const normalized = engineResults
          .map((result) => normalizeHeavySearchResult(result, "opencli"))
          .filter((result): result is HeavySearchResult => Boolean(result));
        pushSearchTrace(engineDeps, {
          provider: "opencli",
          engine,
          query,
          status: normalized.length > 0 ? "done" : "empty",
          results: normalized,
          durationMs: Date.now() - startedAt
        });
      } catch (error) {
        const message = compactError(error instanceof Error ? error.message : `${engine} search failed`);
        pushSearchTrace(engineDeps, {
          provider: "opencli",
          engine,
          query,
          status: "error",
          results: [],
          message,
          durationMs: Date.now() - startedAt
        });
        bridgeUnavailable = isOpenCliBridgeError(message);
      }
      return { rows, trace: engineTrace, bridgeUnavailable };
    })
  );

  const rows: SearchResult[] = [];
  for (const run of engineRuns) {
    rows.push(...run.rows);
    deps.trace?.push(...run.trace);
  }
  if (engineRuns.some((run) => run.bridgeUnavailable) && deps.openCliBridgeState) {
    deps.openCliBridgeState.unavailable = true;
  }

  return dedupeSearchResults(
    rows.map((result) => normalizeHeavySearchResult(result, "opencli")).filter((result): result is HeavySearchResult => Boolean(result))
  ).slice(0, limit);
}

function openCliEngineLimit(engine: keyof typeof OPENCLI_ENGINE_LIMITS, requestedLimit: number): number {
  return Math.min(OPENCLI_ENGINE_LIMITS[engine], Math.max(requestedLimit, 1));
}

async function searchWebFallback(query: string, limit: number, deps: SearchProviderDeps): Promise<HeavySearchResult[]> {
  const webSearch = deps.webSearch ?? searchWeb;
  const startedAt = Date.now();
  const results = (await webSearch(query, limit))
    .map((result) => normalizeHeavySearchResult(result, "web"))
    .filter((result): result is HeavySearchResult => Boolean(result))
    .slice(0, limit);
  pushSearchTrace(deps, {
    provider: "web",
    engine: "bing",
    query,
    status: results.length > 0 ? "done" : "empty",
    results,
    durationMs: Date.now() - startedAt
  });
  return results;
}

function parseJsonResults(outputText: string): HeavySearchResult[] {
  const start = outputText.indexOf("{");
  const end = outputText.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Relay response did not include JSON results");
  }
  const parsed = JSON.parse(outputText.slice(start, end + 1)) as { results?: unknown };
  if (!Array.isArray(parsed.results)) {
    return [];
  }

  return parsed.results.map((result) => normalizeHeavySearchResult(result, "relay")).filter((result): result is HeavySearchResult => Boolean(result));
}

function extractRelayText(json: unknown): string {
  if (json && typeof json === "object" && "output_text" in json && typeof (json as { output_text?: unknown }).output_text === "string") {
    return (json as { output_text: string }).output_text;
  }

  const output = json && typeof json === "object" && Array.isArray((json as { output?: unknown }).output) ? (json as { output: unknown[] }).output : [];
  const textParts: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as { content?: unknown }).content)) {
      continue;
    }
    for (const content of (item as { content: unknown[] }).content) {
      if (content && typeof content === "object" && typeof (content as { text?: unknown }).text === "string") {
        textParts.push((content as { text: string }).text);
      }
    }
  }

  return textParts.join("\n").trim();
}

function extractAnnotationResults(json: unknown): HeavySearchResult[] {
  const output = json && typeof json === "object" && Array.isArray((json as { output?: unknown }).output) ? (json as { output: unknown[] }).output : [];
  const results: HeavySearchResult[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as { content?: unknown }).content)) {
      continue;
    }
    for (const content of (item as { content: unknown[] }).content) {
      if (!content || typeof content !== "object" || !Array.isArray((content as { annotations?: unknown }).annotations)) {
        continue;
      }
      for (const annotation of (content as { annotations: unknown[] }).annotations) {
        const normalized = normalizeHeavySearchResult(annotation, "relay");
        if (normalized) {
          results.push(normalized);
        }
      }
    }
  }

  return results;
}

function normalizeReadSource(source: ResearchSource, provider: "opencli" | "fetch"): HeavySource {
  const normalized = normalizeHeavySource({
    ...source,
    provider,
    fullText: source.fullText ?? source.snippet,
    snippet: source.snippet
  });
  if (!normalized) {
    throw new Error("Read provider returned an invalid source");
  }
  return normalized;
}

function dedupeSearchResults(results: HeavySearchResult[]): HeavySearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = result.url.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function pushSearchTrace(deps: SearchProviderDeps, entry: Omit<SearchAttemptLog, "timestamp">): void {
  deps.trace?.push({
    ...entry,
    timestamp: new Date().toISOString()
  });
}

function pushReadTrace(deps: SearchProviderDeps, entry: Omit<ReadAttemptLog, "timestamp">): void {
  deps.readTrace?.push({
    ...entry,
    timestamp: new Date().toISOString()
  });
}
