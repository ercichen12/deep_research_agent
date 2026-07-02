import { NextResponse } from "next/server";
import { loadGraphState, loadInquiry, loadSourceArtifact, type HeavyStorageOptions } from "@/lib/heavy/storage";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: { id: string; sourceHash: string } | Promise<{ id: string; sourceHash: string }>;
};

export function createSourceArtifactGetHandler(options: HeavyStorageOptions = {}) {
  return async function GET(_request: Request, context: RouteContext) {
    const params = await context.params;
    const inquiry = await loadInquiry(params.id, options);
    if (!inquiry) {
      return NextResponse.json({ message: "Inquiry not found" }, { status: 404 });
    }

    const graphState = await loadLatestGraphStateForInquiry(inquiry.turns.map((turn) => turn.id), options);
    if (!graphState?.sourceLedger.some((source) => source.sourceHash === params.sourceHash)) {
      return NextResponse.json({ message: "Artifact not found" }, { status: 404 });
    }

    const artifact = await loadSourceArtifact(params.sourceHash, options);
    if (!artifact || artifact.inquiryId !== inquiry.id) {
      return NextResponse.json({ message: "Artifact not found" }, { status: 404 });
    }

    return NextResponse.json(artifact);
  };
}

async function loadLatestGraphStateForInquiry(turnIds: string[], options: HeavyStorageOptions) {
  for (const turnId of [...turnIds].reverse()) {
    const state = await loadGraphState(turnId, options);
    if (state) {
      return state;
    }
  }
  return null;
}

export const GET = createSourceArtifactGetHandler();
