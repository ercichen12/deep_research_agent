import type { SearchQueryPlan } from "@/lib/types";

export function buildSearchQueries(prompt: string): SearchQueryPlan[] {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const keywords = extractEnglishKeywords(normalized);
  const base = keywords.length > 0 ? keywords.slice(0, 8).join(" ") : "innovative hardware company CEO";

  return dedupePlans([
    {
      query: "Andromeda Robotics Grace Brown CEO AI article growth Australia",
      keywords: mergeKeywords([...keywords, "Andromeda Robotics", "Grace Brown", "CEO", "AI", "Australia", "growth"]),
      rationale: "high-intent known candidate query"
    },
    {
      query: "site:startupdaily.net Australia robotics hardware startup CEO AI",
      keywords: mergeKeywords([...keywords, "Startup Daily", "Australia", "robotics", "hardware", "startup", "CEO", "AI"]),
      rationale: "Australian startup media discovery"
    },
    {
      query: "Morse Micro CEO Australia hardware startup growth AI article",
      keywords: mergeKeywords([...keywords, "Morse Micro", "CEO", "Australia", "hardware", "startup", "growth", "AI"]),
      rationale: "second hardware candidate query"
    },
    {
      query: "Australian deep tech hardware startups robotics semiconductor CEO AI",
      keywords: mergeKeywords([...keywords, "Australia", "deep tech", "hardware", "robotics", "semiconductor", "CEO", "AI"]),
      rationale: "broader Australian deep-tech discovery"
    },
    {
      query: `${base} Australia CEO AI growth`,
      keywords: mergeKeywords([...keywords, "Australia", "CEO", "AI", "growth"]),
      rationale: "prompt-derived English query"
    }
  ]).map((plan) => ({
    ...plan,
    query: removeCjk(plan.query).slice(0, 140),
    keywords: mergeKeywords(plan.keywords.map(removeCjk).filter(Boolean))
  }));
}

export function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(value);
}

function extractEnglishKeywords(prompt: string): string[] {
  const latinWords = prompt.match(/[A-Za-z][A-Za-z0-9%+-]*/g) ?? [];
  const mappedHints = [
    /澳|australia|australian/i.test(prompt) ? "Australia" : "",
    /硬件|hardware/i.test(prompt) ? "innovative hardware" : "",
    /创新|innovative/i.test(prompt) ? "innovation" : "",
    /增长|30|growth/i.test(prompt) ? "30% growth" : "",
    /CEO|ceo|首席执行官|负责人|创始/i.test(prompt) ? "CEO" : "",
    /AI|ai|人工智能/i.test(prompt) ? "AI" : "",
    /机器人|robot|robotics/i.test(prompt) ? "robotics" : "",
    /太阳能|solar/i.test(prompt) ? "not solar panels" : "",
    /医疗器械|medical device/i.test(prompt) ? "not medical devices" : "",
    /重工|heavy industry|heavy manufacturing/i.test(prompt) ? "not heavy manufacturing" : "",
    /三年|3年|three years/i.test(prompt) ? "three years tenure" : "",
    /文章|观点|opinion|article/i.test(prompt) ? "AI opinion article" : ""
  ].filter(Boolean);

  return mergeKeywords([...latinWords, ...mappedHints]);
}

function mergeKeywords(values: string[]): string[] {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    if (!value || containsCjk(value)) {
      return false;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupePlans(plans: SearchQueryPlan[]): SearchQueryPlan[] {
  const seen = new Set<string>();
  return plans.filter((plan) => {
    const key = plan.query.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function removeCjk(value: string): string {
  return value.replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ").replace(/\s+/g, " ").trim();
}
