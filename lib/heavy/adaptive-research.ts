import {
  compactError,
  type AgentResearchDecision,
  type AgentResearchStep,
  type AgentResearchStepType,
  type AgentTask,
  type HeavyBudget,
  type HeavySearchProvider,
  type HeavySearchProviderName,
  type HeavySearchResult,
  type HeavySource,
  type ReadAttemptLog,
  type SearchAttemptLog
} from "@/lib/heavy/types";

const MAX_RESEARCH_ROUNDS = 3;
const QUERIES_PER_ROUND = 3;
const FULL_READ_LIMIT_PER_AGENT = 8;

type SearchQuality = "strong" | "mixed" | "weak" | "empty";

export type AdaptiveResearchInput = {
  prompt: string;
  task: AgentTask;
  provider: HeavySearchProvider;
  budget: HeavyBudget;
  onStep?: (step: AgentResearchStep) => void | Promise<void>;
  onSearchLog?: (log: SearchAttemptLog) => void | Promise<void>;
  onReadLog?: (log: ReadAttemptLog) => void | Promise<void>;
};

export type AdaptiveResearchOutput = {
  queries: string[];
  searchResults: HeavySearchResult[];
  selectedResults: HeavySearchResult[];
  searchLogs: SearchAttemptLog[];
  readLogs: ReadAttemptLog[];
  sources: HeavySource[];
  researchSteps: AgentResearchStep[];
};

