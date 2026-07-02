import { runDeepResearchLoop, type DeepResearchEvaluation, type DeepResearchEvaluationInput } from "@/lib/deep-research-loop";
import { buildSearchQueries, containsCjk } from "@/lib/query";
import { createChatCompletion, getOpenAIConfig, type ChatCompletionResult } from "@/lib/openai";
import {
  type OpenCliSearchEngine,
  isOpenCliBridgeError,
  isOpenCliEmptyResult,
  readWithOpenCli,
  searchWithOpenCli
} from "@/lib/opencli";
import { createResearchRunId, writeResearchRunLog } from "@/lib/research-log";
import { getSeedSources } from "@/lib/seeds";
import { searchWeb } from "@/lib/search";
import { fetchSource } from "@/lib/source";
import type {
  ConditionMatrixEntry,
  ResearchCandidate,
  ResearchIteration,
  ResearchResponse,
  ResearchSource,
  ResearchStep,
  ResearchStreamEvent,
  SearchLogEntry,
  SearchQueryPlan,
  SearchResult
} from "@/lib/types";

const MAX_SOURCES = 8;
const MAX_ITERATIONS = 4;
const QUERIES_PER_ITERATION = 3;
const RESULTS_PER_ITERATION = 20;
const SEARCH_RESULTS_PER_ENGINE = 4;
const MIN_USEFUL_SNIPPET_CHARS = 120;
const PAGE_READER_TEMPERATURE = 0.1;
const EVALUATOR_TEMPERATURE = 0.1;

export type SourceReaders = {
  openCli: (result: SearchResult) => Promise<ResearchSource>;
  fetch: (result: SearchResult) => Promise<ResearchSource>;
};

export type SourceAnalysisOptions = {
  readers?: SourceReaders;
  analyze?: (prompt: string, source: ResearchSource) => Promise<string>;
};

export type ReportGeneratorInput = {
  prompt: string;
  sources: ResearchSource[];
  iterations: ResearchIteration[];
  candidates: ResearchCandidate[];
  conditionMatrix: ConditionMatrixEntry[];
};

export type RunResearchOptions = {
  createRunId?: () => string;
  buildInitialQueries?: (prompt: string) => SearchQueryPlan[];
  search?: (
    queryPlan: SearchQueryPlan,
    iteration: number,
    steps: ResearchStep[],
    searchLogs: SearchLogEntry[],
    emit?: (event: ResearchStreamEvent) => Promise<void>
  ) => Promise<SearchResult[]>;
  read?: (prompt: string, result: SearchResult, iteration: number) => Promise<ResearchSource>;
  evaluate?: (input: DeepResearchEvaluationInput) => Promise<DeepResearchEvaluation>;
  generateReport?: (input: ReportGeneratorInput) => Promise<ChatCompletionResult>;
  writeLog?: typeof writeResearchRunLog;
  maxIterations?: number;
  queriesPerIteration?: number;
  resultsPerIteration?: number;
  onEvent?: (event: ResearchStreamEvent) => void | Promise<void>;
};

