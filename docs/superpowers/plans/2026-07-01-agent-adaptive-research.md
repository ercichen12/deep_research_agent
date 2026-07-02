# Agent Adaptive Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real Apodex-style adaptive research loop inside each Heavy agent, with visible intent, English query rounds, reflection, keyword revision, source selection, page reads, and final findings.

**Architecture:** Keep the existing Heavy multi-agent architecture. Add `AgentResearchStep` to `AgentReport`, create `lib/heavy/adaptive-research.ts` for the bounded intra-agent loop, wire it into `agent-runner.ts`, and render the process in the Heavy console UI.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.5, Vitest, React Testing Library, file storage under `research-runs/`, existing relay/OpenCLI/web search providers.

---

## Scope And Constraints

This plan implements option 1 from the approved direction: keep `CoordinatorPlan -> AgentTask[]` and make each existing AgentTask run its own adaptive process.

Do not implement:

- single main-agent Apodex architecture
- real-time `agent_step` streaming event
- database migration
- auth or permission system
- Chinese search queries
- fake process reconstruction in UI

Every process step must come from real agent execution. The UI may only render `researchSteps`; it must not synthesize process steps from search logs.

Current workspace note: `git status` currently fails with `not a git repository`. Checkpoint steps below should therefore record changed files and test output instead of trying to force commits. If this workspace is later initialized as a git repo, use the commit commands shown in each task.

---

## File Structure

Create:

- `lib/heavy/adaptive-research.ts`
  - Owns the bounded intra-agent research loop.
  - Builds initial English queries.
  - Evaluates result quality.
  - Revises English queries.
  - Selects source URLs.
  - Reads selected pages.
  - Returns search/read logs, sources, selected results, and `researchSteps`.

- `tests/heavy-adaptive-research.test.ts`
  - Unit tests for adaptive loop behavior using mocked providers.

Modify:

- `lib/heavy/types.ts`
  - Add `AgentResearchStepType`, `AgentResearchDecision`, `AgentResearchStep`.
  - Add `researchSteps` to `AgentReport`.
  - Normalize `researchSteps`, dropping invalid step entries.

- `lib/heavy/agent-runner.ts`
  - Replace direct one-pass search/read flow in `runSingleAgentTask` with `runAdaptiveResearch`.
  - Include `researchSteps` in `generateAgentReport`.
  - Keep `buildAgentQueries` export for existing tests and reuse.

- `app/page.tsx`
  - Render `Research Process` inside each `AgentReportCard`.
  - Show fallback text for legacy reports missing `researchSteps`.

- `app/globals.css`
  - Add compact styles for research process steps, query lists, decisions, and selected URLs.

- `tests/heavy-types.test.ts`
  - Add normalizer tests for `researchSteps`.

- `tests/heavy-coordinator-agent-verifier.test.ts`
  - Update existing AgentReport expectations to include adaptive process where needed.

- `tests/heavy-ui.test.tsx`
  - Add fixture research steps and test rendering.
  - Add legacy fallback test for missing `researchSteps`.

- `tests/heavy-orchestrator.test.ts`
  - Ensure persisted mocked `AgentReport` fixtures include `researchSteps`, or verify legacy path still works.

---

### Task 1: Add AgentResearchStep Types And Normalization

**Files:**

- Modify: `lib/heavy/types.ts`
- Test: `tests/heavy-types.test.ts`

- [ ] **Step 1: Write failing normalizer tests**

Append these imports in `tests/heavy-types.test.ts` if needed:

```ts
import type { AgentResearchStep } from "@/lib/heavy/types";
```

Add these tests inside `describe("Heavy type normalization", () => { ... })`:

```ts
  it("normalizes valid agent research steps and removes invalid entries", () => {
    const report = normalizeAgentReport({
      taskId: "identity_research",
      agentId: "agent_identity_research",
      role: "identity_research",
      status: "completed",
      summary: "研究完成",
      queries: ["Grace Brown Andromeda Robotics CEO"],
      researchSteps: [
        {
          id: "step_1",
          type: "intent",
          title: "识别任务意图",
          detail: "Need to verify CEO identity and tenure.",
          decision: "continue",
          timestamp: "2026-07-01T00:00:00.000Z"
        },
        {
          id: "step_2",
          type: "keyword_revision",
          title: "调整关键词",
          detail: "Initial search did not prove tenure, so add candidate and company names.",
          round: 2,
          queries: ["Grace Brown Andromeda Robotics over the last three years", "site:andromedarobotics.ai Grace Brown CEO"],
          selectedUrls: ["https://andromedarobotics.ai/post/series-a-funding-news-fuel-for-our-zero-loneliness-vision"],
          decision: "revise_query",
          reason: "The first search found a candidate but did not verify the 3+ year condition.",
          timestamp: "2026-07-01T00:00:01.000Z"
        },
        {
          id: "",
          type: "search",
          title: "",
          detail: "",
          queries: ["中文关键词不应该保留"],
          timestamp: "2026-07-01T00:00:02.000Z"
        }
      ],
      sources: [{ title: "Source A", url: "https://example.com/a", snippet: "CEO evidence", provider: "test" }],
      findings: []
    });

    expect(report.researchSteps).toHaveLength(2);
    expect(report.researchSteps[0]).toMatchObject({
      id: "step_1",
      type: "intent",
      decision: "continue"
    });
    expect(report.researchSteps[1].queries).toEqual([
      "Grace Brown Andromeda Robotics over the last three years",
      "site:andromedarobotics.ai Grace Brown CEO"
    ]);
  });

  it("defaults missing agent research steps to an empty array", () => {
    const report = normalizeAgentReport({
      taskId: "identity_research",
      agentId: "agent_identity_research",
      role: "identity_research",
      status: "completed",
      summary: "legacy report",
      queries: ["CEO Australia"],
      sources: [],
      findings: []
    });

    expect(report.researchSteps).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- tests/heavy-types.test.ts
```

Expected: fail with TypeScript or assertion errors because `researchSteps` and related types do not exist yet.

- [ ] **Step 3: Add new exported types**

In `lib/heavy/types.ts`, after `AgentFinding`, add:

