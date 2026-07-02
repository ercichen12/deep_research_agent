import type { Inquiry, Turn } from "@/lib/heavy/types";
import type { GraphStateSummary, ResearchState } from "@/lib/heavy/graph/types";

export type StaleGraphMeta = {
  stale: true;
  staleReason: string;
  lastHeartbeatAt: string;
};

export function deriveStaleGraphMeta(input: {
  inquiry: Inquiry;
  turn?: Turn;
  state?: ResearchState | null;
  nowMs?: number;
  staleAfterMs?: number;
}): StaleGraphMeta | null {
  const { inquiry, turn, state } = input;
  if (!turn || !state || inquiry.status !== "running" || turn.status !== "running" || state.status !== "running") {
    return null;
  }

  const updatedAt = new Date(state.updatedAt).getTime();
  const staleAfterMs = input.staleAfterMs ?? configuredStaleAfterMs();
  if (!Number.isFinite(updatedAt) || (input.nowMs ?? Date.now()) - updatedAt <= staleAfterMs) {
    return null;
  }

  return {
    stale: true,
    staleReason: "Graph run appears interrupted or stale; no recent event heartbeat was recorded.",
    lastHeartbeatAt: state.updatedAt
  };
}

export function applyInquiryStaleMeta(inquiry: Inquiry, meta: StaleGraphMeta | null): Inquiry {
  if (!meta) {
    return inquiry;
  }

  inquiry.stale = true;
  inquiry.staleReason = meta.staleReason;
  inquiry.lastHeartbeatAt = meta.lastHeartbeatAt;
  return inquiry;
}

export function applyGraphSummaryStaleMeta(summary: GraphStateSummary, meta: StaleGraphMeta | null): GraphStateSummary {
  return meta ? { ...summary, ...meta } : summary;
}

function configuredStaleAfterMs(): number {
  return Number.parseInt(process.env.GRAPH_STALE_AFTER_MS ?? "", 10) || 10 * 60 * 1000;
}