export async function runAdaptiveResearch(input: AdaptiveResearchInput): Promise<AdaptiveResearchOutput> {
  const localSearchLogs: SearchAttemptLog[] = [];
  const localReadLogs: ReadAttemptLog[] = [];
  const researchSteps: AgentResearchStep[] = [];
  const allQueries: string[] = [];
  const allResults: HeavySearchResult[] = [];
  const discoveredEntities = new Set<string>();

  await emitStep(input, pushStep(researchSteps, {
    type: "intent",
    title: "识别任务意图",
    detail: buildIntentDetail(input.prompt, input.task),
    decision: "continue"
  }));

  let queries = buildAgentQueries(input.prompt, input.task).slice(0, QUERIES_PER_ROUND);
  await emitStep(input, pushStep(researchSteps, {
    type: "query_generation",
    title: "生成第一轮英文关键词",
    detail: "Generated initial English-only search queries from the agent task, questions, search hints, and prompt context.",
    round: 1,
    queries,
    decision: "continue"
  }));

  for (let round = 1; round <= MAX_RESEARCH_ROUNDS; round += 1) {
    const roundResults: HeavySearchResult[] = [];

    for (const query of queries) {
      allQueries.push(query);
      const logStart = localSearchLogs.length;
      const results = await searchWithTrace(input.provider, query, input.budget.maxSourcesPerAgent, localSearchLogs, input.onSearchLog);
      const searchLog = localSearchLogs.slice(logStart).at(-1);
      roundResults.push(...results);
      allResults.push(...results);
      await emitStep(input, pushStep(researchSteps, {
        type: "search",
        title: "执行搜索",
        detail: searchLog?.status === "error"
          ? `Search query failed and adaptive research continued with the remaining queries. Error: ${searchLog.message ?? "unknown error"}.`
          : `Searched one English query and received ${results.length} result${results.length === 1 ? "" : "s"}.`,
        round,
        queries: [query],
        provider: searchLog?.provider ?? inferSearchLogProvider(results),
        engine: searchLog?.engine ?? results.find((result) => result.engine)?.engine,
        resultCount: results.length,
        decision: "continue",
        ...(searchLog?.status === "error" ? { reason: searchLog.message ?? "Search failed." } : {})
      }));
    }

    for (const entity of extractCandidateEntities(roundResults)) {
      discoveredEntities.add(entity);
    }

    const quality = evaluateSearchQuality(roundResults, input.task, discoveredEntities);
    const shouldRevise = quality !== "strong" && round < MAX_RESEARCH_ROUNDS;
    await emitStep(input, pushStep(researchSteps, {
      type: "reflection",
      title: "评估搜索质量",
      detail: buildReflectionDetail(quality, roundResults, discoveredEntities),
      round,
      resultCount: roundResults.length,
      decision: shouldRevise ? "revise_query" : roundResults.length > 0 ? "read_sources" : "stop",
      reason: shouldRevise
        ? "The current round did not provide strong enough evidence, so the next round will revise keywords."
        : "The current round is sufficient to move to source selection or the maximum rounds have been reached."
    }));

    if (!shouldRevise) {
      break;
    }

    queries = reviseQueries(input.prompt, input.task, discoveredEntities, round + 1).slice(0, QUERIES_PER_ROUND);
    await emitStep(input, pushStep(researchSteps, {
      type: "keyword_revision",
      title: "调整关键词",
      detail: "Revised the next search round with discovered candidate entities, task evidence terms, and source targets.",
      round: round + 1,
      queries,
      decision: "revise_query",
      reason: quality === "empty" ? "The previous round returned no usable results." : "The previous round was not strong enough for source reading."
    }));
  }

  const dedupedResultCount = dedupeResults(allResults).length;
  const selectedResults = selectResultsToRead(allResults, input.task, input.budget.maxSourcesPerAgent);
  const fullReadLimit = Math.min(selectedResults.length, FULL_READ_LIMIT_PER_AGENT);
  await emitStep(input, pushStep(researchSteps, {
    type: "source_selection",
    title: "选择来源",
    detail: `Ranked and selected ${selectedResults.length} source${selectedResults.length === 1 ? "" : "s"} from ${dedupedResultCount} deduplicated result${dedupedResultCount === 1 ? "" : "s"}; the strongest ${fullReadLimit} will be full-read and the rest kept as search-snippet sources.`,
    selectedUrls: selectedResults.map((result) => result.url),
    resultCount: selectedResults.length,
    decision: selectedResults.length > 0 ? "read_sources" : "stop",
    reason: "Official, profile, reputable news, and task-relevant evidence pages are preferred over generic pages."
  }));

  const sources: HeavySource[] = [];
  const fullReadResults = selectedResults.slice(0, fullReadLimit);
  const snippetSourceResults = selectedResults.slice(fullReadLimit);
  for (const result of fullReadResults) {
    try {
      const source = await readWithTrace(input.provider, result, localReadLogs, input.onReadLog);
      sources.push(source);
      await emitStep(input, pushStep(researchSteps, {
        type: "read",
        title: "读取来源",
        detail: `Read source content for ${source.title}.`,
        selectedUrls: [source.url],
        provider: source.provider,
        decision: "continue"
      }));
    } catch {
      if (result.snippet) {
        sources.push({
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          provider: result.provider,
          ...(result.engine ? { engine: result.engine } : {})
        });
        await emitStep(input, pushStep(researchSteps, {
          type: "read",
          title: "使用摘要回退",
          detail: `Source reading failed, so snippet fallback was added for ${result.title}.`,
          selectedUrls: [result.url],
          provider: inferReadLogProvider(result.provider),
          decision: "continue",
          reason: "Read failed but the search result included a snippet."
        }));
      }
    }
  }

  for (const result of snippetSourceResults) {
    if (!result.snippet) {
      continue;
    }
    sources.push({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      provider: result.provider,
      ...(result.engine ? { engine: result.engine } : {})
    });
    await emitStep(input, pushStep(researchSteps, {
      type: "read",
      title: "使用搜索摘要作为宽搜索来源",
      detail: `Kept search snippet source without full-page reading for ${result.title}.`,
      selectedUrls: [result.url],
      provider: result.provider,
      decision: "continue",
      reason: "Wide search keeps additional candidates visible while limiting slow full-page reads to the strongest sources."
    }));
  }

  await emitStep(input, pushStep(researchSteps, {
    type: "finalize",
    title: "完成自适应研究",
    detail: `Completed adaptive research with ${allQueries.length} searches, ${selectedResults.length} selected results, and ${sources.length} readable sources.`,
    decision: sources.length > 0 ? "enough_evidence" : "stop"
  }));

  return {
    queries: allQueries.filter(unique),
    searchResults: dedupeResults(allResults),
    selectedResults,
    searchLogs: collectSearchLogs(input.provider, localSearchLogs),
    readLogs: collectReadLogs(input.provider, localReadLogs),
    sources,
    researchSteps
  };
}