```ts
export type AgentResearchStepType =
  | "intent"
  | "query_generation"
  | "search"
  | "reflection"
  | "keyword_revision"
  | "source_selection"
  | "read"
  | "finalize";

export type AgentResearchDecision = "continue" | "revise_query" | "read_sources" | "enough_evidence" | "stop";

export type AgentResearchStep = {
  id: string;
  type: AgentResearchStepType;
  title: string;
  detail: string;
  round?: number;
  queries?: string[];
  provider?: HeavySearchProviderName;
  engine?: HeavySearchEngine | string;
  resultCount?: number;
  selectedUrls?: string[];
  decision?: AgentResearchDecision;
  reason?: string;
  timestamp: string;
};
```

- [ ] **Step 4: Extend AgentReport**

In `lib/heavy/types.ts`, update `AgentReport`:

```ts
export type AgentReport = {
  taskId: string;
  agentId: string;
  role: string;
  status: "completed" | "failed";
  summary: string;
  queries: string[];
  researchSteps: AgentResearchStep[];
  searchLogs: SearchAttemptLog[];
  readLogs: ReadAttemptLog[];
  sources: HeavySource[];
  findings: AgentFinding[];
  error?: string;
  startedAt: string;
  completedAt: string;
};
```

- [ ] **Step 5: Normalize researchSteps**

In `normalizeAgentReport`, add:

```ts
  const researchSteps = Array.isArray(item.researchSteps)
    ? item.researchSteps.map(normalizeAgentResearchStep).filter((step): step is AgentResearchStep => Boolean(step))
    : [];
```

Then include it in the returned object:

```ts
    researchSteps,
```

Add helper functions near `normalizeAgentFinding`:

```ts
function normalizeAgentResearchStep(input: unknown): AgentResearchStep | null {
  const item = objectRecord(input);
  const id = slug(text(item.id));
  const type = normalizeAgentResearchStepType(item.type);
  const title = text(item.title);
  const detail = text(item.detail);

  if (!id || !type || !title || !detail) {
    return null;
  }

  const provider = normalizeOptionalSearchProvider(item.provider);
  const queries = stringArray(item.queries).map(toEnglishStepText).filter(Boolean);
  const selectedUrls = stringArray(item.selectedUrls).filter(isHttpUrl);
  const decision = normalizeAgentResearchDecision(item.decision);

  return {
    id,
    type,
    title,
    detail,
    ...(typeof item.round === "number" && Number.isFinite(item.round) && item.round > 0 ? { round: Math.floor(item.round) } : {}),
    ...(queries.length ? { queries } : {}),
    ...(provider ? { provider } : {}),
    ...(text(item.engine) ? { engine: text(item.engine) } : {}),
    ...(typeof item.resultCount === "number" && Number.isFinite(item.resultCount) ? { resultCount: Math.max(0, Math.floor(item.resultCount)) } : {}),
    ...(selectedUrls.length ? { selectedUrls } : {}),
    ...(decision ? { decision } : {}),
    ...(text(item.reason) ? { reason: text(item.reason) } : {}),
    timestamp: text(item.timestamp) || new Date().toISOString()
  };
}

function normalizeAgentResearchStepType(input: unknown): AgentResearchStepType | null {
  return input === "intent" ||
    input === "query_generation" ||
    input === "search" ||
    input === "reflection" ||
    input === "keyword_revision" ||
    input === "source_selection" ||
    input === "read" ||
    input === "finalize"
    ? input
    : null;
}

function normalizeAgentResearchDecision(input: unknown): AgentResearchDecision | null {
  return input === "continue" ||
    input === "revise_query" ||
    input === "read_sources" ||
    input === "enough_evidence" ||
    input === "stop"
    ? input
    : null;
}

function normalizeOptionalSearchProvider(input: unknown): HeavySearchProviderName | null {
  return input === "relay" || input === "opencli" || input === "web" || input === "fetch" || input === "test" ? input : null;
}

function toEnglishStepText(value: string): string {
  return value
    .replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ")
    .replace(/[^a-zA-Z0-9 .,'"&:%/+_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 6: Update existing typed report fixtures**

Search for `const report` or `function report` returning `AgentReport`:

```bash
rg -n "AgentReport|researchSteps|function report|const report" tests lib
```

For any object explicitly typed as `AgentReport`, add:

```ts
researchSteps: [],
```

- [ ] **Step 7: Run type tests**

Run:

```bash
npm run test -- tests/heavy-types.test.ts
```

Expected: pass.

- [ ] **Step 8: Checkpoint**

If inside a git repo:

```bash
git add lib/heavy/types.ts tests/heavy-types.test.ts
git commit -m "feat: add heavy agent research steps"
```

If not inside a git repo, record changed files and passing command output in the task handoff.

---

### Task 2: Create Adaptive Research Helper

**Files:**

- Create: `lib/heavy/adaptive-research.ts`
- Create: `tests/heavy-adaptive-research.test.ts`
- Modify: `lib/heavy/agent-runner.ts` only to export reusable helpers if needed

- [ ] **Step 1: Write failing adaptive research tests**

Create `tests/heavy-adaptive-research.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runAdaptiveResearch } from "@/lib/heavy/adaptive-research";
import { DEFAULT_HEAVY_BUDGET, type AgentTask, type HeavySearchProvider, type HeavySearchResult } from "@/lib/heavy/types";

