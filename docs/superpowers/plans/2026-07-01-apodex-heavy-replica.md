# Apodex Heavy Internal Replica Implementation Plan

## Goal

Build the first real internal Heavy mode: Inquiry -> Turn -> Run, with a coordinator, independent research agents, verifier, multi-run decision loop, and final source-grounded Markdown report.

## Scope

- Heavy mode only.
- File storage only.
- Defaults: maxRuns 3, maxAgentsPerRun 6, maxTotalAgents 14, maxSourcesPerAgent 6, agentConcurrency 3.
- Search priority: relay Responses API first, OpenCLI second, existing Bing/fetch fallback last.
- Never store or display provider secrets.

## Execution Order

1. Add Heavy types and JSON normalizers.
2. Add file storage and append-only event logs.
3. Add relay/OpenCLI/search fallback provider.
4. Add coordinator task planning.
5. Add real independent AgentRunner execution with concurrency limit.
6. Add verifier and run decision rules.
7. Add orchestrator loop and final synthesis.
8. Add inquiry API routes and health provider status.
9. Replace the homepage with a Heavy console that renders real Inquiry data.
10. Verify with unit, integration, route, UI, lint, and build checks.

## Non-Negotiables

- Agent reports must come from independent AgentTask execution with their own queries, sources, and findings.
- The final report may only synthesize reports and sources; it must not search on its own.
- Missing or unsupported evidence must remain uncertain.
- API keys are read from local environment only and must not be written into code, docs, logs, tests, snapshots, or UI.