export function buildAgentQueries(prompt: string, task: AgentTask): string[] {
  const englishHints = task.searchHints.map(toEnglishSearchText).filter(Boolean);
  const englishQuestions = task.questions.map(toEnglishSearchText).filter(Boolean);
  const englishBase = `${task.id} ${task.role} ${englishHints.join(" ")} ${englishQuestions.join(" ")}`
    .replace(/\s+/g, " ")
    .trim();
  const fallback = `${task.role.replace(/[-_]/g, " ")} research`;
  const userContext = promptToEnglishContext(prompt);
  const queryBase = englishBase || fallback;

  return [
    `${queryBase} ${userContext}`.trim(),
    `${queryBase} official source`.trim(),
    `${queryBase} evidence profile interview article`.trim()
  ].map(toEnglishSearchText).filter(unique).map((query) => query.slice(0, 220));
}

async function searchWithTrace(
  provider: HeavySearchProvider,
  query: string,
  limit: number,
  localSearchLogs: SearchAttemptLog[],
  onSearchLog?: (log: SearchAttemptLog) => void | Promise<void>
): Promise<HeavySearchResult[]> {
  const startedAt = Date.now();
  try {
    const results = await provider.search(query, limit);
    await drainAndEmitSearchLogs(provider, localSearchLogs, onSearchLog);
    await addSearchLog(localSearchLogs, {
      provider: inferSearchLogProvider(results),
      query,
      status: results.length > 0 ? "done" : "empty",
      results,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    }, onSearchLog);
    return results;
  } catch (error) {
    await drainAndEmitSearchLogs(provider, localSearchLogs, onSearchLog);
    await addSearchLog(localSearchLogs, {
      provider: "test",
      query,
      status: "error",
      results: [],
      message: compactError(error instanceof Error ? error.message : "Search failed"),
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    }, onSearchLog);
    return [];
  }
}

async function readWithTrace(
  provider: HeavySearchProvider,
  result: HeavySearchResult,
  localReadLogs: ReadAttemptLog[],
  onReadLog?: (log: ReadAttemptLog) => void | Promise<void>
): Promise<HeavySource> {
  const startedAt = Date.now();
  try {
    const source = await provider.read(result);
    await drainAndEmitReadLogs(provider, localReadLogs, onReadLog);
    await addReadLog(localReadLogs, {
      provider: inferReadLogProvider(source.provider),
      status: "done",
      title: source.title,
      url: source.url,
      readCharCount: source.readCharCount ?? source.fullText?.length ?? source.snippet.length,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    }, onReadLog);
    return source;
  } catch (error) {
    await drainAndEmitReadLogs(provider, localReadLogs, onReadLog);
    await addReadLog(localReadLogs, {
      provider: inferReadLogProvider(result.provider),
      status: "error",
      title: result.title,
      url: result.url,
      message: compactError(error instanceof Error ? error.message : "Read failed"),
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    }, onReadLog);
    throw error;
  }
}

async function drainAndEmitSearchLogs(
  provider: HeavySearchProvider,
  localSearchLogs: SearchAttemptLog[],
  onSearchLog?: (log: SearchAttemptLog) => void | Promise<void>
): Promise<SearchAttemptLog[]> {
  const logs = provider.drainSearchLogs?.() ?? [];
  for (const log of logs) {
    await addSearchLog(localSearchLogs, log, onSearchLog);
  }
  return logs;
}

async function drainAndEmitReadLogs(
  provider: HeavySearchProvider,
  localReadLogs: ReadAttemptLog[],
  onReadLog?: (log: ReadAttemptLog) => void | Promise<void>
): Promise<ReadAttemptLog[]> {
  const logs = provider.drainReadLogs?.() ?? [];
  for (const log of logs) {
    await addReadLog(localReadLogs, log, onReadLog);
  }
  return logs;
}

async function addSearchLog(
  localSearchLogs: SearchAttemptLog[],
  log: SearchAttemptLog,
  onSearchLog?: (log: SearchAttemptLog) => void | Promise<void>
): Promise<void> {
  localSearchLogs.push(log);
  await emitSearchLog(onSearchLog, log);
}

async function addReadLog(
  localReadLogs: ReadAttemptLog[],
  log: ReadAttemptLog,
  onReadLog?: (log: ReadAttemptLog) => void | Promise<void>
): Promise<void> {
  localReadLogs.push(log);
  await emitReadLog(onReadLog, log);
}

