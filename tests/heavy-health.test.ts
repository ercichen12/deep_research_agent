import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/openai", () => ({
  getOpenAIConfig: () => ({
    baseUrl: "https://ai.input.im/v1",
    apiKey: "sk-test",
    model: "gpt-5.5"
  }),
  listModels: async () => ["gpt-5.5"]
}));

describe("Heavy health route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("distinguishes relay configured from relay live availability without leaking secrets", async () => {
    vi.stubEnv("SEARCH_PROVIDER", "relay");
    vi.stubEnv("SEARCH_RELAY_URL", "https://relay.example/v1/responses");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-secret-that-must-not-leak");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "upstream unavailable sk-test-secret-that-must-not-leak" }), { status: 502 }))
    );

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.searchProvider).toMatchObject({
      provider: "relay",
      relayConfigured: true,
      relayLiveStatus: "error",
      relayReady: false
    });
    expect(serialized).not.toContain("sk-test-secret-that-must-not-leak");
    expect(serialized).not.toContain("Bearer");
  });
});