describe("Adaptive Heavy research", () => {
  it("revises English keywords after an empty first round and then reads useful sources", async () => {
    const searchedQueries: string[] = [];
    const provider: HeavySearchProvider = {
      search: async (query) => {
        searchedQueries.push(query);
        if (searchedQueries.length <= 3) {
          return [];
        }
        return [
          {
            title: "Grace Brown - Andromeda Robotics CEO",
            url: "https://andromedarobotics.ai/post/series-a-funding-news-fuel-for-our-zero-loneliness-vision",
            snippet: "Three years ago, we set out to solve the loneliness epidemic with Abi.",
            provider: "test"
          }
        ];
      },
      read: async (result) => ({
        ...result,
        snippet: result.snippet ?? "evidence",
        fullText: `${result.snippet ?? "evidence"} Grace Brown CEO Andromeda Robotics AI hardware.`
      })
    };

    const output = await runAdaptiveResearch({
      prompt: "找澳大利亚创新硬件 CEO，任职三年以上，最近发表 AI 观点",
      task: task("role-tenure_research", "任职年限", "Verify CEO tenure and founder year"),
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 5 }
    });

    expect(output.researchSteps.some((step) => step.type === "keyword_revision")).toBe(true);
    expect(output.researchSteps.some((step) => step.type === "reflection" && step.decision === "revise_query")).toBe(true);
    expect(output.sources).toHaveLength(1);
    expect(searchedQueries.length).toBeGreaterThan(3);
    expect(searchedQueries.every((query) => !/[\u3400-\u9fff\uf900-\ufaff]/.test(query))).toBe(true);
  });

  it("uses discovered candidate entities in later query rounds", async () => {
    const searchedQueries: string[] = [];
    const provider: HeavySearchProvider = {
      search: async (query) => {
        searchedQueries.push(query);
        if (searchedQueries.length <= 3) {
          return [
            {
              title: "Grace Brown - Andromeda Robotics founder interview",
              url: "https://example.com/interview",
              snippet: "Grace Brown leads Andromeda Robotics in Melbourne.",
              provider: "test"
            }
          ];
        }
        return [
          {
            title: "Andromeda Robotics Series A funding news",
            url: "https://andromedarobotics.ai/post/series-a-funding-news-fuel-for-our-zero-loneliness-vision",
            snippet: "Grace Brown and Andromeda Robotics announced funding.",
            provider: "test"
          }
        ];
      },
      read: async (result) => ({ ...result, snippet: result.snippet ?? "evidence", fullText: result.snippet ?? "evidence" })
    };

    await runAdaptiveResearch({
      prompt: "找澳大利亚创新硬件 CEO",
      task: task("article-ai-view_research", "AI 观点文章", "Find recent AI article by the CEO"),
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 5 }
    });

    const laterQueries = searchedQueries.slice(3).join(" ");
    expect(laterQueries).toContain("Grace Brown");
    expect(laterQueries).toContain("Andromeda Robotics");
  });

  it("selects official and reputable sources before generic pages", async () => {
    const results: HeavySearchResult[] = [
      { title: "Top startups list", url: "https://seo.example.com/list", snippet: "Generic listicle", provider: "test" },
      { title: "Andromeda Robotics official product", url: "https://andromedarobotics.ai/", snippet: "Official robotics company", provider: "test" },
      { title: "Business News Australia funding", url: "https://www.businessnewsaustralia.com/articles/robot-developer-andromeda-raises-23m-seriesa.html", snippet: "Funding and valuation", provider: "test" },
      { title: "LinkedIn Grace Brown AI post", url: "https://www.linkedin.com/posts/grace-brown-619b59161_linkedinnewsaustralia-linkedinnews-bigideas2026-activity-7404670028555481088-BPjf", snippet: "AI robotics post", provider: "test" }
    ];
    const readUrls: string[] = [];
    const provider: HeavySearchProvider = {
      search: async () => results,
      read: async (result) => {
        readUrls.push(result.url);
        return { ...result, snippet: result.snippet ?? "evidence", fullText: result.snippet ?? "evidence" };
      }
    };

    const output = await runAdaptiveResearch({
      prompt: "找澳大利亚创新硬件 CEO",
      task: task("company-fit_research", "公司画像", "Verify company hardware fit"),
      provider,
      budget: { ...DEFAULT_HEAVY_BUDGET, maxSourcesPerAgent: 3 }
    });

    expect(output.selectedResults.map((result) => result.url)).toEqual([
      "https://andromedarobotics.ai/",
      "https://www.linkedin.com/posts/grace-brown-619b59161_linkedinnewsaustralia-linkedinnews-bigideas2026-activity-7404670028555481088-BPjf",
      "https://www.businessnewsaustralia.com/articles/robot-developer-andromeda-raises-23m-seriesa.html"
    ]);
    expect(readUrls).toEqual(output.selectedResults.map((result) => result.url));
  });
});