export async function runResearch(prompt: string, options: RunResearchOptions = {}): Promise<ResearchResponse> {
  const runId = options.createRunId?.() ?? createResearchRunId();
  const steps: ResearchStep[] = [];
  const queries = (options.buildInitialQueries ?? buildSearchQueries)(prompt);
  const searchLogs: SearchLogEntry[] = [];
  const emit = createEventEmitter(options.onEvent);

  await emit({
    type: "run_started",
    runId,
    timestamp: new Date().toISOString()
  });

  await addStep(
    steps,
    "第 1 轮搜索计划",
    queries
      .map((item, index) => `${index + 1}. 关键词：${item.keywords.join(", ")}\n查询：${item.query}\n目的：${item.rationale}`)
      .join("\n\n"),
    "done",
    emit
  );

  const seedResults = getSeedSources(prompt);
  if (seedResults.length > 0) {
    await addStep(steps, "加入候选源", `根据需求加入 ${seedResults.length} 个高意图候选来源。`, "done", emit);
  }

  const loop = await runDeepResearchLoop({
    prompt,
    initialQueries: queries,
    maxIterations: options.maxIterations ?? MAX_ITERATIONS,
    queriesPerIteration: options.queriesPerIteration ?? QUERIES_PER_ITERATION,
    resultsPerIteration: options.resultsPerIteration ?? RESULTS_PER_ITERATION,
    search: async (queryPlan, iteration) => {
      const search = options.search ?? searchQueryWithFallback;
      const results = await search(queryPlan, iteration, steps, searchLogs, emit);
      if (options.search) {
        const entry: SearchLogEntry = {
          engine: "injected",
          query: queryPlan.query,
          keywords: queryPlan.keywords,
          iteration,
          status: results.length > 0 ? "done" : "empty",
          results,
          timestamp: new Date().toISOString()
        };
        searchLogs.push(entry);
        await emit({ type: "search_done", iteration, log: entry, timestamp: new Date().toISOString() });
      }
      return iteration === 1 ? [...seedResults, ...results] : results;
    },
    read: async (result, iteration) => {
      let source: ResearchSource;
      if (options.read) {
        source = await options.read(prompt, result, iteration);
      } else {
        source = await defaultReadAndAnalyzeSource(prompt, result, iteration, steps, emit);
      }
      await emit({ type: "read_done", iteration, source, timestamp: new Date().toISOString() });
      return source;
    },
    evaluate: async (input) => {
      const evaluate = options.evaluate ?? evaluateIterationWithModel;
      await addStep(steps, `第 ${input.iteration} 轮阶段判断`, `读取 ${input.readSources.length} 个来源后，整理候选与证据缺口。`, "running", emit);
      const evaluation = await evaluate(input);
      await updateLastStep(steps, formatEvaluationSummary(evaluation), "done", emit);
      return evaluation;
    }
  });

  for (const iteration of loop.iterations) {
    await emit({ type: "iteration_done", iteration, timestamp: new Date().toISOString() });
  }

  const sources = mergeSources(loop.sources);

  if (sources.length === 0) {
    throw new Error("没有成功读取到可用于生成报告的网页来源");
  }

  await addStep(steps, "生成报告", "调用 OpenAI-compatible Chat Completions 生成中文研究报告。", "running", emit);
  const completion = await generateFinalReport(prompt, sources, loop.iterations, loop.candidates, loop.conditionMatrix, options.generateReport);
  await updateLastStep(steps, `报告生成完成，模型：${completion.model}`, "done", emit);
  await emit({ type: "report_done", report: completion.content, model: completion.model, timestamp: new Date().toISOString() });

  const usedQueries = uniqueQueries(loop.iterations.flatMap((iteration) => iteration.queries));
  const response: ResearchResponse = {
    report: completion.content,
    steps,
    sources,
    model: completion.model,
    queries: usedQueries,
    searchLogs,
    iterations: loop.iterations,
    candidates: loop.candidates,
    conditionMatrix: loop.conditionMatrix,
    stopReason: loop.stopReason
  };

  const writeLog = options.writeLog ?? writeResearchRunLog;
  const searchLogPath = await writeLog({
    runId,
    createdAt: new Date().toISOString(),
    prompt,
    queries: usedQueries,
    searchLogs,
    iterations: loop.iterations,
    candidates: loop.candidates,
    conditionMatrix: loop.conditionMatrix,
    stopReason: loop.stopReason,
    selectedSources: sources,
    model: completion.model,
    report: completion.content
  });

  await addStep(steps, "保存搜索日志", searchLogPath, "done", emit);
  await emit({ type: "log_saved", path: searchLogPath, timestamp: new Date().toISOString() });

  const finalResponse = {
    ...response,
    steps,
    searchLogPath
  };
  await emit({ type: "final", result: finalResponse, timestamp: new Date().toISOString() });

  return finalResponse;
}

