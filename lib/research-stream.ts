import type { ResearchStreamEvent } from "@/lib/types";

export function encodeStreamEvent(event: ResearchStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function decodeStreamEvents(chunk: string): ResearchStreamEvent[] {
  return chunk
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ResearchStreamEvent);
}
