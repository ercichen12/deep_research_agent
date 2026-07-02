import { NextResponse } from "next/server";
import { getOpenAIConfig, listModels } from "@/lib/openai";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getOpenAIConfig();
    const models = await listModels(config);

    return NextResponse.json({
      ok: true,
      baseUrl: config.baseUrl,
      configuredModel: config.model,
      searchProvider: getSearchProviderStatus(),
      models
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? safeHealthMessage(error.message) : "Unknown provider error",
        searchProvider: getSearchProviderStatus()
      },
      { status: 500 }
    );
  }
}

function getSearchProviderStatus() {
  return {
    provider: process.env.SEARCH_PROVIDER ?? "relay",
    relayConfigured: Boolean(process.env.SEARCH_RELAY_URL),
    openCliFallback: true,
    webFallback: true,
    keyConfigured: Boolean(process.env.OPENAI_API_KEY)
  };
}

function safeHealthMessage(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted-secret]");
}
