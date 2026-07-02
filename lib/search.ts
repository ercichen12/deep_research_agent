import type { SearchResult } from "@/lib/types";

const RESULT_LINK_PATTERN = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const BING_RESULT_PATTERN = /<li[^>]+class=["'][^"']*b_algo[^"']*["'][^>]*>[\s\S]*?<h2[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/gi;

export async function searchWeb(query: string, limit = 8): Promise<SearchResult[]> {
  const url = buildBingSearchUrl(query);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 research-mvp/0.1",
      "Accept-Language": "en-US,en;q=0.9"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Search failed with HTTP ${response.status}`);
  }

  const html = await response.text();
  return filterLowValueResults(parseSearchResults(html)).slice(0, limit);
}

export function buildBingSearchUrl(query: string): string {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("setlang", "en-US");
  url.searchParams.set("cc", "US");
  url.searchParams.set("mkt", "en-US");
  url.searchParams.set("ensearch", "1");
  return url.toString();
}

export function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = parseBingResults(html);
  if (results.length > 0) {
    return results;
  }

  return parseDuckDuckGoResults(html);
}

function parseBingResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = BING_RESULT_PATTERN.exec(html)) !== null) {
    const url = normalizeResultUrl(decodeHtml(match[1]));
    const title = cleanText(stripTags(match[2]));

    if (!url || !title || seen.has(url) || isInternalSearchUrl(url)) {
      continue;
    }

    seen.add(url);
    results.push({ title, url });
  }

  return results;
}

function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = RESULT_LINK_PATTERN.exec(html)) !== null) {
    const url = normalizeResultUrl(decodeHtml(match[1]));
    const title = cleanText(stripTags(match[2]));

    if (!url || !title || seen.has(url)) {
      continue;
    }

    seen.add(url);
    results.push({ title, url });
  }

  return results;
}

function isInternalSearchUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.endsWith("bing.com") || hostname.endsWith("microsoft.com");
  } catch {
    return true;
  }
}

export function filterLowValueResults(results: SearchResult[]): SearchResult[] {
  return results.filter((result) => {
    const combined = `${result.title} ${result.url}`.toLowerCase();
    return !LOW_VALUE_PATTERNS.some((pattern) => pattern.test(combined));
  });
}

const LOW_VALUE_PATTERNS = [
  /iciba\.com/,
  /baike\.baidu\.com/,
  /dictionary\.cambridge\.org/,
  /\/word\?/,
  /是什么意思/,
  /translation/,
  /about australia.*dfat\.gov\.au/,
  /homeaffairs\.gov\.au/,
  /immi\.homeaffairs\.gov\.au/,
  /tourism australia/,
  /australia\.com/
];

function normalizeResultUrl(rawUrl: string): string {
  let url = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;

  try {
    const parsed = new URL(url);
    const wrappedUrl = parsed.searchParams.get("uddg");
    if (wrappedUrl) {
      url = decodeURIComponent(wrappedUrl);
    } else if (isBingRedirectUrl(parsed)) {
      url = decodeBingRedirectUrl(parsed) ?? url;
    }
  } catch {
    return "";
  }

  return url;
}

function isBingRedirectUrl(url: URL): boolean {
  return url.hostname.toLowerCase().endsWith("bing.com") && url.pathname.startsWith("/ck/");
}

function decodeBingRedirectUrl(url: URL): string | null {
  const wrappedUrl = url.searchParams.get("u");
  if (!wrappedUrl) {
    return null;
  }

  const decoded = decodeBingBase64Url(wrappedUrl.startsWith("a1") ? wrappedUrl.slice(2) : wrappedUrl);
  return decoded && isExternalHttpUrl(decoded) ? decoded : null;
}

function decodeBingBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function isExternalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !isInternalSearchUrl(value);
  } catch {
    return false;
  }
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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
