import { describe, expect, it, vi } from "vitest";
import { createHeavySearchProvider, parseRelaySearchResults } from "@/lib/heavy/search-provider";
import type { HeavySearchResult, HeavySource, ReadAttemptLog, SearchAttemptLog } from "@/lib/heavy/types";

describe("relay/OpenCLI heavy search provider", () => {
  it("parses relay output_text strict JSON results", async () => {
    const relayFetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ output_text: '{"results":[{"title":"A","url":"https://example.com/a","snippet":"alpha"}]}' })
    );
    const provider = createHeavySearchProvider({
      env: relayEnv(),
      relayFetch,
      openCliSearch: async () => [],
      webSearch: async () => []
    });

    const results = await provider.search("alpha query", 3);
    const body = JSON.parse(String(relayFetch.mock.calls[0][1]?.body));

    expect(body.tools).toEqual([{ type: "web_search_preview" }]);
    expect(body.tool_choice).toBeDefined();
    expect(results).toEqual([
      {
        title: "A",
        url: "https://example.com/a",
        snippet: "alpha",
        provider: "relay"
      }
    ]);
  });

  it("falls back to OpenCLI when relay times out", async () => {
    const provider = createHeavySearchProvider({
      env: relayEnv(),
      relayFetch: async () => {
        throw new DOMException("timeout", "AbortError");
      },
      openCliSearch: async () => [{ title: "OpenCLI A", url: "https://opencli.example/a" }],
      webSearch: async () => []
    });

    const results = await provider.search("fallback query", 2);

    expect(results[0]).toMatchObject({ title: "OpenCLI A", provider: "opencli" });
  });

  it("falls back when relay JSON is malformed", async () => {
    const provider = createHeavySearchProvider({
      env: relayEnv(),
      relayFetch: async () => jsonResponse({ output_text: "not json" }),
      openCliSearch: async () => [{ title: "OpenCLI B", url: "https://opencli.example/b" }],
      webSearch: async () => []
    });

    const results = await provider.search("broken json", 2);

    expect(results.map((result) => result.provider)).toEqual(["opencli"]);
  });

  it("falls back to existing web search when relay and OpenCLI return empty", async () => {
    const provider = createHeavySearchProvider({
      env: relayEnv(),
      relayFetch: async () => jsonResponse({ output_text: '{"results":[]}' }),
      openCliSearch: async () => [],
      webSearch: async () => [{ title: "Web A", url: "https://web.example/a" }]
    });

    const results = await provider.search("empty relay", 2);

    expect(results).toEqual([{ title: "Web A", url: "https://web.example/a", provider: "web" }]);
  });

  it("traces relay, each OpenCLI engine, and web fallback calls", async () => {
    const trace: SearchAttemptLog[] = [];
    const provider = createHeavySearchProvider({
      env: relayEnv(),
      trace,
      relayFetch: async () => jsonResponse({ output_text: '{"results":[]}' }),
      openCliSearchByEngine: async (engine) =>
        engine === "brave"
          ? [{ title: "Brave result", url: "https://brave.example/a", snippet: "brave" }]
          : [],
      webSearch: async () => [{ title: "Web fallback", url: "https://web.example/a" }]
    });

    const results = await provider.search("innovative hardware CEO Australia", 4);

    expect(results[0]).toMatchObject({ title: "Brave result", provider: "opencli", engine: "brave" });
    expect(trace.map((entry) => `${entry.provider}:${entry.engine ?? ""}:${entry.status}`)).toEqual([
      "relay::empty",
      "opencli:google:empty",
      "opencli:brave:done",
      "opencli:duckduckgo:empty",
      "web:bing:done"
    ]);
    expect(trace.find((entry) => entry.engine === "brave")?.results[0].title).toBe("Brave result");
  });

  it("traces relay as not_configured before falling back", async () => {
    const trace: SearchAttemptLog[] = [];
    const provider = createHeavySearchProvider({
      env: { NODE_ENV: "test", SEARCH_PROVIDER: "relay" } as NodeJS.ProcessEnv,
      trace,
      openCliSearch: async () => [],
      webSearch: async () => []
    });

    await expect(provider.search("OpenAI current CEO official website", 3)).resolves.toEqual([]);

    expect(trace[0]).toMatchObject({
      provider: "relay",
      engine: "relay",
      status: "error",
      query: "OpenAI current CEO official website",
      results: [],
      message: "not_configured"
    });
  });

  it("aggregates relay and all OpenCLI engines instead of stopping after relay returns one result", async () => {
    const engineLimits: Record<string, number> = {};
    const trace: SearchAttemptLog[] = [];
    const provider = createHeavySearchProvider({
      env: relayEnv(),
      trace,
      relayFetch: async () => jsonResponse({ output_text: '{"results":[{"title":"Relay A","url":"https://relay.example/a","snippet":"relay"}]}' }),
      openCliSearchByEngine: async (engine, _query, limit) => {
        engineLimits[engine] = limit;
        return Array.from({ length: limit }, (_, index) => ({
          title: `${engine} ${index + 1}`,
          url: `https://${engine}.example/${index + 1}`,
          snippet: `${engine} snippet ${index + 1}`
        }));
      },
      webSearch: async () => []
    });

    const results = await provider.search("innovative hardware CEO Australia", 30);

    expect(results.map((result) => result.provider)).toContain("relay");
    expect(results.filter((result) => result.provider === "opencli").length).toBeGreaterThan(20);
    expect(engineLimits).toEqual({ google: 10, brave: 18, duckduckgo: 10 });
    expect(trace.map((entry) => `${entry.provider}:${entry.engine ?? ""}:${entry.status}`)).toEqual([
      "relay::done",
      "opencli:google:done",
      "opencli:brave:done",
      "opencli:duckduckgo:done"
    ]);
  });

  it("stops repeating OpenCLI engine calls after the browser bridge is unavailable", async () => {
    const trace: SearchAttemptLog[] = [];
    const calledEngines: string[] = [];
    const provider = createHeavySearchProvider({
      env: relayEnv(),
      trace,
      relayFetch: async () => jsonResponse({ output_text: '{"results":[]}' }),
      openCliSearchByEngine: async (engine) => {
        calledEngines.push(engine);
        throw new Error("BROWSER_CONNECT: Browser Bridge extension not connected");
      },
      webSearch: async () => [{ title: "Web fallback", url: "https://web.example/a" }]
    });

    await expect(provider.search("OpenAI current CEO official website", 10)).resolves.toEqual([
      { title: "Web fallback", url: "https://web.example/a", provider: "web" }
    ]);
    await provider.search("OpenAI leadership CEO official site", 10);

    expect(calledEngines).toEqual(["google"]);
    expect(trace.map((entry) => `${entry.provider}:${entry.engine ?? ""}:${entry.status}`)).toEqual([
      "relay::empty",
      "opencli:google:error",
      "web:bing:done",
      "relay::empty",
      "opencli::error",
      "web:bing:done"
    ]);
    expect(trace.find((entry) => entry.provider === "opencli" && !entry.engine)?.message).toMatch(/bridge/i);
  });

  it("reads with OpenCLI first and fetch fallback second", async () => {
    const readTrace: ReadAttemptLog[] = [];
    const provider = createHeavySearchProvider({
      env: relayEnv(),
      readTrace,
      relayFetch: async () => jsonResponse({ output_text: '{"results":[]}' }),
      openCliRead: async () => {
        throw new Error("OpenCLI read failed");
      },
      fetchRead: async (result) => ({
        ...result,
        snippet: "Fetched text",
        fullText: "Fetched text"
      })
    });

    await expect(provider.read({ title: "A", url: "https://example.com/a", provider: "web" })).resolves.toMatchObject({
      snippet: "Fetched text",
      provider: "fetch"
    });
    expect(readTrace.map((entry) => `${entry.provider}:${entry.status}`)).toEqual(["opencli:error", "fetch:done"]);
  });

  it("extracts annotations as backup relay sources", () => {
    expect(
      parseRelaySearchResults({
        output: [
          {
            content: [
              {
                text: '{"results":[]}',
                annotations: [{ type: "url_citation", title: "Annotated", url: "https://example.com/c" }]
              }
            ]
          }
        ]
      })
    ).toEqual([{ title: "Annotated", url: "https://example.com/c", provider: "relay" }]);
  });
});

function relayEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    OPENAI_API_KEY: "sk-test",
    OPENAI_MODEL: "test-model",
    SEARCH_PROVIDER: "relay",
    SEARCH_RELAY_URL: "https://relay.example/v1/responses"
  } as NodeJS.ProcessEnv;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
