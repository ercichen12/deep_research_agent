# Agent Adaptive Research Direction

## Background

The current Heavy product already has a real `Inquiry -> Turn -> Run -> AgentReport -> VerificationReport -> FinalReport` flow. It can run multiple independent agents, call relay/OpenCLI/web fallback, read sources, persist logs, and render captured pages and search logs in the UI.

The main gap compared with the Apodex sample is not the number of results. The gap is the missing intra-agent research process. Apodex shows a visible chain where the research agent identifies intent, creates English query combinations, searches, notices weak results, revises keywords, locks onto candidate entities, verifies each condition, and only then produces the final answer.

Our current agent flow is still mostly:

```text
AgentTask -> build 3 English queries -> broad search -> read sources -> report
```

The desired flow is:

```text
AgentTask -> understand task -> query round 1 -> evaluate results -> revise keywords -> query round 2/3 -> select sources -> read pages -> report
```

## Chosen Direction

We will keep the current multi-agent Heavy architecture and add an Apodex-style adaptive research loop inside each existing agent.

This means we choose option 1:

```text
Run still has multiple AgentTask items.
Each AgentTask becomes a real iterative research worker.
Each AgentReport includes its own visible research process.
```

We will not switch to a single main-agent architecture in this iteration. The system should remain compatible with the existing coordinator, verifier, synthesizer, storage, APIs, and UI.

## Why This Direction

This direction is the strongest fit for the current codebase:

- It preserves the existing Heavy product structure.
- It avoids throwing away working storage, event streaming, search provider, verifier, and UI work.
- It makes every agent more truthful and explainable.
- It directly addresses the Apodex behavior the user cares about: search failure, keyword revision, and visible reasoning process.
- It avoids fake UI-only process logs. The research process must be produced by real search rounds and real decisions.

## Target User Experience

In the UI, each agent should show a process similar to:

```text
1. Intent recognition
   This agent needs to verify CEO tenure, so it will look for founder year, company leadership pages, LinkedIn, interviews, and funding news.

2. Query generation
   - Grace Brown Andromeda Robotics CEO founder year
   - Andromeda Robotics leadership founder CEO Australia
   - Grace Brown Andromeda Robotics LinkedIn CEO

3. Search round 1
   google returned 10 results, brave returned 18, duckduckgo returned 10, relay returned N results.

4. Reflection
   Results mention Grace Brown and Andromeda Robotics, but do not yet prove 3+ years of tenure.

5. Keyword revision
   - "over the last three years" Grace Brown Andromeda Robotics
   - Andromeda Robotics founded 2022 Grace Brown CEO
   - site:andromedarobotics.ai Grace Brown three years

6. Search round 2
   More targeted sources found.

7. Source selection and read
   Read official company announcement, LinkedIn post, and reputable funding/news articles.

8. Findings
   Tenure is supported; growth is still unknown if no source gives exact 30% annual growth.
```

This should feel like Apodex's research process, but scoped inside each of our existing agents.

## Core Product Rules

1. Queries must be English-only.
2. Every adaptive search round must be real, not fabricated from a final answer.
3. Every keyword revision must be linked to a concrete reason:
   - no result
   - irrelevant result
   - no official source
   - candidate found but condition not verified
   - conflict between sources
4. Every search log must preserve provider and engine:
   - relay
   - opencli/google
   - opencli/brave
   - opencli/duckduckgo
   - web/bing fallback
5. OpenCLI called/not-called status must remain visible.
6. Agent reports must still distinguish:
   - supported
   - contradicted
   - unknown
7. Unsupported claims must not be written as certain facts.

## Proposed Agent Loop

Each agent gets a bounded adaptive loop:

```text
maxResearchRounds = 3
queriesPerRound = 3
maxSourcesPerAgent = existing budget, default 30
```

For each round:

1. Generate or revise English queries.
2. Search all queries with the current provider policy.
3. Store search results and provider/engine logs.
4. Evaluate quality of results.
5. Decide one of:
   - continue with revised keywords
   - read selected sources
   - stop because enough evidence exists
   - stop because no useful route remains

After rounds finish:

1. Select high-value unique URLs.
2. Read sources.
3. Generate the final AgentReport using only read sources and the recorded process.

## New Data Concept

Add `AgentResearchStep` to make the process first-class:

```ts
type AgentResearchStep = {
  id: string;
  type:
    | "intent"
    | "query_generation"
    | "search"
    | "reflection"
    | "keyword_revision"
    | "source_selection"
    | "read"
    | "finalize";
  title: string;
  detail: string;
  round?: number;
  queries?: string[];
  provider?: string;
  engine?: string;
  resultCount?: number;
  selectedUrls?: string[];
  decision?: "continue" | "revise_query" | "read_sources" | "enough_evidence" | "stop";
  reason?: string;
  timestamp: string;
};
```

`AgentReport` will include:

```ts
researchSteps: AgentResearchStep[];
```

Old reports without `researchSteps` must still render safely.

## What This Does Not Do

This direction does not:

- Replace the Heavy run loop.
- Replace the coordinator/verifier/synthesizer.
- Add auth, database storage, billing, deployment, or permissions.
- Fake a process after the report is generated.
- Use Chinese search queries.
- Claim exact growth rates when no public source supports them.

## Success Criteria

The feature is successful when a completed inquiry shows:

- each agent's intent recognition
- each round's English queries
- each engine/provider's returned results
- a reflection explaining whether the results were useful
- revised keywords when the first search is weak
- selected/read source URLs
- final findings that preserve uncertainty

For the CEO/company sample, at least one agent should visibly perform a revision like:

```text
Initial broad query did not verify tenure or growth.
Revised query adds candidate name, company name, exact phrase, and source targeting.
```

## Recommended Next Step

Write a formal design doc that maps this direction to concrete files:

- `lib/heavy/types.ts`
- `lib/heavy/agent-runner.ts`
- new adaptive query/reflection helper module
- `app/page.tsx`
- tests for type normalization, adaptive loop behavior, fallback behavior, and UI rendering