function task(id: string, title: string, objective: string): AgentTask {
  return {
    id,
    role: id,
    title,
    objective,
    questions: [`${objective} question`],
    searchHints: [`${objective} search hint`]
  };
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- tests/heavy-adaptive-research.test.ts
```

Expected: fail because `@/lib/heavy/adaptive-research` does not exist.

- [ ] **Step 3: Create adaptive helper module**

Create `lib/heavy/adaptive-research.ts` with this structure:

```ts
import {
  compactError,
  type AgentResearchStep,
  type AgentTask,
  type HeavyBudget,
  type HeavySearchProvider,
  type HeavySearchResult,
  type HeavySource,
  type ReadAttemptLog,
  type SearchAttemptLog
} from "@/lib/heavy/types";
import { buildAgentQueries } from "@/lib/heavy/agent-runner";

const MAX_RESEARCH_ROUNDS = 3;
const QUERIES_PER_ROUND = 3;

type SearchQuality = "strong" | "mixed" | "weak" | "empty";

export type AdaptiveResearchInput = {
  prompt: string;
  task: AgentTask;
  provider: HeavySearchProvider;
  budget: HeavyBudget;
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
  const searchLogs: SearchAttemptLog[] = [];
  const readLogs: ReadAttemptLog[] = [];
  const researchSteps: AgentResearchStep[] = [];
  const allQueries: string[] = [];
  const allResults: HeavySearchResult[] = [];
  const discoveredEntities = new Set<string>();

  pushStep(researchSteps, {
    type: "intent",
    title: "识别任务意图",
    detail: buildIntentDetail(input.task),
    decision: "continue"
  });

  let queries = buildAgentQueries(input.prompt, input.task).slice(0, QUERIES_PER_ROUND);
  pushStep(researchSteps, {
    type: "query_generation",
    title: "生成第一轮英文关键词",
    detail: "Generated initial English-only search queries from the agent task, questions, search hints, and prompt context.",
    round: 1,
    queries,
    decision: "continue"
  });

  for (let round = 1; round <= MAX_RESEARCH_ROUNDS; round += 1) {
    const roundResults: HeavySearchResult[] = [];
    for (const query of queries) {
      allQueries.push(query);
      const results = await searchWithTrace(input.provider, query, input.budget.maxSourcesPerAgent, searchLogs);
      roundResults.push(...results);
      pushStep(researchSteps, {
        type: "search",
        title: `第 ${round} 轮搜索`,
        detail: `Searched one English query and collected ${results.length} deduplicated candidate results from configured providers.`,
        round,
        queries: [query],
        resultCount: results.length,
        provider: results[0]?.provider,
        engine: results[0]?.engine,
        decision: results.length ? "continue" : "revise_query"
      });
    }

    const uniqueRoundResults = dedupeResults(roundResults);
    allResults.push(...uniqueRoundResults);
    for (const entity of extractCandidateEntities(uniqueRoundResults)) {
      discoveredEntities.add(entity);
    }

    const quality = evaluateSearchQuality(uniqueRoundResults, input.task, discoveredEntities);
    const shouldRevise = round < MAX_RESEARCH_ROUNDS && quality !== "strong";
    pushStep(researchSteps, {
      type: "reflection",
      title: `评估第 ${round} 轮搜索质量`,
      detail: buildReflectionDetail(quality, uniqueRoundResults, discoveredEntities),
      round,
      resultCount: uniqueRoundResults.length,
      decision: shouldRevise ? "revise_query" : "read_sources",
      reason: shouldRevise
        ? "Current results are not strong enough for this task, so the agent will revise keywords with candidate/entity and evidence terms."
        : "Current results are strong enough or the round budget is exhausted, so the agent will select sources to read."
    });

    if (!shouldRevise) {
      break;
    }

    queries = reviseQueries(input.prompt, input.task, queries, discoveredEntities, round + 1);
    pushStep(researchSteps, {
      type: "keyword_revision",
      title: `调整第 ${round + 1} 轮英文关键词`,
      detail: "Revised keywords based on search weakness, discovered entities, and the evidence condition this agent must verify.",
      round: round + 1,
      queries,
      decision: "continue",
      reason: "Previous search either returned weak results or found candidates without enough condition-level evidence."
    });
  }

  const selectedResults = selectResultsToRead(dedupeResults(allResults), input.task, input.budget.maxSourcesPerAgent);
  pushStep(researchSteps, {
    type: "source_selection",
    title: "选择要读取的网页",
    detail: "Selected higher-value sources before reading: official pages, LinkedIn/profile evidence, reputable news, funding pages, product pages, and interviews.",
    selectedUrls: selectedResults.map((result) => result.url),
    resultCount: selectedResults.length,
    decision: selectedResults.length ? "read_sources" : "stop"
  });

  const sources: HeavySource[] = [];
  for (const result of selectedResults) {
    try {
      const source = await readWithTrace(input.provider, result, readLogs);
      sources.push(source);
      pushStep(researchSteps, {
        type: "read",
        title: "读取网页",
        detail: `Read source: ${source.title}`,
        selectedUrls: [source.url],
        provider: source.provider,
        engine: source.engine,
        decision: "continue"
      });
    } catch {
      if (result.snippet) {
        sources.push({
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          provider: result.provider,
          ...(result.engine ? { engine: result.engine } : {})
        });
      }
    }
    if (sources.length >= input.budget.maxSourcesPerAgent) {
      break;
    }
  }

  pushStep(researchSteps, {
    type: "finalize",
    title: "完成 Agent 研究过程",
    detail: sources.length
      ? `Finished adaptive research with ${sources.length} readable sources.`
      : "Finished adaptive research without readable sources; findings must remain unknown or low confidence.",
    resultCount: sources.length,
    decision: sources.length ? "enough_evidence" : "stop"
  });

  return {
    queries: Array.from(new Set(allQueries)),
    searchResults: dedupeResults(allResults),
    selectedResults,
    searchLogs: collectSearchLogs(input.provider, searchLogs),
    readLogs: collectReadLogs(input.provider, readLogs),
    sources,
    researchSteps
  };
}
```

- [ ] **Step 4: Add helper functions**

Add these functions below `runAdaptiveResearch`:

```ts
async function searchWithTrace(
  provider: HeavySearchProvider,
  query: string,
  limit: number,
  logs: SearchAttemptLog[]
): Promise<HeavySearchResult[]> {
  const startedAt = Date.now();
  try {
    const results = await provider.search(query, limit);
    logs.push({
      provider: inferSearchLogProvider(results),
      query,
      status: results.length ? "done" : "empty",
      results,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    });
    return results;
  } catch (error) {
    logs.push({
      provider: "test",
      query,
      status: "error",
      results: [],
      message: compactError(error instanceof Error ? error.message : "Search failed"),
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    });
    return [];
  }
}

async function readWithTrace(provider: HeavySearchProvider, result: HeavySearchResult, logs: ReadAttemptLog[]): Promise<HeavySource> {
  const startedAt = Date.now();
  try {
    const source = await provider.read(result);
    logs.push({
      provider: source.provider === "opencli" || source.provider === "fetch" || source.provider === "test" ? source.provider : "test",
      status: "done",
      title: source.title,
      url: source.url,
      readCharCount: source.readCharCount ?? source.fullText?.length ?? source.snippet.length,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    });
    return source;
  } catch (error) {
    logs.push({
      provider: result.provider === "opencli" || result.provider === "fetch" || result.provider === "test" ? result.provider : "test",
      status: "error",
      title: result.title,
      url: result.url,
      message: compactError(error instanceof Error ? error.message : "Read failed"),
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    });
    throw error;
  }
}

function collectSearchLogs(provider: HeavySearchProvider, localLogs: SearchAttemptLog[]): SearchAttemptLog[] {
  const providerLogs = provider.drainSearchLogs?.() ?? [];
  return providerLogs.length > 0 ? providerLogs : localLogs;
}

function collectReadLogs(provider: HeavySearchProvider, localLogs: ReadAttemptLog[]): ReadAttemptLog[] {
  const providerLogs = provider.drainReadLogs?.() ?? [];
  return providerLogs.length > 0 ? providerLogs : localLogs;
}

function inferSearchLogProvider(results: HeavySearchResult[]): SearchAttemptLog["provider"] {
  const provider = results[0]?.provider;
  return provider === "relay" || provider === "opencli" || provider === "web" || provider === "test" ? provider : "test";
}
```

- [ ] **Step 5: Add heuristic helpers**

Add:

```ts
function buildIntentDetail(task: AgentTask): string {
  return `This agent must handle role=${task.role}. Objective: ${task.objective}. Questions: ${task.questions.join(" | ")}.`;
}

function evaluateSearchQuality(results: HeavySearchResult[], task: AgentTask, entities: Set<string>): SearchQuality {
  if (results.length === 0) {
    return "empty";
  }
  const score = results.reduce((total, result) => total + scoreResult(result, task, entities), 0);
  const average = score / results.length;
  if (average >= 5 && results.length >= 3) {
    return "strong";
  }
  if (average >= 3) {
    return "mixed";
  }
  return "weak";
}

function scoreResult(result: HeavySearchResult, task: AgentTask, entities: Set<string>): number {
  const haystack = `${result.title} ${result.snippet ?? ""} ${result.url}`.toLowerCase();
  let score = 0;
  if (isOfficialLike(result.url)) score += 3;
  if (/linkedin\.com|businessnews|forbes|techcrunch|afr\.com|smartcompany|startupdaily|company|official|profile|interview|funding|series|valuation/.test(haystack)) score += 2;
  for (const term of taskEvidenceTerms(task)) {
    if (haystack.includes(term.toLowerCase())) score += 1;
  }
  for (const entity of entities) {
    if (entity && haystack.includes(entity.toLowerCase())) score += 1;
  }
  return score;
}

function buildReflectionDetail(quality: SearchQuality, results: HeavySearchResult[], entities: Set<string>): string {
  const entityText = Array.from(entities).slice(0, 6).join(", ") || "no clear candidate entity yet";
  return `Search quality=${quality}. Unique results=${results.length}. Candidate entities=${entityText}.`;
}
```

- [ ] **Step 6: Add query revision helpers**

Add:

```ts
function reviseQueries(prompt: string, task: AgentTask, previousQueries: string[], entities: Set<string>, round: number): string[] {
  const entityText = Array.from(entities).slice(0, 4).join(" ");
  const evidenceText = taskEvidenceTerms(task).join(" ");
  const base = entityText || previousQueries[0] || `${task.role} research`;
  const sourceTargets = sourceTargetTerms(task).join(" ");
  return [
    `${base} ${evidenceText}`,
    `${base} ${sourceTargets}`,
    `${base} ${round === 2 ? '"over the last three years" founder CEO funding' : 'official source interview LinkedIn article'}`
  ]
    .map(toEnglishSearchText)
    .filter(unique)
    .slice(0, QUERIES_PER_ROUND);
}

function taskEvidenceTerms(task: AgentTask): string[] {
  const role = task.role.toLowerCase();
  if (/tenure|role|identity|ceo/.test(role)) {
    return ["CEO", "founder", "appointed", "founded year", "leadership", "LinkedIn"];
  }
  if (/growth|financial/.test(role)) {
    return ["annual growth", "revenue growth", "headcount growth", "funding", "Series A", "valuation", "customer growth"];
  }
  if (/article|ai|publication|view/.test(role)) {
    return ["AI article", "artificial intelligence", "LinkedIn post", "interview", "opinion", "blog"];
  }
  if (/company|fit|hardware/.test(role)) {
    return ["hardware product", "robotics", "device", "deep tech", "official"];
  }
  if (/exclusion|risk|medical|solar|heavy/.test(role)) {
    return ["medical device", "solar panel", "heavy manufacturing", "industry", "product"];
  }
  return ["official source", "evidence", "profile", "interview"];
}

function sourceTargetTerms(task: AgentTask): string[] {
  const role = task.role.toLowerCase();
  if (/article|ai|publication|view|identity|tenure|role/.test(role)) {
    return ["site:linkedin.com", "company blog", "interview"];
  }
  if (/growth|financial/.test(role)) {
    return ["funding news", "annual report", "valuation", "revenue"];
  }
  return ["official website", "company profile", "news"];
}
```

- [ ] **Step 7: Add entity extraction, selection, and utilities**

Add:

```ts
function extractCandidateEntities(results: HeavySearchResult[]): string[] {
  const entities = new Set<string>();
  for (const result of results) {
    const title = result.title.replace(/[|:·-]+/g, " ");
    const matches = title.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g) ?? [];
    for (const match of matches) {
      if (!/Australia|LinkedIn|Forbes|Series|Chief Executive|Artificial Intelligence/.test(match)) {
        entities.add(match.trim());
      }
    }
  }
  return Array.from(entities).slice(0, 8);
}

