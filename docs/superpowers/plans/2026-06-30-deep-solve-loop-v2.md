# Deep Solve Loop V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current one-pass research pipeline with an Apodex-style iterative search, read, evaluate, and refine loop.

**Architecture:** Keep the existing Next.js app and OpenAI/OpenCLI adapters, but move orchestration into a focused loop module. The loop records every search wave, reads sources immediately after that wave, updates candidate evidence, and asks a reflection step whether to continue.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, OpenCLI, OpenAI-compatible Chat Completions.

---

## File Structure

- Modify `lib/types.ts`: add iteration, candidate, condition matrix, and reflection log types while preserving existing response fields.
- Create `lib/deep-research-loop.ts`: own the iterative orchestration and pure helpers for result dedupe, source selection, and stop decisions.
- Modify `lib/research.ts`: route `runResearch()` through the new loop and reuse existing search/read/page-reader/report helpers.
- Modify `lib/research-log.ts`: persist iterations and candidate matrix in JSON logs.
- Modify `app/page.tsx`: show iteration cards with search keywords, result counts, read links, evidence notes, stage conclusions, and next-query reasons.
- Add `tests/deep-research-loop.test.ts`: prove loop ordering, stop behavior, per-iteration logs, and candidate matrix creation.
- Update `tests/research.test.ts` if existing batch-only assumptions conflict with the new loop.

## Task 1: Add Loop Types and Failing Tests

**Files:**
- Modify: `lib/types.ts`
- Create: `tests/deep-research-loop.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that call a dependency-injected loop with fake search/read/evaluate functions:

```ts
it("reads sources immediately after each search iteration before planning the next query", async () => {
  const events: string[] = [];
  await runDeepResearchLoop({
    prompt: "find Australian hardware CEO",
    initialQueries: [plan("first query")],
    maxIterations: 2,
    search: async (query) => {
      events.push(`search:${query.query}`);
      return [result(query.query)];
    },
    read: async (item) => {
      events.push(`read:${item.url}`);
      return source(item);
    },
    evaluate: async ({ iteration }) => {
      events.push(`evaluate:${iteration}`);
      return {
        summary: "Need another query",
        candidates: [],
        conditionMatrix: [],
        nextQueries: iteration === 1 ? [plan("second query")] : [],
        stopReason: iteration === 2 ? "no_new_high_value_leads" : undefined
      };
    }
  });

  expect(events).toEqual([
    "search:first query",
    "read:https://example.com/first-query",
    "evaluate:1",
    "search:second query",
    "read:https://example.com/second-query",
    "evaluate:2"
  ]);
});
```

Also assert:

- every iteration log includes `queries`, `searchResults`, `readSources`, `summary`, and `nextQueries`;
- loop stops when evaluator returns no `nextQueries`;
- loop keeps query strings English-only by accepting only the already-English query planner output.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm run test -- tests/deep-research-loop.test.ts`

Expected: FAIL because `lib/deep-research-loop.ts` does not exist.

## Task 2: Implement Minimal Loop

**Files:**
- Create: `lib/deep-research-loop.ts`
- Modify: `lib/types.ts`

- [ ] **Step 1: Implement dependency-injected loop**

Implement `runDeepResearchLoop(options)` with:

- `pendingQueries` queue seeded from `initialQueries`;
- one iteration consumes up to `queriesPerIteration`;
- search all queries in the iteration;
- dedupe results;
- read selected results before evaluator runs;
- evaluator returns candidates, condition matrix, next queries, summary, and optional stop reason;
- stop when `nextQueries` is empty, `maxIterations` is reached, or no unread results remain.

- [ ] **Step 2: Run loop tests to verify GREEN**

Run: `npm run test -- tests/deep-research-loop.test.ts`

Expected: PASS.

## Task 3: Wire Real Research Flow

**Files:**
- Modify: `lib/research.ts`
- Modify: `lib/research-log.ts`
- Test: `tests/research.test.ts`, `tests/research-log.test.ts`

- [ ] **Step 1: Write/update failing integration tests**

Add tests proving `runResearch` returns `iterations` and logs the first iteration before final report generation.

- [ ] **Step 2: Implement real search/read/evaluate adapters**

Use existing helpers:

- `buildSearchQueries(prompt)` for first wave;
- `searchQueryWithOpenCli()` and Bing fallback for each query;
- `readAndAnalyzeSource()` for every selected source in the same iteration;
- OpenAI-compatible evaluator prompt to produce next English queries and candidate condition matrix;
- final report prompt uses all evidence notes and matrix.

- [ ] **Step 3: Run focused tests**

Run: `npm run test -- tests/research.test.ts tests/research-log.test.ts`

Expected: PASS.

## Task 4: UI and Log Visibility

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Update rendered process**

Show each iteration as a section with:

- iteration number;
- English search queries and rationales;
- search result count;
- read source count and links;
- stage conclusion;
- next-query reason or stop reason.

- [ ] **Step 2: Preserve existing report and source cards**

Keep the current report panel and source cards, but add evidence/candidate matrix visibility when available.

## Task 5: Full Verification

**Files:**
- All modified files.

- [ ] **Step 1: Run automated verification**

Run:

```bash
npm run test
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Run endpoint verification**

Call `/api/research` with the sample prompt. If full live search is too slow for one turn, run a dependency-injected or reduced-budget endpoint test and clearly state the coverage.

- [ ] **Step 3: Inspect generated `research-runs/*.json`**

Confirm the JSON log includes:

- `iterations`;
- every iteration's queries;
- result counts;
- read source links;
- candidate matrix;
- stage conclusion;
- next-query or stop reason.

## Self-Review

- The plan covers the explicit objective: multi-round English search, immediate read, evidence extraction, candidate matrix, next-query reflection, stopping conditions, auditable logs, UI display, and verification.
- No placeholders remain.
- Types and function names are consistent across tasks: `runDeepResearchLoop`, `iterations`, `conditionMatrix`, `nextQueries`, and `stopReason`.
