import { NextResponse } from "next/server";
import type { RunResearchOptions } from "@/lib/research";
import { runResearch } from "@/lib/research";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { prompt?: unknown };
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

    if (prompt.length < 10) {
      return NextResponse.json(
        {
          message: "请输入更完整的研究需求。"
        },
        { status: 400 }
      );
    }

    const result = await runResearch(prompt, parseResearchBudget(body));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "研究任务失败"
      },
      { status: 500 }
    );
  }
}

export function parseResearchBudget(body: Record<string, unknown>): Pick<RunResearchOptions, "maxIterations" | "queriesPerIteration" | "resultsPerIteration"> {
  return {
    ...optionalPositiveInteger(body.maxIterations, "maxIterations", 1, 6),
    ...optionalPositiveInteger(body.queriesPerIteration, "queriesPerIteration", 1, 5),
    ...optionalPositiveInteger(body.resultsPerIteration, "resultsPerIteration", 1, 30)
  };
}

function optionalPositiveInteger(
  value: unknown,
  key: "maxIterations" | "queriesPerIteration" | "resultsPerIteration",
  min: number,
  max: number
): Pick<RunResearchOptions, typeof key> {
  if (value === undefined) {
    return {};
  }

  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < min || number > max) {
    return {};
  }

  return { [key]: number };
}
