# Agent Adaptive Research Design

## Goal

Upgrade each Heavy agent from a one-pass broad search worker into an Apodex-style adaptive research worker that records a truthful, visible process: intent recognition, English query generation, search result evaluation, keyword revision, source selection, page reading, and final findings.

The existing Heavy architecture remains:

```text
Inquiry -> Turn -> Run -> CoordinatorPlan -> AgentTask[] -> AgentReport[] -> VerificationReport -> FinalReport
```

The change is inside each `AgentTask` execution.

## Current System

Relevant files:

- `lib/heavy/types.ts`
  - Heavy data types, normalization, event definitions, budget defaults.
- `lib/heavy/agent-runner.ts`
  - Runs agent tasks concurrently.
  - Builds English queries.
  - Searches all generated queries.
  - Reads up to `maxSourcesPerAgent`.
  - Generates `AgentReport`.
- `lib/heavy/search-provider.ts`
  - Aggregates relay, OpenCLI engines, and web fallback.
  - Records provider and read traces.
- `lib/heavy/orchestrator.ts`
  - Runs coordinator, agents, verifier, and synthesizer.
- `app/page.tsx`
  - Renders run panels, agent reports, captured sources, search logs, read logs.
- `tests/heavy-*.test.ts`
  - Existing Heavy tests.

Current agent behavior:

```text
buildAgentQueries(prompt, task) -> 3 English queries
search each query with limit=maxSourcesPerAgent
dedupe results
read up to maxSourcesPerAgent sources
generate AgentReport
```

This is real, but it lacks a search-feedback loop.

## Target Behavior

Each agent should execute a bounded adaptive loop:

```text
1. Record intent recognition.
2. Generate initial English queries.
3. Search query round 1.
4. Reflect on search quality.
5. If weak, revise English queries and search again.
6. Repeat up to maxResearchRounds.
7. Select source URLs.
8. Read sources.
9. Generate AgentReport with researchSteps.
```

Default loop parameters:

```ts
maxResearchRounds = 3;
queriesPerRound = 3;
maxSourcesPerAgent = budget.maxSourcesPerAgent; // default 30
```

These values should be constants first. Environment configuration can be added later if needed.

## Data Model

### AgentResearchStep

Add this type in `lib/heavy/types.ts`:

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

export type AgentResearchDecision =
  | "continue"
  | "revise_query"
  | "read_sources"
  | "enough_evidence"
  | "stop";

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

Extend `AgentReport`:

```ts
researchSteps: AgentResearchStep[];
```

Normalizer behavior:

- Missing `researchSteps` becomes `[]`.
- Invalid steps are dropped.
- Step `detail`, `title`, and `timestamp` are required.
- Queries must be normalized to English-only strings.
- Selected URLs must be valid HTTP(S) URLs.
- Provider and engine must use existing safe values when possible.

### Why `researchSteps` is separate from `searchLogs`

`searchLogs` are raw provider traces:

```text
query X -> google/brave/duckduckgo/relay -> returned N results
```

`researchSteps` are the agent's workflow narrative:

```text
I searched X because I need tenure evidence.
The results mention the company but do not prove 3+ years.
I revised the query to include exact phrase and candidate name.
```

Both are needed. `searchLogs` prove what was called. `researchSteps` explain why the agent changed direction.

## Agent Runner Design

### New Helper Module

Create `lib/heavy/adaptive-research.ts`.

Responsibilities:

- Build initial English queries.
- Evaluate search result quality.
- Revise English queries.
- Select source URLs to read.
- Append `AgentResearchStep` items.

The module should avoid direct storage or UI concerns.

Suggested exports:

```ts
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

export async function runAdaptiveResearch(input: AdaptiveResearchInput): Promise<AdaptiveResearchOutput>;
```

`agent-runner.ts` then becomes simpler:

```text
runSingleAgentTask
  -> runAdaptiveResearch
  -> generateAgentReport(prompt, task, queries, sources, researchSteps, startedAt)
  -> normalizeAgentReport
```

### Search Quality Evaluation

Add a deterministic heuristic first. Do not rely only on an LLM for the control loop.

Evaluate each round using:

- result count
- domain quality
- presence of task-relevant terms
- presence of candidate names/company names discovered in previous rounds
- whether snippets contain evidence terms
- duplicate rate

Quality labels:

```ts
type SearchQuality = "strong" | "mixed" | "weak" | "empty";
```

Examples:

- `empty`: no results across all providers.
- `weak`: results exist but mostly generic or unrelated.
- `mixed`: some candidate/source terms appear, but key condition is still unverified.
- `strong`: multiple useful sources appear, including official/company/news/profile pages.

### Query Revision Rules

Queries must remain English-only.

Initial queries should be generated from:

- task role
- task objective
- task questions
- task search hints
- prompt-derived English context

Revision queries should add:

- entity names discovered from result titles/snippets
- exact condition terms
- source targeting
- negative or exclusion terms where useful

For find-people/company tasks:

- identity/tenure:
  - `founder CEO`
  - `appointed CEO`
  - `founded year`
  - `LinkedIn`
  - `leadership team`
  - `"over the last three years"`
- company fit:
  - `hardware product`
  - `robotics`
  - `device`
  - `deep tech`
  - `official`
- growth:
  - `annual growth`
  - `revenue growth`
  - `headcount growth`
  - `funding`
  - `Series A`
  - `valuation`
  - `customer growth`