async function emitStep(input: AdaptiveResearchInput, step: AgentResearchStep): Promise<void> {
  try {
    await input.onStep?.(step);
  } catch {
    // Live progress is observational; the agent report remains the source of truth.
  }
}

async function emitSearchLog(onSearchLog: AdaptiveResearchInput["onSearchLog"], log: SearchAttemptLog): Promise<void> {
  try {
    await onSearchLog?.(log);
  } catch {
    // Search logging must not break the research loop.
  }
}

async function emitReadLog(onReadLog: AdaptiveResearchInput["onReadLog"], log: ReadAttemptLog): Promise<void> {
  try {
    await onReadLog?.(log);
  } catch {
    // Read logging must not break source extraction.
  }
}

function collectSearchLogs(provider: HeavySearchProvider, localSearchLogs: SearchAttemptLog[]): SearchAttemptLog[] {
  const providerLogs = provider.drainSearchLogs?.() ?? [];
  return mergeExactLogs(providerLogs, localSearchLogs);
}

function collectReadLogs(provider: HeavySearchProvider, localReadLogs: ReadAttemptLog[]): ReadAttemptLog[] {
  const providerLogs = provider.drainReadLogs?.() ?? [];
  return mergeExactLogs(providerLogs, localReadLogs);
}

function mergeExactLogs<T>(providerLogs: T[], localLogs: T[]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const log of [...providerLogs, ...localLogs]) {
    const key = JSON.stringify(log);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(log);
  }
  return merged;
}

function inferSearchLogProvider(results: HeavySearchResult[]): SearchAttemptLog["provider"] {
  const provider = results[0]?.provider;
  return provider === "relay" || provider === "opencli" || provider === "web" || provider === "test" ? provider : "test";
}

function inferReadLogProvider(provider: HeavySearchProviderName): ReadAttemptLog["provider"] {
  return provider === "opencli" || provider === "fetch" || provider === "test" ? provider : "test";
}

function buildIntentDetail(prompt: string, task: AgentTask): string {
  const context = promptToEnglishContext(prompt) || "general research context";
  return `Task "${task.title}" should answer: ${task.objective}. English context: ${context}.`;
}

function evaluateSearchQuality(results: HeavySearchResult[], task: AgentTask, entities: Set<string>): SearchQuality {
  const deduped = dedupeResults(results);
  if (deduped.length === 0) {
    return "empty";
  }

  const score = deduped.reduce((total, result) => total + scoreResult(result, task, entities), 0);
  const officialCount = deduped.filter(isOfficialLike).length;

  if (deduped.length >= 2 && (score >= 18 || (officialCount >= 1 && score >= 12))) {
    return "strong";
  }
  if (score >= 8 || officialCount > 0 || entities.size > 0) {
    return "mixed";
  }
  return "weak";
}

function scoreResult(result: HeavySearchResult, task: AgentTask, entities: Set<string>): number {
  const text = resultText(result);
  let score = 0;

  if (isOfficialLike(result)) {
    score += 8;
  }
  if (/linkedin\.com/i.test(result.url)) {
    score += 7;
  }
  if (/businessnews|forbes|techcrunch|afr|smartcompany|startupdaily|news|funding/i.test(result.url)) {
    score += 6;
  }
  if (/(ceo|founder|co-founder|leadership|profile|interview|article|blog|funding|series a|robotics|hardware|product|ai|artificial intelligence)/i.test(text)) {
    score += 5;
  }

  for (const term of taskEvidenceTerms(task)) {
    if (text.includes(term.toLowerCase())) {
      score += 2;
    }
  }
  for (const entity of entities) {
    if (text.includes(entity.toLowerCase())) {
      score += 2;
    }
  }
  if (/seo\.example|listicle|top startups list/i.test(text)) {
    score -= 5;
  }

  return score;
}

function buildReflectionDetail(quality: SearchQuality, results: HeavySearchResult[], entities: Set<string>): string {
  const entityText = Array.from(entities).slice(0, 4).join(", ") || "none yet";
  return `Round quality is ${quality}. It produced ${results.length} raw results and discovered candidate entities: ${entityText}.`;
}

