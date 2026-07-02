import { NextResponse } from "next/server";
import { getOpenAIConfig, listModels } from "@/lib/openai";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getOpenAIConfig();
    const models = await listModels(config);
    const searchProvider = await getSearchProviderStatus();

    return NextResponse.json({
      ok: true,
      baseUrl: config.baseUrl,
      configuredModel: config.model,
      searchProvider,
      models
    });
  } catch (error) {
    const searchProvider = await getSearchProviderStatus().catch(() => getSafeSearchProviderStatus());
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? safeHealthMessage(error.message) : "Unknown provider error",
        searchProvider
      },
      { status: 500 }
    );
  }
}

async function getSearchProviderStatus() {
  const base = getSafeSearchProviderStatus();
  const relayProbe = await probeRelay();
  return {
    ...base,
    ...relayProbe,
    relayReady: base.relayConfigured && base.keyConfigured && relayProbe.relayLiveStatus === "ok"
  };
}

function getSafeSearchProviderStatus() {
  const relayConfigured = Boolean(process.env.SEARCH_RELAY_URL);
  const keyConfigured = Boolean(process.env.OPENAI_API_KEY);
  return {
    provider: process.env.SEARCH_PROVIDER ?? "relay",
    relayConfigured,
    openCliFallback: true,
    webFallback: true,
    keyConfigured,
    relayLiveStatus: relayConfigured && keyConfigured ? "unchecked" : "not_configured",
    relayReady: false
  };
}

function safeHealthMessage(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted-secret]");
}

async function probeRelay(): Promise<{ relayLiveStatus: "ok" | "error" | "not_configured"; relayStatusCode?: number; relayMessage?: string }> {
  const url = process.env.SEARCH_RELAY_URL;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!url || !apiKey) {
    return { relayLiveStatus: "not_configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-5.5",
        input: "health check"
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      return { relayLiveStatus: "error", relayStatusCode: response.status, relayMessage: `Relay HTTP ${response.status}` };
    }
    return { relayLiveStatus: "ok", relayStatusCode: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Relay health probe failed";
    return { relayLiveStatus: "error", relayMessage: safeHealthMessage(message) };
  } finally {
    clearTimeout(timer);
  }
}