- AI article:
  - `AI article`
  - `artificial intelligence`
  - `LinkedIn post`
  - `interview`
  - `opinion`
  - `blog`
- exclusion:
  - `medical device`
  - `solar panel`
  - `heavy manufacturing`
  - `industry`
  - `product`

If a round identifies a candidate like `Grace Brown` and `Andromeda Robotics`, later queries should include both names.

### Source Selection

Do not blindly read every search result in order. Before reading, rank and select results.

Priority signals:

1. Official company pages and company blog/news.
2. LinkedIn profiles/posts when the task needs person/article evidence.
3. Reputable funding/business/news pages.
4. Product pages.
5. Podcasts/interviews.
6. Generic SEO listicles only when they introduce candidates and no stronger source exists.

Deduplicate by URL.

Keep existing cap:

```text
selectedResults.length <= budget.maxSourcesPerAgent
```

Record a `source_selection` research step with selected URLs and the reason.

## Event And Storage Design

No new top-level event is required for the first version.

The process will be persisted inside:

```text
research-runs/inquiries/{inquiryId}.json
turns[].runs[].agentReports[].researchSteps
```

And inside the existing NDJSON event:

```text
agent_reported.report.researchSteps
```

This keeps storage compatible with the current event stream.

Optional future event:

```ts
agent_step
```

Do not implement `agent_step` in the first version unless streaming mid-agent progress becomes required. The first version can show steps after each agent reports.

## UI Design

Update `app/page.tsx`:

- In each `AgentReportCard`, add a `Research Process` section.
- Render steps in order.
- Show:
  - step type
  - round number
  - title/detail
  - queries
  - decision/reason
  - selected URLs
  - provider/engine/result count when present
- Keep existing sections:
  - captured pages
  - search logs
  - read logs
  - findings

Old reports:

- If `researchSteps` is missing or empty, show `暂无研究过程日志`.

The UI must not invent steps from search logs. It may only render `researchSteps`.

## Prompting Design

The adaptive loop control should be mostly deterministic, but the final report generation prompt should include the process:

```text
You searched these query rounds.
You revised keywords for these reasons.
You read these sources.
Output findings only from read sources.
Unknown conditions must remain unknown.
```

The model should not be allowed to add new searches during report synthesis.

## Error Handling

If a search round fails:

- Record a `search` step with `decision="continue"` or `decision="revise_query"` if other providers still produced results.
- Preserve provider errors in `searchLogs` using existing `compactError`.
- Do not fail the entire agent if at least one source can still be read.

If all rounds are empty:

- Record final reflection.
- Return a completed report with an `unknown` finding, or failed report only if the provider throws unrecoverably.

If read fails for some URLs:

- Preserve `readLogs`.
- Continue with remaining readable sources.
- If no source can be read, use snippets as weak evidence only when available and mark findings as `unknown` or low confidence.

## Tests

### Type Normalization

Add tests in `tests/heavy-types.test.ts`:

- valid `researchSteps` are preserved.
- invalid step entries are dropped.
- missing `researchSteps` normalizes to `[]`.
- query strings in steps are English-only.

### Adaptive Research Loop

Add tests in `tests/heavy-coordinator-agent-verifier.test.ts` or a new `tests/heavy-adaptive-research.test.ts`:

1. First round empty, second round revised:
   - provider returns no results for broad query.
   - provider returns useful result for revised query.
   - report includes `keyword_revision`.
   - queries are English-only.

2. Candidate discovered:
   - first round result title contains `Grace Brown - Andromeda Robotics`.
   - later query includes both `Grace Brown` and `Andromeda Robotics`.

3. Source selection prefers official/news/profile:
   - mixed search results include SEO pages and official/company/news pages.
   - selected URLs prioritize stronger sources.

4. OpenCLI/provider logs preserved:
   - search logs still include provider/engine.
   - research steps do not replace raw logs.

### UI Tests

Update `tests/heavy-ui.test.tsx`:

- render research process steps.
- render keyword revision reason.
- render selected source links.
- old report without `researchSteps` shows fallback text.

### Integration Tests

Update `tests/heavy-orchestrator.test.ts`:

- full flow persists `researchSteps` in inquiry JSON.
- `agent_reported` event includes `researchSteps`.

## Acceptance Criteria

For a completed Heavy inquiry:

- Each new agent report contains `researchSteps`.
- Search queries remain English-only.
- At least one adaptive test proves query revision after weak/empty first search.
- UI shows process steps separately from raw search logs.
- Search logs still show relay/OpenCLI/google/brave/duckduckgo/web provider details.
- Final findings preserve uncertainty when evidence is missing.
- Legacy inquiries render without crashing.
- No API key or secret appears in logs, inquiry JSON, UI, tests, or docs.

## Out Of Scope

- Single main-agent Apodex architecture.
- Real-time per-step streaming events.
- Database migration.
- Auth or permission system.
- Complex scoring ML model for source ranking.
- Chinese search queries.

## Implementation Notes

The implementation should be incremental:

1. Add types and normalizer tests.
2. Add adaptive helper with mocked provider tests.
3. Wire helper into `agent-runner.ts`.
4. Update UI to render steps.
5. Update orchestrator/API tests for persistence.
6. Run lint, tests, build, and a manual inquiry.

The highest-risk area is token/time cost. The loop must stay bounded by max rounds and existing source budget.

