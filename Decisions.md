# Decisions

## 2026-06-30 - Build A Research MVP First

The project started as a Next.js research MVP with API routes, a local UI, OpenAI-compatible model calls, search/fetch helpers, and Vitest coverage. This provided a working baseline before attempting an Apodex-style Heavy workflow.

Outcome:

- Keep the MVP and legacy `/api/research` routes for compatibility.
- Expand the real internal product through `/api/inquiries` and Heavy-specific modules.

## 2026-07-01 - Implement Heavy Mode As The Main Internal Product

Decision:

Implement only Heavy mode for the first internal product version. The system should create `Inquiry -> Turn -> Run`, dispatch multiple real agent tasks, verify reports, continue when evidence is missing, and synthesize a sourced final report.

Reasoning:

- The user wants a real internal tool, not a polished fake demo.
- Apodex Heavy samples showed multi-step research, verification, and final synthesis.
- Keeping only Heavy mode avoids splitting implementation effort across Deep Solve and Heavy.

Tradeoffs:

- The legacy research flow remains available but is not the new UI entry.
- The first version uses file storage instead of SQLite or hosted persistence.

## 2026-07-01 - Use File Storage For The First Version

Decision:

Persist inquiries, event logs, and sources in `research-runs/`.

Reasoning:

- File storage is fast to implement and easy to inspect while the engine logic is still changing.
- NDJSON logs make each step auditable.

Tradeoffs:

- No concurrent multi-user durability guarantees.
- No full-text search or database-level indexing yet.

## 2026-07-01 - Prefer Relay Search, Fallback To OpenCLI And Web

Decision:

Use relay search first, then OpenCLI, then web/fetch fallback.

Reasoning:

- Relay supports Responses-style web search.
- OpenCLI can call Google, Brave, and DuckDuckGo and gives useful fallback diversity.
- Search attempts must be logged with provider and engine so the UI can explain what actually happened.

Security constraint:

- API keys must only be read from environment variables and must not be written to code, logs, docs, or snapshots.

## 2026-07-01 - Increase Search Breadth And Show Search Evidence

Decision:

Raise `maxSourcesPerAgent` from startup-test scale to broader search scale, and expose each agent's search/read logs in the UI.

Reasoning:

- Narrow search returned too few pages and low precision.
- The user needs to see which search engine was called, whether OpenCLI was called, which pages were found, which pages were read, and what each provider returned.

Outcome:

- Agent reports include `searchLogs`, `readLogs`, `researchSteps`, and captured sources.
- UI renders provider/engine traces and source capture lists.

## 2026-07-01 - Add Per-Agent Adaptive Research

Decision:

Upgrade each agent from one-pass search into a bounded adaptive worker.

Reasoning:

- Apodex Deep Solve samples show intent recognition, search keywords, result evaluation, and keyword adjustment.
- A real agent must explain why it searched, when it revised queries, and which sources it selected.

Outcome:

- `lib/heavy/adaptive-research.ts` implements per-agent intent, query generation, search, reflection, keyword revision, source selection, read, and finalize steps.
- This improves local agent behavior but does not fully reproduce Apodex's global main logic.

## 2026-07-02 - Current Heavy Main Loop Is Not Enough

Decision:

Treat the existing `Run -> AgentTask[] -> Verifier -> FinalReport` loop as a legacy Heavy engine, not the final target.

Reasoning:

- Apodex samples show dynamic state-driven investigation, not merely fixed run-level task buckets.
- Our system found Grace Brown / Andromeda but did not promote it early enough into a shared candidate deep dive.
- Current verifier catches gaps too late, and the final report is too evidence-audit oriented.

Outcome:

- New design direction is an Apodex-like Graph Heavy engine.

## 2026-07-02 - Design Graph Heavy Research Engine

Decision:

Design a new state-driven research engine:

```text
ResearchFrame
-> ResearchState
-> ActionPlanner
-> ActionExecutor
-> EvidenceExtractor
-> CandidatePool
-> Evaluator
-> CandidatePromotion
-> Ranker
-> Finalizer
```

Reasoning:

- Apodex's reusable logic is not a hardcoded domain template; it is a dynamic research loop.
- Each step should be chosen from current evidence state.
- Strong candidates must be promoted globally.
- Final answers should rank best possible options while separating direct evidence, proxy evidence, assumptions, and unknowns.

Reference:

- `docs/superpowers/specs/2026-07-02-apodex-graph-heavy-research-engine-design.md`

Tradeoffs:

- This is a larger rewrite than patching the existing coordinator/verifier.
- The old orchestrator should stay available during migration.

