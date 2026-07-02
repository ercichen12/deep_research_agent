import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_HEAVY_BUDGET,
  type HeavyBudget,
  type HeavyEvent,
  type Inquiry,
  type Turn,
  normalizeBudget,
  redactSecrets
} from "@/lib/heavy/types";
import type { ResearchState, SearchBatchArtifact, SourceArtifact } from "@/lib/heavy/graph/types";

export type HeavyStorageOptions = {
  rootDir?: string;
};

const DEFAULT_ROOT = "research-runs";

export async function createInquiry(
  prompt: string,
  options: HeavyStorageOptions & { budget?: Partial<HeavyBudget> } = {}
): Promise<{ inquiry: Inquiry; turn: Turn }> {
  const now = new Date().toISOString();
  const inquiryId = createId("inquiry");
  const turnId = createId("turn");
  const budget = {
    ...DEFAULT_HEAVY_BUDGET,
    ...normalizeBudget(options.budget as Record<string, unknown> | undefined)
  };
  const turn: Turn = {
    id: turnId,
    inquiryId,
    mode: "heavy",
    prompt,
    status: "queued",
    budget,
    createdAt: now,
    updatedAt: now,
    runs: []
  };
  const inquiry: Inquiry = {
    id: inquiryId,
    prompt,
    mode: "heavy",
    status: "queued",
    createdAt: now,
    updatedAt: now,
    turns: [turn]
  };

  await saveInquiry(inquiry, options);
  return { inquiry, turn };
}

export async function saveInquiry(inquiry: Inquiry, options: HeavyStorageOptions = {}): Promise<void> {
  const dirs = await ensureStorage(options);
  inquiry.updatedAt = inquiry.updatedAt || new Date().toISOString();
  await writeJsonAtomic(join(dirs.inquiries, `${inquiry.id}.json`), inquiry);
}

export async function loadInquiry(id: string, options: HeavyStorageOptions = {}): Promise<Inquiry | null> {
  const dirs = await ensureStorage(options);
  const path = join(dirs.inquiries, `${safeFileName(id)}.json`);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(await readFile(path, "utf8")) as Inquiry;
}

export async function listInquiries(options: HeavyStorageOptions = {}): Promise<Inquiry[]> {
  const dirs = await ensureStorage(options);
  const files = (await readdir(dirs.inquiries).catch(() => [])).filter((file) => file.endsWith(".json"));
  const inquiries = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(join(dirs.inquiries, file), "utf8")) as Inquiry)
  );

  return inquiries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function appendTurnEvent(event: HeavyEvent, options: HeavyStorageOptions = {}): Promise<void> {
  const dirs = await ensureStorage(options);
  const turnId = "turnId" in event && event.turnId ? event.turnId : "unknown";
  const line = `${redactSecrets(JSON.stringify(event))}\n`;
  await appendFile(join(dirs.logs, `${safeFileName(turnId)}.ndjson`), line, "utf8");
}

export async function readTurnEvents(turnId: string, options: HeavyStorageOptions = {}): Promise<HeavyEvent[]> {
  const dirs = await ensureStorage(options);
  const path = join(dirs.logs, `${safeFileName(turnId)}.ndjson`);
  if (!existsSync(path)) {
    return [];
  }

  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HeavyEvent);
}

export async function saveSource(sourceHash: string, source: unknown, options: HeavyStorageOptions = {}): Promise<void> {
  const dirs = await ensureStorage(options);
  await writeJsonAtomic(join(dirs.sources, `${safeFileName(sourceHash)}.json`), source);
}

export async function saveGraphState(state: ResearchState, options: HeavyStorageOptions = {}): Promise<void> {
  const dirs = await ensureStorage(options);
  await writeJsonAtomic(join(dirs.graphState, `${safeFileName(state.turnId)}.json`), state);
}

export async function loadGraphState(turnId: string, options: HeavyStorageOptions = {}): Promise<ResearchState | null> {
  const dirs = await ensureStorage(options);
  const path = join(dirs.graphState, `${safeFileName(turnId)}.json`);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(await readFile(path, "utf8")) as ResearchState;
}

export async function saveSearchBatchArtifact(artifact: SearchBatchArtifact, options: HeavyStorageOptions = {}): Promise<void> {
  const dirs = await ensureStorage(options);
  await writeJsonAtomicRedacted(join(dirs.searchBatches, `${safeFileName(artifact.id)}.json`), artifact);
}

export async function loadSearchBatchArtifact(id: string, options: HeavyStorageOptions = {}): Promise<SearchBatchArtifact | null> {
  const dirs = await ensureStorage(options);
  const path = join(dirs.searchBatches, `${safeFileName(id)}.json`);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(await readFile(path, "utf8")) as SearchBatchArtifact;
}

export async function saveSourceArtifact(artifact: SourceArtifact, options: HeavyStorageOptions = {}): Promise<void> {
  const dirs = await ensureStorage(options);
  await writeJsonAtomicRedacted(join(dirs.sources, `${safeFileName(artifact.sourceHash)}.json`), artifact);
}

export async function loadSourceArtifact(sourceHash: string, options: HeavyStorageOptions = {}): Promise<SourceArtifact | null> {
  const dirs = await ensureStorage(options);
  const path = join(dirs.sources, `${safeFileName(sourceHash)}.json`);
  if (!existsSync(path)) {
    return null;
  }
  const artifact = JSON.parse(await readFile(path, "utf8")) as SourceArtifact;
  const excerpt = (artifact.fullText ?? artifact.excerpt ?? "").slice(0, 12_000);
  const { fullText: _fullText, ...safeArtifact } = artifact;
  return {
    ...safeArtifact,
    ...(excerpt ? { excerpt } : {})
  };
}

export function getStorageRoot(options: HeavyStorageOptions = {}): string {
  return options.rootDir ?? DEFAULT_ROOT;
}

async function ensureStorage(options: HeavyStorageOptions) {
  const root = getStorageRoot(options);
  const dirs = {
    root,
    inquiries: join(root, "inquiries"),
    logs: join(root, "logs"),
    sources: join(root, "sources"),
    graphState: join(root, "graph-state"),
    searchBatches: join(root, "search-batches")
  };
  await mkdir(dirs.inquiries, { recursive: true });
  await mkdir(dirs.logs, { recursive: true });
  await mkdir(dirs.sources, { recursive: true });
  await mkdir(dirs.graphState, { recursive: true });
  await mkdir(dirs.searchBatches, { recursive: true });
  return dirs;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

async function writeJsonAtomicRedacted(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${redactSecrets(JSON.stringify(value, null, 2))}\n`, "utf8");
  await rename(temp, path);
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