async function searchQueryWithFallback(
  queryPlan: SearchQueryPlan,
  iteration: number,
  steps: ResearchStep[],
  searchLogs: SearchLogEntry[],
  emit?: (event: ResearchStreamEvent) => Promise<void>
): Promise<SearchResult[]> {
  const openCliResults = await searchQueryWithOpenCli(queryPlan, steps, searchLogs, iteration, emit);

  if (openCliResults.length > 0) {
    return openCliResults;
  }

  try {
    await addStep(steps, `第 ${iteration} 轮 Bing 海外兜底搜索`, formatSearchSummary({ ...baseLog(queryPlan, "bing", iteration), status: "done", results: [] }), "running");
    const results = await searchWeb(queryPlan.query, 8);
    const entry: SearchLogEntry = {
      ...baseLog(queryPlan, "bing", iteration),
      status: results.length > 0 ? "done" : "empty",
      results,
      message: results.length > 0 ? undefined : "Bing overseas returned no parsed results"
    };
    searchLogs.push(entry);
    await emit?.({ type: "search_done", iteration, log: entry, timestamp: new Date().toISOString() });
    await updateLastStep(steps, formatSearchSummary(entry), "done");
    return results;
  } catch (error) {
    const entry: SearchLogEntry = {
      ...baseLog(queryPlan, "bing", iteration),
      status: "error",
      results: [],
      message: safeErrorMessage(error)
    };
    searchLogs.push(entry);
    await emit?.({ type: "search_done", iteration, log: entry, timestamp: new Date().toISOString() });
    await updateLastStep(steps, formatSearchSummary(entry), "error");
    return [];
  }
}

async function searchQueryWithOpenCli(
  queryPlan: SearchQueryPlan,
  steps: ResearchStep[],
  searchLogs: SearchLogEntry[],
  iteration = 1,
  emit?: (event: ResearchStreamEvent) => Promise<void>
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  for (const engine of getOpenCliSearchEngines()) {
    try {
      await addStep(steps, `第 ${iteration} 轮 OpenCLI ${engine} 英文搜索`, formatSearchSummary({ ...baseLog(queryPlan, engine, iteration), status: "done", results: [] }), "running");
      const engineResults = await searchWithOpenCli(engine, queryPlan.query, SEARCH_RESULTS_PER_ENGINE);
      results.push(...engineResults);
      const entry: SearchLogEntry = {
        ...baseLog(queryPlan, engine, iteration),
        status: engineResults.length > 0 ? "done" : "empty",
        results: engineResults,
        message: engineResults.length > 0 ? undefined : `${engine} returned 0 parsed results`
      };
      searchLogs.push(entry);
      await emit?.({ type: "search_done", iteration, log: entry, timestamp: new Date().toISOString() });
      await updateLastStep(steps, formatSearchSummary(entry), "done");
    } catch (error) {
      const message = safeErrorMessage(error);
      const status = isOpenCliEmptyResult(message) ? "empty" : "error";
      const entry: SearchLogEntry = {
        ...baseLog(queryPlan, engine, iteration),
        status,
        results: [],
        message: humanizeSearchError(message, engine)
      };
      searchLogs.push(entry);
      await emit?.({ type: "search_done", iteration, log: entry, timestamp: new Date().toISOString() });
      if (isOpenCliEmptyResult(message)) {
        await updateLastStep(steps, formatSearchSummary(entry), "done");
      } else {
        await updateLastStep(steps, formatSearchSummary(entry), "error");
      }
    }
  }

  return results;
}

export function humanizeSearchError(message: string, engine: string): string {
  if (isOpenCliBridgeError(message)) {
    return "OpenCLI Browser Bridge 未连接，跳过此引擎。";
  }

  if (isOpenCliEmptyResult(message)) {
    return `${formatEngineName(engine)} returned 0 parsed results for this exact query; continuing with other engines.`;
  }

  return compactErrorMessage(message);
}

export function getOpenCliSearchEngines(): OpenCliSearchEngine[] {
  return ["google", "brave", "duckduckgo"];
}

