import type { ResearchSource, SearchResult } from "@/lib/types";

export const DEFAULT_SOURCE_MAX_CHARS = 60_000;

export async function fetchSource(result: SearchResult, maxChars = DEFAULT_SOURCE_MAX_CHARS): Promise<ResearchSource> {
  const response = await fetch(result.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 research-mvp/0.1",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5"
    },
    cache: "no-store",
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`Fetch failed with HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  const snippet = contentType.includes("html") ? extractReadableText(raw, maxChars) : raw.slice(0, maxChars);

  return {
    ...result,
    snippet,
    fullText: snippet,
    rawCharCount: raw.length,
    readCharCount: snippet.length,
    extractionMethod: "fetch"
  };
}

export function extractReadableText(html: string, maxChars = 3000): string {
  const title = matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const text = stripTags(withoutNoise);
  const combined = cleanText(`${title ? `${title}. ` : ""}${text}`);

  return combined.slice(0, maxChars);
}

function matchFirst(input: string, pattern: RegExp): string {
  const match = input.match(pattern);
  return match ? cleanText(stripTags(match[1])) : "";
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

function cleanText(text: string): string {
  return decodeHtml(text).replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