function selectResultsToRead(results: HeavySearchResult[], task: AgentTask, limit: number): HeavySearchResult[] {
  return results
    .map((result, index) => ({ result, index, score: scoreForReadSelection(result, task) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.result)
    .slice(0, limit);
}

function scoreForReadSelection(result: HeavySearchResult, task: AgentTask): number {
  const haystack = `${result.title} ${result.snippet ?? ""} ${result.url}`.toLowerCase();
  let score = 0;
  if (isOfficialLike(result.url)) score += 20;
  if (haystack.includes("linkedin.com")) score += /article|ai|publication|identity|tenure|role/.test(task.role) ? 18 : 10;
  if (/businessnewsaustralia|forbes|techcrunch|afr\.com|smartcompany|startupdaily/.test(haystack)) score += 15;
  if (/funding|series a|valuation|revenue|growth/.test(haystack)) score += /growth|financial/.test(task.role) ? 14 : 6;
  if (/official|company|product|robotics|hardware|device/.test(haystack)) score += 8;
  if (/top|best|list|watch/.test(haystack)) score -= 4;
  return score;
}

function isOfficialLike(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return !/(linkedin|facebook|instagram|youtube|x\.com|twitter|medium|forbes|techcrunch|businessnewsaustralia|smartcompany|startupdaily|afr)\./.test(host);
  } catch {
    return false;
  }
}

function dedupeResults(results: HeavySearchResult[]): HeavySearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = result.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pushStep(
  steps: AgentResearchStep[],
  input: Omit<AgentResearchStep, "id" | "timestamp">
): void {
  steps.push({
    id: `step_${steps.length + 1}`,
    timestamp: new Date().toISOString(),
    ...input
  });
}

function toEnglishSearchText(value: string): string {
  return value
    .replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ")
    .replace(/[^a-zA-Z0-9 .,'"&:%/+_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function unique(value: string, index: number, values: string[]): boolean {
  return value.length > 0 && values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index;
}
```

- [ ] **Step 8: Avoid circular import if needed**

If importing `buildAgentQueries` from `agent-runner.ts` creates a circular dependency after Task 3, move query helpers from `agent-runner.ts` into `adaptive-research.ts` and re-export:

```ts
export { buildAgentQueries } from "@/lib/heavy/adaptive-research";
```

The preferred implementation is to avoid the circular import by moving these helper functions into `adaptive-research.ts`:

- `buildAgentQueries`
- `removeCjk`
- `toEnglishSearchText`
- `promptToEnglishContext`
- `unique`

Then update tests to import `buildAgentQueries` from `agent-runner.ts` only if `agent-runner.ts` re-exports it:

```ts
export { buildAgentQueries } from "@/lib/heavy/adaptive-research";
```

- [ ] **Step 9: Run adaptive tests**

Run:

```bash
npm run test -- tests/heavy-adaptive-research.test.ts
```

Expected: pass.

- [ ] **Step 10: Checkpoint**

If inside a git repo:

```bash
git add lib/heavy/adaptive-research.ts tests/heavy-adaptive-research.test.ts
git commit -m "feat: add adaptive heavy research loop"
```

If not inside a git repo, record changed files and passing command output.

---

### Task 3: Wire Adaptive Research Into AgentRunner

**Files:**

- Modify: `lib/heavy/agent-runner.ts`
- Test: `tests/heavy-coordinator-agent-verifier.test.ts`

- [ ] **Step 1: Update existing AgentRunner tests**

In `tests/heavy-coordinator-agent-verifier.test.ts`, update the test `"runs multiple AgentTask items independently with different queries, sources, and reports"` to assert research steps:

```ts
    expect(reports[0].researchSteps.length).toBeGreaterThan(0);
    expect(reports[0].researchSteps.map((step) => step.type)).toEqual(
      expect.arrayContaining(["intent", "query_generation", "search", "reflection", "source_selection", "finalize"])
    );
```

In the wide search test, update expected search count because adaptive rounds can run more than one round:

```ts
    expect(requestedQueries.length).toBeGreaterThanOrEqual(3);
```

Keep the assertion:

```ts
    expect(requestedLimits.every((limit) => limit === 30)).toBe(true);
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- tests/heavy-coordinator-agent-verifier.test.ts
```

Expected: fail because `runSingleAgentTask` still returns reports without `researchSteps` from a real adaptive loop.

- [ ] **Step 3: Import adaptive helper**

At the top of `lib/heavy/agent-runner.ts`, add:

```ts
import { runAdaptiveResearch } from "@/lib/heavy/adaptive-research";
```

If Task 2 moved query helpers into `adaptive-research.ts`, also update exports/imports accordingly.

- [ ] **Step 4: Replace direct search/read logic in runSingleAgentTask**

Inside `runSingleAgentTask`, replace the current block that creates `queries`, loops `searchWithAttemptLog`, dedupes, and reads sources with:

```ts
    const research = await runAdaptiveResearch({
      prompt,
      task,
      provider,
      budget
    });

    const report = await generateAgentReport(prompt, task, research.queries, research.sources, research.researchSteps, startedAt);
    return normalizeAgentReport({
      ...report,
      searchLogs: research.searchLogs,
      readLogs: research.readLogs,
      researchSteps: research.researchSteps
    });
```

- [ ] **Step 5: Update failure report**

In the catch block, include a real failure step:

```ts
      researchSteps: [
        {
          id: "step_1",
          type: "finalize",
          title: "Agent 执行失败",
          detail: "The agent failed before completing adaptive research.",
          decision: "stop",
          reason: compactError(error instanceof Error ? error.message : "Agent task failed"),
          timestamp: new Date().toISOString()
        }
      ],
```

- [ ] **Step 6: Update generateAgentReport signature**

Change:

```ts
async function generateAgentReport(
  prompt: string,
  task: AgentTask,
  queries: string[],
  sources: HeavySource[],
  startedAt: string
): Promise<Partial<AgentReport>> {
```

To:

```ts
async function generateAgentReport(
  prompt: string,
  task: AgentTask,
  queries: string[],
  sources: HeavySource[],
  researchSteps: AgentResearchStep[],
  startedAt: string
): Promise<Partial<AgentReport>> {
```

Add `AgentResearchStep` to the imports from `types.ts`.

- [ ] **Step 7: Preserve researchSteps in heuristic report**

Change `heuristicAgentReport` signature to include `researchSteps`:

```ts
function heuristicAgentReport(
  task: AgentTask,
  queries: string[],
  sources: HeavySource[],
  researchSteps: AgentResearchStep[],
  startedAt: string
): Partial<AgentReport> {
```

Return:

```ts
    researchSteps,
```

Update the call:

```ts
  const baseReport = heuristicAgentReport(task, queries, sources, researchSteps, startedAt);
```

- [ ] **Step 8: Include process in report prompt**

Change `buildAgentReportPrompt` signature:

```ts
function buildAgentReportPrompt(
  prompt: string,
  task: AgentTask,
  queries: string[],
  sources: HeavySource[],
  researchSteps: AgentResearchStep[]
): string {
```

Add this section before sources:

```ts
Agent research process:
${researchSteps
  .map((step) => `- [${step.type}] ${step.title}: ${step.detail}${step.reason ? ` Reason: ${step.reason}` : ""}`)
  .join("\n")}
```

Update the model call:

```ts
content: buildAgentReportPrompt(prompt, task, queries, sources, researchSteps)
```

In parsed return object, add:

```ts
      researchSteps,
```

- [ ] **Step 9: Remove dead local helpers if unused**

After wiring, run:

```bash
npm run lint
```

If `searchWithAttemptLog`, `readWithAttemptLog`, `collectSearchLogs`, `collectReadLogs`, `inferSearchLogProvider`, `inferReadLogProvider`, or `dedupeSearchResults` in `agent-runner.ts` are unused, remove them from `agent-runner.ts`. Their behavior now lives in `adaptive-research.ts`.

- [ ] **Step 10: Run AgentRunner tests**

Run:

```bash
npm run test -- tests/heavy-coordinator-agent-verifier.test.ts tests/heavy-adaptive-research.test.ts
```

Expected: pass.

- [ ] **Step 11: Checkpoint**

If inside a git repo:

```bash
git add lib/heavy/agent-runner.ts tests/heavy-coordinator-agent-verifier.test.ts
git commit -m "feat: run adaptive research in heavy agents"
```

If not inside a git repo, record changed files and passing command output.

---

### Task 4: Render Research Process In Heavy UI

**Files:**

- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Test: `tests/heavy-ui.test.tsx`

- [ ] **Step 1: Add researchSteps to UI fixture**

In `tests/heavy-ui.test.tsx`, inside the fixture `agentReports[0]`, add:

```ts
                researchSteps: [
                  {
                    id: "step_1",
                    type: "intent",
                    title: "识别任务意图",
                    detail: "Need to verify CEO identity and Australia company fit.",
                    decision: "continue",
                    timestamp: "2026-07-01T00:00:00.000Z"
                  },
                  {
                    id: "step_2",
                    type: "keyword_revision",
                    title: "调整关键词",
                    detail: "Initial broad query did not verify tenure, so add candidate and company names.",
                    round: 2,
                    queries: ["Grace Brown Andromeda Robotics over the last three years"],
                    selectedUrls: ["https://example.com/a"],
                    decision: "revise_query",
                    reason: "Need condition-level evidence.",
                    timestamp: "2026-07-01T00:00:00.200Z"
                  }
                ],
```

- [ ] **Step 2: Add UI assertions**

In the first UI test, add:

```ts
    expect(screen.getByText("研究过程")).toBeInTheDocument();
    expect(screen.getByText("识别任务意图")).toBeInTheDocument();
    expect(screen.getByText("调整关键词")).toBeInTheDocument();
    expect(screen.getByText("Need condition-level evidence.")).toBeInTheDocument();
    expect(screen.getByText("Grace Brown Andromeda Robotics over the last three years")).toBeInTheDocument();
```

In the legacy test, also delete `researchSteps`:

```ts
    delete (inquiry.turns[0].runs[0].agentReports[0] as Partial<(typeof inquiry.turns)[0]["runs"][0]["agentReports"][number]>).researchSteps;
```

Then assert:

```ts
    expect(screen.getByText("暂无研究过程日志。")).toBeInTheDocument();
```

- [ ] **Step 3: Run UI tests to verify failure**

Run:

```bash
npm run test -- tests/heavy-ui.test.tsx
```

Expected: fail because UI does not render `researchSteps` yet.

- [ ] **Step 4: Add ResearchProcess component**

In `app/page.tsx`, inside `AgentReportCard`, after the summary/error block and before `<SourceCaptureList report={report} />`, add:

```tsx
      <ResearchProcess report={report} />
```

Add this component below `AgentReportCard`:

```tsx
function ResearchProcess({ report }: { report: ResearchRun["agentReports"][number] }) {
  const steps = Array.isArray(report.researchSteps) ? report.researchSteps : [];

  return (
    <div className="research-process">
      <h4>研究过程</h4>
      <div className="research-step-list">
        {steps.map((step) => (
          <article className={`research-step ${step.type}`} key={step.id}>
            <div className="research-step-head">
              <strong>{step.title}</strong>
              <span>{step.round ? `Round ${step.round}` : step.type}</span>
            </div>
            <p>{step.detail}</p>
            {step.reason ? <small>{step.reason}</small> : null}
            {step.queries?.length ? (
              <ul className="query-list">
                {step.queries.map((query) => (
                  <li key={query}>
                    <code>{query}</code>
                  </li>
                ))}
              </ul>
            ) : null}
            {step.selectedUrls?.length ? (
              <ol className="selected-url-list">
                {step.selectedUrls.map((url) => (
                  <li key={url}>
                    <a href={url} rel="noreferrer" target="_blank">
                      {url}
                    </a>
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="research-step-meta">
              {step.decision ? <span>{step.decision}</span> : null}
              {step.provider ? <span>{formatSearchProvider(step.provider, step.engine)}</span> : null}
              {typeof step.resultCount === "number" ? <span>{step.resultCount} results</span> : null}
            </div>
          </article>
        ))}
        {steps.length === 0 ? <p className="muted">暂无研究过程日志。</p> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add CSS**

In `app/globals.css`, add:

```css
.research-process {
  margin-top: 14px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.research-process h4 {
  margin: 0 0 10px;
  color: var(--text);
  font-size: 13px;
}

.research-step-list {
  display: grid;
  gap: 10px;
}

.research-step {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
  padding: 10px;
}

.research-step-head,
.research-step-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.research-step-head strong {
  color: var(--text);
  font-size: 13px;
}

.research-step-head span,
.research-step-meta span {
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-size: 11px;
  padding: 3px 7px;
}

.research-step p {
  margin: 8px 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.research-step small {
  display: block;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.4;
}

.query-list,
.selected-url-list {
  margin: 8px 0 0;
  padding-left: 18px;
}

.query-list li,
.selected-url-list li {
  margin: 4px 0;
}

.query-list code {
  white-space: normal;
  word-break: break-word;
}

.selected-url-list a {
  word-break: break-all;
}
```

If the CSS variable names differ in the file, use the closest existing variables. Do not introduce a new one-note palette.

- [ ] **Step 6: Run UI tests**

Run:

```bash
npm run test -- tests/heavy-ui.test.tsx
```

Expected: pass.

- [ ] **Step 7: Checkpoint**

If inside a git repo:

```bash
git add app/page.tsx app/globals.css tests/heavy-ui.test.tsx
git commit -m "feat: show heavy agent research process"
```

If not inside a git repo, record changed files and passing command output.

---

### Task 5: Verify Persistence And Event Compatibility

**Files:**

- Modify: `tests/heavy-orchestrator.test.ts`
- Optional Modify: `lib/heavy/orchestrator.ts` only if tests expose missing persistence

- [ ] **Step 1: Update mocked AgentReport fixture**

In `tests/heavy-orchestrator.test.ts`, update `function report(taskItem: AgentTask): AgentReport` to include:

```ts
    researchSteps: [
      {
        id: `step_${taskItem.id}`,
        type: "intent",
        title: "识别任务意图",
        detail: `${taskItem.title} intent`,
        decision: "continue",
        timestamp: "2026-07-01T00:00:00.000Z"
      }
    ],
```

Place it after `queries`.

- [ ] **Step 2: Add persistence assertion**

In the first orchestrator test, after:

```ts
    expect(turn.finalReport?.markdown).toContain("终稿");
```

Add:

```ts
    expect(turn.runs[0].agentReports[0].researchSteps[0]).toMatchObject({
      type: "intent",
      title: "识别任务意图"
    });
```

- [ ] **Step 3: Add event log assertion**

At the top of `tests/heavy-orchestrator.test.ts`, add imports:

```ts
import { readFile } from "node:fs/promises";
```

Inside the first test, after the persistence assertion, add:

```ts
    const eventLog = await readFile(join(rootDir, "logs", `${turn.id}.ndjson`), "utf8");
    const agentEvent = eventLog
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; report?: AgentReport })
      .find((event) => event.type === "agent_reported");
    expect(agentEvent?.report?.researchSteps?.[0]?.type).toBe("intent");
```

Use the actual storage log filename if the current storage module prefixes turn IDs differently. Inspect `lib/heavy/storage.ts` if this assertion fails.

- [ ] **Step 4: Run orchestrator tests**

Run:

```bash
npm run test -- tests/heavy-orchestrator.test.ts
```

Expected: pass. If it fails only due to log path, adjust the test path to match `appendTurnEvent` in `lib/heavy/storage.ts`. No production change should be required because `agent_reported` already persists the whole report.

- [ ] **Step 5: Run Heavy API tests**

Run:

```bash
npm run test -- tests/heavy-api.test.ts
```

Expected: pass. If typed fixtures fail, add `researchSteps: []` to those report fixtures.

- [ ] **Step 6: Checkpoint**

If inside a git repo:

```bash
git add tests/heavy-orchestrator.test.ts tests/heavy-api.test.ts
git commit -m "test: persist heavy agent research steps"
```

If not inside a git repo, record changed files and passing command output.

---

### Task 6: Full Verification And Manual QA

**Files:**

- No planned source changes.
- Use current app and generated `research-runs` output for manual inspection.

- [ ] **Step 1: Run focused Heavy tests**

Run:

```bash
npm run test -- tests/heavy-types.test.ts tests/heavy-adaptive-research.test.ts tests/heavy-coordinator-agent-verifier.test.ts tests/heavy-orchestrator.test.ts tests/heavy-ui.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full unit/integration suite**

Run:

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: no ESLint errors.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: Next.js production build succeeds.

- [ ] **Step 5: Start or reuse local dev server**

If no server is running on port 3100:

```bash
npm run dev -- -p 3100
```

If a server is already running at `http://localhost:3100/`, reuse it.

- [ ] **Step 6: Manual inquiry**

In the Heavy console, run this prompt:

```text
我要找一个公司的CEO，这个公司是做有创新性的硬件，但是不能做太阳能板，也不能做医疗器械，也不能做重工制造。公司每年最好能增长30%。这个人最好在澳大利亚，在这个企业做了三年以上，并且最近发表过包含AI观点的文章。
```

Expected UI:

- each AgentReport shows `研究过程`
- at least one agent shows `调整关键词`
- queries are English-only
- search logs still show relay/OpenCLI/provider/engine details
- captured webpages still render
- final report preserves uncertainty for exact `30% annual growth` if no public source proves it

- [ ] **Step 7: Inspect latest persisted inquiry**

Run:

```powershell
$latest = Get-ChildItem -LiteralPath 'research-runs\inquiries' -Filter '*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$json = Get-Content -LiteralPath $latest.FullName -Raw | ConvertFrom-Json
$reports = $json.turns[0].runs | ForEach-Object { $_.agentReports } | Select-Object -First 3
$reports | ForEach-Object {
  [pscustomobject]@{
    Agent = $_.role
    Steps = $_.researchSteps.Count
    StepTypes = (($_.researchSteps | ForEach-Object { $_.type }) -join ', ')
    QueryHasChinese = (($_.queries -join ' ') -match '[\u3400-\u9fff\uf900-\ufaff]')
  }
} | Format-Table -AutoSize
```

Expected:

- `Steps` is greater than 0 for new reports
- `StepTypes` includes `intent`, `query_generation`, `search`, `reflection`, `source_selection`, `finalize`
- `QueryHasChinese` is `False`

- [ ] **Step 8: Secret scan**

Run:

```bash
rg -n "sk-[A-Za-z0-9_-]{8,}" lib app tests docs research-runs
```

Expected: no matches. If local `research-runs` contains a secret due to previous unrelated data, do not print it; report only the file path and redact the value.

- [ ] **Step 9: Final checkpoint**

If inside a git repo:

```bash
git status --short
git add lib/heavy app tests docs/superpowers/plans/2026-07-01-agent-adaptive-research.md
git commit -m "feat: add adaptive heavy agent research process"
```

If not inside a git repo, final handoff must include:

- changed file list
- focused test result
- full test result
- lint result
- build result
- latest inquiry/log path from manual QA

---

## Self-Review Checklist

Spec coverage:

- `AgentResearchStep` data model: Task 1.
- Adaptive search loop: Task 2.
- AgentRunner integration: Task 3.
- UI rendering: Task 4.
- Storage and NDJSON event compatibility: Task 5.
- Verification and manual QA: Task 6.

No placeholder language is allowed in execution. The implementation has concrete target files, test code, behavior, and commands.

Type consistency:

- `AgentResearchStep` is defined in `types.ts`.
- `AgentReport.researchSteps` is normalized and required in typed reports.
- `runAdaptiveResearch` returns `researchSteps`, `searchLogs`, `readLogs`, `sources`, `queries`, `searchResults`, and `selectedResults`.
- `AgentReportCard` reads `report.researchSteps` defensively for legacy data.