function reviseQueries(prompt: string, task: AgentTask, entities: Set<string>, round: number): string[] {
  const entityText = Array.from(entities).slice(0, 4).join(" ");
  const evidenceTerms = taskEvidenceTerms(task).join(" ");
  const sourceTerms = sourceTargetTerms(task).join(" ");
  const context = promptToEnglishContext(prompt);
  const base = [entityText, evidenceTerms, context].filter(Boolean).join(" ").trim();
  const fallbackBase = `${task.role.replace(/[-_]/g, " ")} ${evidenceTerms} ${context}`.trim();
  const queryBase = base || fallbackBase || "CEO company research";

  return [
    `${queryBase} ${sourceTerms}`,
    `${entityText || queryBase} official company leadership ${evidenceTerms}`,
    `${entityText || queryBase} interview article profile funding AI hardware round ${round}`
  ].map(toEnglishSearchText).filter(unique).map((query) => query.slice(0, 220));
}

function taskEvidenceTerms(task: AgentTask): string[] {
  const text = `${task.id} ${task.role} ${task.title} ${task.objective} ${task.questions.join(" ")} ${task.searchHints.join(" ")}`.toLowerCase();
  const terms = new Set<string>();

  if (/identity|person|ceo|founder|身份/.test(text)) {
    terms.add("CEO");
    terms.add("founder");
    terms.add("leadership");
  }
  if (/tenure|role|任职|year|three/.test(text)) {
    terms.add("appointed CEO");
    terms.add("founded year");
    terms.add("over the last three years");
  }
  if (/company|fit|hardware|画像|robot/.test(text)) {
    terms.add("hardware product");
    terms.add("robotics");
    terms.add("official");
  }
  if (/growth|funding|增长|revenue|headcount/.test(text)) {
    terms.add("annual growth");
    terms.add("funding");
    terms.add("Series A");
  }
  if (/article|ai|opinion|观点|interview/.test(text)) {
    terms.add("AI article");
    terms.add("artificial intelligence");
    terms.add("LinkedIn post");
    terms.add("interview");
  }
  if (/exclude|risk|medical|solar|heavy|排除/.test(text)) {
    terms.add("medical device");
    terms.add("solar panel");
    terms.add("heavy manufacturing");
  }

  const direct = toEnglishSearchText(task.searchHints.join(" "));
  if (direct) {
    terms.add(direct);
  }
  return Array.from(terms);
}

function sourceTargetTerms(task: AgentTask): string[] {
  const text = `${task.id} ${task.role} ${task.objective}`.toLowerCase();
  const terms = new Set(["official source"]);

  if (/article|ai|opinion|interview/.test(text)) {
    terms.add("LinkedIn post");
    terms.add("blog interview");
  }
  if (/growth|funding|company|fit|hardware/.test(text)) {
    terms.add("company news funding product");
  }
  if (/tenure|role|identity|ceo|founder/.test(text)) {
    terms.add("leadership profile founder CEO");
  }

  return Array.from(terms);
}

function extractCandidateEntities(results: HeavySearchResult[]): string[] {
  const entities: string[] = [];
  const blocked = new Set([
    "Australia",
    "Australian",
    "AI",
    "CEO",
    "Series",
    "LinkedIn",
    "Business News Australia",
    "Top"
  ]);

  for (const result of results) {
    const text = `${result.title} ${result.snippet ?? ""}`;
    const matches = text.match(/\b[A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|AI|Robotics|Technologies|Labs|Systems|Devices|Group|Company|Industries)){1,3}\b/g) ?? [];
    for (const match of matches) {
      const cleaned = match.replace(/\s+/g, " ").trim();
      if (!blocked.has(cleaned) && !entities.some((entity) => entity.toLowerCase() === cleaned.toLowerCase())) {
        entities.push(cleaned);
      }
    }
  }

  return entities.slice(0, 8);
}

