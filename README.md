# Find People Find Company

Internal research console for running Apodex-like Heavy investigations. The app currently focuses on a real Heavy workflow: create an inquiry, run multi-step research, record search/read logs, verify evidence gaps, and produce a sourced Markdown report.

## Current Purpose

The project is being shaped into an internal tool for research tasks such as:

- finding likely people/company matches from incomplete clues
- researching overseas distributors and sales channels
- designing customs-data cleaning, peer identification, and customer grading workflows
- verifying technical/service claims with visible search and source traces

The product goal is not a marketing site. The first screen is a working Heavy console.

## Main Features

- Heavy inquiry lifecycle: `Inquiry -> Turn -> ResearchRun -> AgentTask -> AgentReport -> VerificationReport -> FinalReport`.
- File-based persistence under `research-runs/`.
- NDJSON event logs for streaming and replay.
- Search provider abstraction with relay, OpenCLI, and web/fetch fallback.
- Agent-level adaptive research steps: intent recognition, English query generation, search quality reflection, keyword revision, source selection, reading, and finalization.
- UI panels for inquiry list, run process, agent reports, search/read logs, captured sources, verifier output, and final Markdown.
- Design direction for a new Apodex-like Graph Heavy engine in `docs/superpowers/specs/2026-07-02-apodex-graph-heavy-research-engine-design.md`.

## Important Modules

- `app/page.tsx` - Heavy console UI.
- `app/api/inquiries/*` - Heavy inquiry create/get/stream API routes.
- `app/api/research/*` - legacy research API routes.
- `app/api/health/route.ts` - health endpoint with safe provider status.
- `lib/heavy/types.ts` - Heavy domain types, defaults, JSON normalizers, event types.
- `lib/heavy/storage.ts` - file storage for inquiries, logs, and sources.
- `lib/heavy/orchestrator.ts` - current legacy Heavy run loop.
- `lib/heavy/coordinator.ts` - current run-level task planner.
- `lib/heavy/agent-runner.ts` - concurrent agent task execution.
- `lib/heavy/adaptive-research.ts` - per-agent adaptive search/read loop.
- `lib/heavy/search-provider.ts` - relay/OpenCLI/web/fetch provider policy and traces.
- `lib/heavy/verifier.ts` - current run-level evidence-gap verifier.
- `lib/heavy/synthesizer.ts` - final Markdown generation from reports and sources.
- `lib/openai.ts`, `lib/opencli.ts`, `lib/search.ts`, `lib/source.ts` - shared model/search/source utilities and legacy research support.
- `docs/superpowers/specs/` - design documents.
- `docs/superpowers/plans/` - implementation plans.
- `tests/` - Vitest unit, integration, API, and UI tests.

## Storage

Runtime artifacts are stored in:

```text
research-runs/inquiries/{inquiryId}.json
research-runs/logs/{turnId}.ndjson
research-runs/sources/{sourceHash}.json
```

The new Graph Heavy design proposes adding:

```text
research-runs/graph-state/{turnId}.json
```

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run test
```

The local app has been used at `http://localhost:3100/`; the exact dev port depends on how `next dev` is launched. 待确认: whether 3100 is the permanent project port or only the current local convention.

## Configuration

Expected environment variables include:

```text
OPENAI_BASE_URL
OPENAI_API_KEY
OPENAI_MODEL
SEARCH_PROVIDER
SEARCH_RELAY_URL
HEAVY_MAX_RUNS
HEAVY_MAX_AGENTS_PER_RUN
HEAVY_MAX_TOTAL_AGENTS
HEAVY_MAX_SOURCES_PER_AGENT
```

Do not commit secrets. Provider health and logs must not echo API keys.

