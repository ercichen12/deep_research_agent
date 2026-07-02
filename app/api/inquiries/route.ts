import { NextResponse } from "next/server";
import { listInquiries, type HeavyStorageOptions } from "@/lib/heavy/storage";
import { normalizeBudget } from "@/lib/heavy/types";
import { startHeavyInquiry } from "@/lib/heavy/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type InquiryStartService = {
  start: (prompt: string, options?: { budget?: Record<string, unknown> }) => Promise<{ inquiryId: string; turnId: string }>;
};

export function createInquiryPostHandler(service: InquiryStartService = { start: startHeavyInquiry }) {
  return async function POST(request: Request) {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

      if (prompt.length < 10) {
        return NextResponse.json({ message: "请输入更完整的研究需求。" }, { status: 400 });
      }

      const result = await service.start(prompt, {
        budget: normalizeBudget(body)
      });
      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json(
        {
          message: error instanceof Error ? error.message : "Heavy inquiry failed"
        },
        { status: 500 }
      );
    }
  };
}

export function createInquiryGetHandler(options: HeavyStorageOptions = {}) {
  return async function GET() {
    const inquiries = await listInquiries(options);
    return NextResponse.json({ inquiries });
  };
}

export const POST = createInquiryPostHandler();
export const GET = createInquiryGetHandler();
