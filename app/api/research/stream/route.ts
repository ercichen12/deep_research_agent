import { NextResponse } from "next/server";
import { parseResearchBudget } from "@/app/api/research/route";
import { encodeStreamEvent } from "@/lib/research-stream";
import { runResearch } from "@/lib/research";
import type { ResearchStreamEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  const body = (await request.json()) as { prompt?: unknown };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (prompt.length < 10) {
    return NextResponse.json({ message: "请输入更完整的研究需求。" }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ResearchStreamEvent) => {
        controller.enqueue(encoder.encode(encodeStreamEvent(event)));
      };
      const heartbeat = setInterval(() => {
        send({ type: "heartbeat", timestamp: new Date().toISOString() });
      }, 10_000);

      try {
        await runResearch(prompt, {
          ...parseResearchBudget(body),
          onEvent: send
        });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "研究任务失败",
          timestamp: new Date().toISOString()
        });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
