import type { ChatMessage } from "@/lib/types";

export type OpenAIConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ChatCompletionRequestOptions = OpenAIConfig & {
  messages: ChatMessage[];
  temperature?: number;
};

export type ChatCompletionResult = {
  content: string;
  model: string;
};

export function getOpenAIConfig(): OpenAIConfig {
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? "gpt-5.5";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model
  };
}

export function buildChatCompletionRequest(options: ChatCompletionRequestOptions): {
  url: string;
  init: RequestInit;
} {
  const body = {
    model: options.model,
    temperature: options.temperature ?? 0.2,
    messages: options.messages
  };

  return {
    url: `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify(body)
    }
  };
}

export async function createChatCompletion(
  options: ChatCompletionRequestOptions
): Promise<ChatCompletionResult> {
  const request = buildChatCompletionRequest(options);
  const response = await fetch(request.url, request.init);
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message = typeof json?.error?.message === "string" ? json.error.message : `Provider HTTP ${response.status}`;
    throw new Error(message);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Provider response did not include choices[0].message.content");
  }

  return {
    content,
    model: typeof json?.model === "string" ? json.model : options.model
  };
}

export async function listModels(config: OpenAIConfig): Promise<string[]> {
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/models`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`
    },
    cache: "no-store"
  });
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(typeof json?.error?.message === "string" ? json.error.message : `Provider HTTP ${response.status}`);
  }

  if (!Array.isArray(json?.data)) {
    return [];
  }

  return json.data
    .map((model: { id?: unknown }) => model.id)
    .filter((id: unknown): id is string => typeof id === "string");
}
