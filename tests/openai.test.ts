import { describe, expect, it } from "vitest";
import { buildChatCompletionRequest } from "@/lib/openai";

describe("buildChatCompletionRequest", () => {
  it("builds an OpenAI-compatible chat completions request", () => {
    const request = buildChatCompletionRequest({
      baseUrl: "https://ai.input.im/v1",
      apiKey: "sk-test-secret",
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.2
    });

    expect(request.url).toBe("https://ai.input.im/v1/chat/completions");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test-secret"
    });
    expect(JSON.parse(String(request.init.body))).toMatchObject({
      model: "gpt-test",
      temperature: 0.2,
      messages: [{ role: "user", content: "hello" }]
    });
  });
});
