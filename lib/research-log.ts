import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ConditionMatrixEntry,
  ResearchCandidate,
  ResearchIteration,
  ResearchResponse,
  ResearchSource,
  SearchLogEntry,
  SearchQueryPlan
} from "@/lib/types";

export type ResearchRunLog = {
  runId: string;
  createdAt: string;
  prompt: string;
  queries: SearchQueryPlan[];
  searchLogs: SearchLogEntry[];
  iterations?: ResearchIteration[];
  candidates?: ResearchCandidate[];
  conditionMatrix?: ConditionMatrixEntry[];
  stopReason?: string;
  selectedSources: ResearchSource[];
  model?: string;
  report?: string;
};

export function createResearchRunId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 10);
  return `run_${stamp}_${suffix}`;
}

export function buildResearchLogPath(runId: string): string {
  return path.join(process.cwd(), "research-runs", `${runId}.json`);
}

export async function writeResearchRunLog(log: ResearchRunLog): Promise<string> {
  const filePath = buildResearchLogPath(log.runId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(log, null, 2)}\n`, "utf8");
  return filePath;
}

export function withLogMetadata(response: ResearchResponse, filePath: string): ResearchResponse {
  return {
    ...response,
    searchLogPath: filePath
  };
}
