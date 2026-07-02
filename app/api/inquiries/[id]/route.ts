import { NextResponse } from "next/server";
import { loadGraphState, loadInquiry, type HeavyStorageOptions } from "@/lib/heavy/storage";
import { summarizeGraphState } from "@/lib/heavy/graph/types";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: { id: string } | Promise<{ id: string }>;
};

export function createInquiryByIdGetHandler(options: HeavyStorageOptions = {}) {
  return async function GET(_request: Request, context: RouteContext) {
    const params = await context.params;
    const inquiry = await loadInquiry(params.id, options);

    if (!inquiry) {
      return NextResponse.json({ message: "Inquiry not found" }, { status: 404 });
    }

    const latestTurn = inquiry.turns.at(-1);
    const graphState = latestTurn ? await loadGraphState(latestTurn.id, options) : null;
    if (graphState) {
      inquiry.graphState = summarizeGraphState(graphState);
    }

    return NextResponse.json(inquiry);
  };
}

export const GET = createInquiryByIdGetHandler();
