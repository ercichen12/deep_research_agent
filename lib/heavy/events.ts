import type { HeavyEvent } from "@/lib/heavy/types";

export function encodeHeavyEvent(event: HeavyEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function decodeHeavyEvents(chunk: string): HeavyEvent[] {
  return chunk
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HeavyEvent);
}