export function formatSearchSummary(entry: Omit<SearchLogEntry, "timestamp"> | SearchLogEntry): string {
  const lines = [
    ...(typeof entry.iteration === "number" ? [`轮次：${entry.iteration}`] : []),
    `关键词：${entry.keywords.join(", ")}`,
    `查询：${entry.query}`,
    `引擎：${entry.engine}`,
    `状态：${entry.status}`
  ];

  if (entry.results.length > 0) {
    lines.push(
      `结果：${entry.results.length} 个`,
      ...entry.results.slice(0, 5).map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}`)
    );
  } else {
    lines.push(`结果：0 个`, `说明：${entry.message ?? "No parsed results returned"}`);
  }

  return lines.join("\n");
}

export async function readSource(
  result: SearchResult,
  readers: SourceReaders = { openCli: readWithOpenCli, fetch: fetchSource }
): Promise<ResearchSource> {
  try {
    const source = await readers.openCli(result);
    if (isUsefulSnippet(source.snippet)) {
      return source;
    }

    try {
      return await readers.fetch(result);
    } catch {
      return source;
    }
  } catch {
    return readers.fetch(result);
  }
}

export async function readAndAnalyzeSource(
  userPrompt: string,
  result: SearchResult,
  options: SourceAnalysisOptions = {}
): Promise<ResearchSource> {
  const source = await readSource(result, options.readers);
  const analyze = options.analyze ?? analyzeSourceWithPageReader;
  const evidenceNote = await analyze(userPrompt, source).catch(() => source.snippet);
  const cleanedEvidence = evidenceNote.trim();

  return {
    ...source,
    snippet: cleanedEvidence || source.snippet,
    evidenceCharCount: cleanedEvidence.length
  };
}

async function defaultReadAndAnalyzeSource(
  prompt: string,
  result: SearchResult,
  iteration: number,
  steps: ResearchStep[]
  ,
  emit?: (event: ResearchStreamEvent) => Promise<void>
): Promise<ResearchSource> {
  await addStep(steps, `第 ${iteration} 轮读取网页`, `${result.title}\n${result.url}`, "running", emit);
  try {
    const source = await readAndAnalyzeSource(prompt, result);
    await updateLastStep(
      steps,
      `已读取 ${source.readCharCount ?? source.fullText?.length ?? source.snippet.length} 字符原文，page-reader 提炼 ${
        source.evidenceCharCount ?? source.snippet.length
      } 字符证据笔记。`,
      "done",
      emit
    );
    return source;
  } catch (error) {
    await updateLastStep(steps, `${result.url}\n${safeErrorMessage(error)}`, "error", emit);
    throw error;
  }
}

export function buildPageReaderPrompt(userPrompt: string, source: ResearchSource): string {
  const fullText = source.fullText ?? source.snippet;

  return `你是网页级研究子代理。你的任务是完整阅读单个网页，并只根据这个网页提取对用户需求有用的证据。不要引入其他网页信息，不要编造。

用户需求：
${userPrompt}

网页元信息：
title: ${source.title}
url: ${source.url}
rawCharCount: ${source.rawCharCount ?? fullText.length}
readCharCount: ${source.readCharCount ?? fullText.length}
extractionMethod: ${source.extractionMethod ?? "unknown"}

请输出中文结构化证据笔记：
1. 这个网页能直接支持的事实
2. 与 CEO / 公司 / 创新硬件 / 澳大利亚 / 任职年限 / 增长 / AI 观点 / 排除项相关的证据
3. 原文没有支持、需要标记不确定的点
4. 适合最终报告引用的短证据句

要求：
- 只写这个网页中能找到的内容
- 对没有证据的条件写“本页未证实”
- 保留关键数字、日期、职位、公司名、地点
- 不要输出泛泛总结

网页全文：
${fullText}`;
}

async function analyzeSourceWithPageReader(userPrompt: string, source: ResearchSource): Promise<string> {
  const config = getOpenAIConfig();
  const completion = await createChatCompletion({
    ...config,
    temperature: PAGE_READER_TEMPERATURE,
    messages: [
      {
        role: "system",
        content:
          "你是严谨的网页级研究子代理，只基于单页原文提取证据。缺少证据时必须明确说本页未证实。输出要适合作为实时研究日志展示，避免冗长铺陈。"
      },
      {
        role: "user",
        content: buildPageReaderPrompt(userPrompt, source)
      }
    ]
  });

  return completion.content;
}

export function selectResearchResults(
  seedResults: SearchResult[],
  searchResults: SearchResult[],
  maxSources = MAX_SOURCES
): SearchResult[] {
  const reservedSearchSlots = searchResults.length > 0 ? Math.min(3, searchResults.length, maxSources) : 0;
  const seedSlots = Math.max(0, maxSources - reservedSearchSlots);
  const selectedSeeds = dedupeResults(seedResults).slice(0, seedSlots);
  const selectedSearch = dedupeResults(searchResults).slice(0, maxSources - selectedSeeds.length);

  return dedupeResults([...selectedSeeds, ...selectedSearch]).slice(0, maxSources);
}

async function evaluateIterationWithModel(input: DeepResearchEvaluationInput): Promise<DeepResearchEvaluation> {
  const config = getOpenAIConfig();
  const completion = await createChatCompletion({
    ...config,
    temperature: EVALUATOR_TEMPERATURE,
    messages: [
      {
        role: "system",
        content:
          "你是严谨的研究控制器。你不输出隐藏推理，只输出可审计的阶段判断 JSON。所有 nextQueries 必须是英文。缺少证据时标 unknown。"
      },
      {
        role: "user",
        content: buildIterationEvaluatorPrompt(input)
      }
    ]
  });

  return parseEvaluationJson(completion.content);
}

function buildIterationEvaluatorPrompt(input: DeepResearchEvaluationInput): string {
  const sourceText = input.readSources
    .map(
      (source, index) => `[${index + 1}] ${source.title}
URL: ${source.url}
Evidence note: ${source.snippet}`
    )
    .join("\n\n");
  const previousCandidates = JSON.stringify(input.previousCandidates, null, 2);
  const previousMatrix = JSON.stringify(input.previousConditionMatrix, null, 2);

  return `User research request:
${input.prompt}

Current iteration: ${input.iteration}

Search queries used:
${input.queries.map((query, index) => `${index + 1}. ${query.query} -- ${query.rationale}`).join("\n")}

Read source evidence notes:
${sourceText || "No sources were successfully read in this iteration."}

Previous candidates:
${previousCandidates}

Previous condition matrix:
${previousMatrix}

Return strict JSON only, with this shape:
{
  "summary": "Chinese stage conclusion for realtime display, concise and auditable",
  "candidates": [
    {
      "person": "CEO/person name",
      "company": "Company name",
      "status": "candidate|rejected|winner|unknown",
      "rationale": "Chinese rationale grounded in read sources"
    }
  ],
  "conditionMatrix": [
    {
      "candidate": "Person / Company",
      "condition": "One user condition",
      "status": "confirmed|contradicted|unknown|partial",
      "evidence": "Evidence or why it remains unknown",
      "sourceUrls": ["https://..."]
    }
  ],
  "nextQueries": [
    {
      "query": "English search query only",
      "keywords": ["English", "keywords"],
      "rationale": "Why this query closes an evidence gap"
    }
  ],
  "nextQueryReason": "Chinese reason for the next search wave, or empty string",
  "stopReason": "Use no_new_high_value_leads, all_key_conditions_verified, no_next_queries, or empty string"
}

Rules:
- Do not invent facts.
- summary and nextQueryReason are visible realtime research logs; keep them concise, concrete, and evidence-gap oriented.
- Keep nextQueries English-only; do not include Chinese characters.
- Ask at most 3 nextQueries.
- Continue searching only for high-value evidence gaps such as annual growth, current CEO status, tenure, AI article, exclusion industries, or Australia location.
- If no useful next search remains, return nextQueries: [] and a stopReason.`;
}

function parseEvaluationJson(content: string): DeepResearchEvaluation {
  const parsed = parseJsonObject(content);
  const candidates = Array.isArray(parsed.candidates)
    ? parsed.candidates.map(normalizeCandidate).filter((candidate): candidate is ResearchCandidate => Boolean(candidate))
    : [];
  const conditionMatrix = Array.isArray(parsed.conditionMatrix)
    ? parsed.conditionMatrix.map(normalizeConditionMatrixEntry).filter((entry): entry is ConditionMatrixEntry => Boolean(entry))
    : [];
  const nextQueries = Array.isArray(parsed.nextQueries)
    ? parsed.nextQueries.map(normalizeQueryPlan).filter((query): query is SearchQueryPlan => Boolean(query))
    : [];
  const summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "本轮没有形成明确阶段结论。";
  const nextQueryReason = typeof parsed.nextQueryReason === "string" ? parsed.nextQueryReason.trim() : "";
  const stopReason = typeof parsed.stopReason === "string" ? parsed.stopReason.trim() : "";

  return {
    summary,
    candidates,
    conditionMatrix,
    nextQueries: nextQueries.slice(0, 3),
    ...(nextQueryReason ? { nextQueryReason } : {}),
    ...(stopReason ? { stopReason } : {})
  };
}

function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Evaluator response did not include a JSON object");
  }

  const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Evaluator response JSON was not an object");
  }

  return parsed as Record<string, unknown>;
}

function normalizeCandidate(value: unknown): ResearchCandidate | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Record<string, unknown>;
  const person = typeof item.person === "string" ? item.person.trim() : "";
  const company = typeof item.company === "string" ? item.company.trim() : "";
  const status = normalizeCandidateStatus(item.status);
  const rationale = typeof item.rationale === "string" ? item.rationale.trim() : "";

  if (!person || !company) {
    return null;
  }

  return {
    person,
    company,
    status,
    rationale: rationale || "本轮未提供详细理由。"
  };
}

function normalizeCandidateStatus(value: unknown): ResearchCandidate["status"] {
  return value === "candidate" || value === "rejected" || value === "winner" || value === "unknown" ? value : "unknown";
}

function normalizeConditionMatrixEntry(value: unknown): ConditionMatrixEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Record<string, unknown>;
  const candidate = typeof item.candidate === "string" ? item.candidate.trim() : "";
  const condition = typeof item.condition === "string" ? item.condition.trim() : "";
  const status = normalizeConditionStatus(item.status);
  const evidence = typeof item.evidence === "string" ? item.evidence.trim() : "";
  const sourceUrls = Array.isArray(item.sourceUrls) ? item.sourceUrls.filter((url): url is string => typeof url === "string" && isHttpUrl(url)) : [];

  if (!candidate || !condition) {
    return null;
  }

  return {
    candidate,
    condition,
    status,
    evidence: evidence || "暂无证据。",
    sourceUrls
  };
}

function normalizeConditionStatus(value: unknown): ConditionMatrixEntry["status"] {
  return value === "confirmed" || value === "contradicted" || value === "unknown" || value === "partial" ? value : "unknown";
}

function normalizeQueryPlan(value: unknown): SearchQueryPlan | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Record<string, unknown>;
  const query = typeof item.query === "string" ? removeCjk(item.query).trim() : "";
  const keywords = Array.isArray(item.keywords)
    ? item.keywords.map((keyword) => (typeof keyword === "string" ? removeCjk(keyword).trim() : "")).filter(Boolean)
    : query.split(/\s+/).filter(Boolean);
  const rationale = typeof item.rationale === "string" ? item.rationale.trim() : "Close an evidence gap discovered in the prior iteration.";

  if (!query || containsCjk(query)) {
    return null;
  }

  return {
    query: query.slice(0, 160),
    keywords: mergeKeywords(keywords).slice(0, 12),
    rationale
  };
}

async function generateFinalReport(
  prompt: string,
  sources: ResearchSource[],
  iterations: ResearchIteration[],
  candidates: ResearchCandidate[],
  conditionMatrix: ConditionMatrixEntry[],
  injected?: (input: ReportGeneratorInput) => Promise<ChatCompletionResult>
): Promise<ChatCompletionResult> {
  const input = { prompt, sources, iterations, candidates, conditionMatrix };
  if (injected) {
    return injected(input);
  }

  const config = getOpenAIConfig();
  return createChatCompletion({
    ...config,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "你是严谨的B2B深度研究助手。你只根据提供的公开网页证据笔记和候选矩阵做判断。不要编造事实。对缺少直接证据的条件要标注“不确定/待尽调”。输出中文报告。"
      },
      {
        role: "user",
        content: buildReportPrompt(prompt, sources, iterations, candidates, conditionMatrix)
      }
    ]
  });
}

function buildReportPrompt(
  prompt: string,
  sources: ResearchSource[],
  iterations: ResearchIteration[] = [],
  candidates: ResearchCandidate[] = [],
  conditionMatrix: ConditionMatrixEntry[] = []
): string {
  const sourceText = sources
    .map(
      (source, index) => `[${index + 1}] ${source.title}
URL: ${source.url}
摘录: ${source.snippet}`
    )
    .join("\n\n");
  const iterationText = iterations
    .map(
      (iteration) => `第 ${iteration.iteration} 轮：
搜索：${iteration.queries.map((query) => query.query).join(" | ")}
读取：${iteration.readSources.length} 个来源
阶段结论：${iteration.summary}
下一轮原因：${iteration.nextQueryReason ?? iteration.stopReason ?? "无"}`
    )
    .join("\n\n");

  return `用户需求：
${prompt}

研究过程摘要：
${iterationText || "无"}

候选人/公司：
${JSON.stringify(candidates, null, 2)}

条件矩阵：
${JSON.stringify(conditionMatrix, null, 2)}

公开网页资料：
${sourceText}

请输出：
1. 一句话结论
2. 最匹配候选人和公司
3. 按用户条件逐条匹配的矩阵
4. 证据来源，使用 [1] 这样的编号引用
5. 不确定项和需要尽调的问题
6. 下一步行动建议

要求：不要把没有来源支持的信息写成确定事实。`;
}

function formatEvaluationSummary(evaluation: DeepResearchEvaluation): string {
  const lines = [
    `阶段结论：${evaluation.summary}`,
    `候选数量：${evaluation.candidates.length}`,
    `条件矩阵：${evaluation.conditionMatrix.length} 项`,
    evaluation.nextQueries.length > 0
      ? `下一轮关键词：${evaluation.nextQueries.map((query) => query.query).join(" | ")}`
      : `停止原因：${evaluation.stopReason ?? "no_next_queries"}`
  ];

  if (evaluation.nextQueryReason) {
    lines.push(`下一轮原因：${evaluation.nextQueryReason}`);
  }

  return lines.join("\n");
}

async function addStep(
  steps: ResearchStep[],
  title: string,
  detail: string,
  status: ResearchStep["status"],
  emit?: (event: ResearchStreamEvent) => Promise<void>
): Promise<void> {
  const step = {
    id: `${Date.now()}-${steps.length}`,
    title,
    detail,
    status,
    timestamp: new Date().toISOString()
  };
  steps.push(step);
  await emit?.({ type: "step", step, timestamp: new Date().toISOString() });
}

async function updateLastStep(
  steps: ResearchStep[],
  detail: string,
  status: ResearchStep["status"],
  emit?: (event: ResearchStreamEvent) => Promise<void>
): Promise<void> {
  const last = steps[steps.length - 1];
  if (!last) {
    return;
  }

  last.detail = detail;
  last.status = status;
  last.timestamp = new Date().toISOString();
  await emit?.({ type: "step", step: last, timestamp: new Date().toISOString() });
}

function createEventEmitter(onEvent?: (event: ResearchStreamEvent) => void | Promise<void>): (event: ResearchStreamEvent) => Promise<void> {
  return async (event) => {
    await onEvent?.(event);
  };
}

function baseLog(queryPlan: SearchQueryPlan, engine: string, iteration?: number): Omit<SearchLogEntry, "status" | "results"> {
  return {
    engine,
    query: queryPlan.query,
    keywords: queryPlan.keywords,
    ...(typeof iteration === "number" ? { iteration } : {}),
    timestamp: new Date().toISOString()
  };
}

function compactErrorMessage(message: string): string {
  return message.split("\n").filter(Boolean).slice(0, 8).join("\n");
}

function formatEngineName(engine: string): string {
  if (engine.toLowerCase() === "duckduckgo") {
    return "DuckDuckGo";
  }

  return engine.charAt(0).toUpperCase() + engine.slice(1);
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    try {
      const url = new URL(result.url);
      const key = `${url.hostname}${url.pathname}`.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    } catch {
      return false;
    }
  });
}

function mergeSources(primary: ResearchSource[], fallback: ResearchSource[] = []): ResearchSource[] {
  const seen = new Set<string>();
  return [...primary, ...fallback].filter((source) => {
    const key = sourceKey(source);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueQueries(queries: SearchQueryPlan[]): SearchQueryPlan[] {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = query.query.toLowerCase().trim();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function mergeKeywords(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const cleaned = value.trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || containsCjk(cleaned) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function removeCjk(value: string): string {
  return value.replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ").replace(/\s+/g, " ").trim();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sourceKey(source: SearchResult): string {
  try {
    const url = new URL(source.url);
    return `${url.hostname}${url.pathname}`.toLowerCase();
  } catch {
    return source.url.toLowerCase();
  }
}

function isUsefulSnippet(snippet: string): boolean {
  return snippet.replace(/\s+/g, " ").trim().length >= MIN_USEFUL_SNIPPET_CHARS;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
