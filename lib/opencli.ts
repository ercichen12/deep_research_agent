import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ResearchSource, SearchResult } from "@/lib/types";

const execFileAsync = promisify(execFile);
const OPENCLI_TIMEOUT_MS = 180_000;
const DEFAULT_READ_MAX_CHARS = 60_000;

type OpenCliSearchRow = {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
};

export type OpenCliSearchEngine = "brave" | "duckduckgo" | "google";

export type OpenCliSearchResult = SearchResult & {
  snippet?: string;
};

export async function searchWithOpenCli(
  engine: OpenCliSearchEngine,
  query: string,
  limit = 8
): Promise<OpenCliSearchResult[]> {
  const args = buildSearchArgs(engine, query, limit);
  const stdout = await runOpenCli(args);
  const parsed = JSON.parse(stdout) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(`OpenCLI ${engine} search returned non-array JSON`);
  }

  return normalizeOpenCliSearchResults(parsed);
}

export async function readWithOpenCli(result: SearchResult, maxChars = DEFAULT_READ_MAX_CHARS): Promise<ResearchSource> {
  const stdout = await runOpenCli([
    "web",
    "read",
    "--url",
    result.url,
    "--stdout",
    "--download-images",
    "false",
    "--window",
    "background",
    "--site-session",
    "persistent",
    "-f",
    "plain"
  ]);

  const snippet = openCliMarkdownToSnippet(stdout, maxChars);

  return {
    ...result,
    snippet,
    fullText: snippet,
    rawCharCount: stdout.length,
    readCharCount: snippet.length,
    extractionMethod: "opencli"
  };
}

export function normalizeOpenCliSearchResults(rows: unknown[]): OpenCliSearchResult[] {
  const seen = new Set<string>();
  const results: OpenCliSearchResult[] = [];

  for (const row of rows as OpenCliSearchRow[]) {
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const url = typeof row.url === "string" ? row.url.trim() : "";
    const snippet = typeof row.snippet === "string" ? row.snippet.trim() : "";

    if (!title || !isHttpUrl(url) || seen.has(url)) {
      continue;
    }

    seen.add(url);
    results.push({
      title,
      url,
      ...(snippet ? { snippet } : {})
    });
  }

  return results;
}

export function openCliMarkdownToSnippet(markdown: string, maxChars = 3600): string {
  return markdown
    .replace(/^> 原文链接:.*$/gm, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]*]\(([^)]+)\)/g, " ")
    .replace(/[#*_`>|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

export function isOpenCliBridgeError(message: string): boolean {
  return /BROWSER_CONNECT|Browser Bridge extension not connected/i.test(message);
}

export function isOpenCliEmptyResult(message: string): boolean {
  return /EMPTY_RESULT|returned no data|No .* results matched/i.test(message);
}

export function getOpenCliExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "npx.cmd" : "npx";
}

export function buildOpenCliCommand(
  args: string[],
  platform: NodeJS.Platform = process.platform
): { file: string; args: string[] } {
  const npxArgs = ["-y", "@jackwener/opencli", ...args];

  if (platform === "win32") {
    return {
      file: "cmd.exe",
      args: ["/d", "/s", "/c", getOpenCliExecutable(platform), ...npxArgs]
    };
  }

  return {
    file: getOpenCliExecutable(platform),
    args: npxArgs
  };
}

async function runOpenCli(args: string[]): Promise<string> {
  try {
    const command = buildOpenCliCommand(args);
    const { stdout } = await execFileAsync(command.file, command.args, {
      timeout: OPENCLI_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenCLI command failed";
    const stdout = typeof (error as { stdout?: unknown }).stdout === "string" ? (error as { stdout: string }).stdout : "";
    const stderr = typeof (error as { stderr?: unknown }).stderr === "string" ? (error as { stderr: string }).stderr : "";
    throw new Error([message, stdout, stderr].filter(Boolean).join("\n"));
  }
}

function buildSearchArgs(engine: OpenCliSearchEngine, query: string, limit: number): string[] {
  const common = ["search", query, "--limit", String(limit), "--window", "background", "--site-session", "persistent", "-f", "json"];

  if (engine === "duckduckgo") {
    return ["duckduckgo", ...common, "--region", "us-en"];
  }

  if (engine === "google") {
    return ["google", ...common, "--lang", "en"];
  }

  return ["brave", ...common];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
