# Research MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js MVP that runs a grounded people/company research workflow through an OpenAI-compatible endpoint and displays report plus trace steps.

**Architecture:** Next.js App Router hosts a client page and two API routes. Server modules handle provider calls, search parsing, source fetching, and trace creation. Tests exercise the pure helpers before production code is written.

**Tech Stack:** Next.js, React, TypeScript, Vitest, ESLint, OpenAI-compatible Chat Completions API.

---

## File Structure

- `package.json`: scripts and dependencies.
- `next.config.mjs`: Next.js configuration.
- `tsconfig.json`: TypeScript configuration.
- `.eslintrc.json`: Next lint configuration.
- `.gitignore`: excludes dependencies, build output, and local secrets.
- `.env.local`: local API configuration.
- `app/layout.tsx`: root metadata and layout.
- `app/page.tsx`: interactive MVP UI.
- `app/globals.css`: application styling.
- `app/api/health/route.ts`: provider connectivity check.
- `app/api/research/route.ts`: research workflow endpoint.
- `lib/types.ts`: shared app types.
- `lib/query.ts`: search query generation.
- `lib/search.ts`: HTML search and result parsing.
- `lib/source.ts`: source page fetching and text extraction.
- `lib/openai.ts`: OpenAI-compatible HTTP client helpers.
- `lib/research.ts`: workflow orchestration.
- `tests/*.test.ts`: unit tests for helper behavior.

## Tasks

### Task 1: Project Scaffold

- [x] Create package/config files for a Next.js TypeScript app.
- [x] Create `.gitignore` and `.env.local`.

### Task 2: Core Helper Tests

- [x] Write failing tests for query generation, search parsing, source extraction, and OpenAI request building.
- [x] Run tests and confirm expected failures.

### Task 3: Core Helpers

- [x] Implement `lib/query.ts`, `lib/search.ts`, `lib/source.ts`, `lib/openai.ts`, and shared types.
- [x] Run tests and confirm they pass.

### Task 4: Research API

- [x] Implement `/api/health`.
- [x] Implement `/api/research` orchestration.
- [x] Add route-level validation and safe error responses.

### Task 5: UI

- [x] Implement `app/page.tsx` with prompt input, health panel, run button, timeline, report, and sources.
- [x] Implement responsive styling in `app/globals.css`.

### Task 6: Verification

- [x] Run `npm run test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Start the dev server.
- [x] Use browser automation to load the page, run a sample research prompt, and confirm report/steps render.
