# OpenCLI Search Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OpenCLI-backed precision search and page reader path before the existing Bing/fetch fallback.

**Architecture:** Create `lib/opencli.ts` as an isolated adapter around the `opencli` command. `lib/research.ts` uses it first for Brave and DuckDuckGo search, then uses OpenCLI web read for selected sources. Existing seed sources, Bing HTML search, and direct fetch remain fallbacks when OpenCLI is unavailable.

**Tech Stack:** Next.js, TypeScript, Vitest, Node child_process, OpenCLI Browser Bridge.

---

### Task 1: OpenCLI Adapter Tests

**Files:**
- Create: `tests/opencli.test.ts`
- Create: `lib/opencli.ts`

- [x] Write failing tests for OpenCLI result parsing and error detection.
- [x] Run the tests and confirm the module is missing.

### Task 2: OpenCLI Adapter

**Files:**
- Create: `lib/opencli.ts`

- [x] Implement command execution, JSON parsing, search result normalization, markdown cleanup, and bridge error detection.
- [x] Run OpenCLI adapter tests and full test suite.

### Task 3: Research Integration

**Files:**
- Modify: `lib/research.ts`
- Modify: `lib/types.ts`

- [x] Add OpenCLI search steps before fallback search.
- [x] Add OpenCLI web read for selected sources before direct fetch.
- [x] Preserve fallback behavior when OpenCLI fails.

### Task 4: Verification

- [x] Run `npm run test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run a real `/api/research` request and confirm OpenCLI steps/sources appear.