function selectResultsToRead(results: HeavySearchResult[], task: AgentTask, limit: number): HeavySearchResult[] {
  return dedupeResults(results)
    .map((result, index) => ({ result, index, score: scoreForReadSelection(result, task) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((item) => item.result);
}

function scoreForReadSelection(result: HeavySearchResult, task: AgentTask): number {
  let score = scoreResult(result, task, new Set());
  const url = result.url.toLowerCase();
  const text = resultText(result);

  if (isOfficialLike(result)) {
    score += 40;
  }
  if (url.includes("linkedin.com")) {
    score += 32;
  }
  if (/businessnewsaustralia|afr\.com|smartcompany|startupdaily|techcrunch|forbes/.test(url)) {
    score += 24;
  }
  if (/funding|series a|raises|valuation/.test(text)) {
    score += 8;
  }
  if (/seo\.example|generic listicle|top startups list/.test(text)) {
    score -= 40;
  }

  return score;
}

function isOfficialLike(result: HeavySearchResult): boolean {
  try {
    const host = new URL(result.url).hostname.replace(/^www\./, "").toLowerCase();
    if (isGenericOfficialHost(host)) {
      return false;
    }

    const hostIdentity = hostIdentityText(host);
    const officialText = compactIdentityText(`${result.title} ${result.snippet ?? ""}`);
    return hostIdentity.length >= 5 && officialText.includes(hostIdentity);
  } catch {
    return false;
  }
}

function isGenericOfficialHost(host: string): boolean {
  return /(^|\.)((linkedin|facebook|instagram|youtube|twitter|medium|substack|crunchbase|angel|wellfound|apollo|rocketreach|zoominfo|owler|profiles?|directory|listings?|seo|example)\.)|(^|\.)(x\.com)$|news|forbes|techcrunch|businessnewsaustralia|afr\.com|smartcompany|startupdaily/i.test(host);
}

function hostIdentityText(host: string): string {
  const parts = host.split(".").filter(Boolean);
  const domain = parts.length >= 2 ? parts.at(-2) ?? parts[0] : parts[0] ?? "";
  return compactIdentityText(domain);
}

function compactIdentityText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function dedupeResults(results: HeavySearchResult[]): HeavySearchResult[] {
  const seenUrls = new Set<string>();
  return results.filter((result) => {
    const key = result.url.toLowerCase().replace(/\/$/, "");
    if (seenUrls.has(key)) {
      return false;
    }
    seenUrls.add(key);
    return true;
  });
}

function pushStep(
  steps: AgentResearchStep[],
  step: Omit<AgentResearchStep, "id" | "timestamp"> & { type: AgentResearchStepType; decision?: AgentResearchDecision }
): AgentResearchStep {
  const nextStep: AgentResearchStep = {
    id: `step_${steps.length + 1}`,
    timestamp: new Date().toISOString(),
    ...step,
    ...(step.queries ? { queries: step.queries.map(toEnglishSearchText).filter(Boolean) } : {}),
    ...(step.selectedUrls ? { selectedUrls: step.selectedUrls.filter(isHttpUrl) } : {})
  };
  steps.push(nextStep);
  return nextStep;
}

function toEnglishSearchText(value: string): string {
  return removeCjk(value)
    .replace(/[^a-zA-Z0-9 .,'"&:%/+_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function removeCjk(value: string): string {
  return value.replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ");
}

function promptToEnglishContext(prompt: string): string {
  const lower = prompt.toLowerCase();
  const terms = new Set<string>();

  if (/ceo|创始|高管|公司/.test(lower)) {
    terms.add("CEO founder company profile");
  }
  if (/澳大利亚|australia|australian/.test(lower)) {
    terms.add("Australia Australian");
  }
  if (/硬件|hardware|robot|robotics|device/.test(lower)) {
    terms.add("innovative hardware robotics product");
  }
  if (/ai|人工智能/.test(lower)) {
    terms.add("AI article interview opinion");
  }
  if (/增长|growth|30/.test(lower)) {
    terms.add("annual growth revenue headcount funding");
  }
  if (/医疗|medical|solar|太阳能|重工|heavy/.test(lower)) {
    terms.add("exclude medical device solar panel heavy manufacturing");
  }

  const directEnglish = toEnglishSearchText(prompt);
  if (directEnglish) {
    terms.add(directEnglish);
  }

  return Array.from(terms).join(" ");
}

function resultText(result: HeavySearchResult): string {
  return `${result.title} ${result.snippet ?? ""} ${result.url}`.toLowerCase();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function unique(value: string, index: number, values: string[]): boolean {
  return value.trim().length > 0 && values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index;
}
