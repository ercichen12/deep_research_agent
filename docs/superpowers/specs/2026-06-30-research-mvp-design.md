# Research MVP Design

## Goal

Build a local MVP that approximates the Apodex shared "Deep Solve" experience: a user enters a complex people/company research request, the app runs a server-side research workflow through an OpenAI-compatible endpoint, then displays the final report and an auditable process timeline.

## Scope

The MVP includes one local web page, one research API route, one provider connectivity route, a small server-side search/fetch layer, and tests for the core parsing and workflow helpers.

The MVP excludes login, saved conversations, billing, multi-user storage, hosted deployment, background queues, and full cross-conversation search. Those are follow-on product features after the API behavior is verified.

## Architecture

Use Next.js App Router with TypeScript. The client page posts a research prompt to `/api/research`. The server generates English search queries, calls a lightweight web search endpoint, fetches readable snippets from selected URLs, then asks the configured OpenAI-compatible chat completion API to write a grounded Chinese report.

The UI renders three areas: prompt composer, research process timeline, and report output. Process steps are generated from real server actions rather than hidden model chain-of-thought.

## Provider Configuration

Environment variables:

- `OPENAI_BASE_URL`: OpenAI-compatible base URL, expected default `https://ai.input.im/v1`.
- `OPENAI_API_KEY`: local secret key, stored only in `.env.local`.
- `OPENAI_MODEL`: optional model override. The MVP defaults to `gpt-5.5` if omitted, but the `/api/health` endpoint lists available model IDs when supported.

## Search Strategy

The MVP uses DuckDuckGo's lightweight HTML results page as a no-key search fallback, then fetches selected pages directly and extracts title, description, headings, and short body snippets. This provides visible trace steps even if the OpenAI-compatible gateway does not support native web-search tools.

If a result page cannot be fetched or parsed, the workflow records the error in the trace and continues with remaining sources.

## Data Flow

1. User submits a Chinese research request.
2. Server creates 3-5 English search queries from the request using simple heuristic prompt text.
3. Server searches each query and records query/result-count steps.
4. Server fetches up to 6 unique source pages and records fetch steps.
5. Server calls chat completions with the original request, collected source snippets, and a strict report prompt.
6. Server returns `{ report, steps, sources, model }`.
7. UI shows report, timeline, and source cards.

## Error Handling

Provider errors return a clear message without leaking the API key. Search and page-fetch errors become trace steps and do not abort the whole workflow unless no source context can be produced.

The health route checks model listing and returns the configured base URL plus available model IDs when the endpoint supports `/models`.

## Testing

Unit tests cover:

- Search query generation returns English, bounded, non-empty queries.
- HTML search parsing extracts titles and URLs.
- Page snippet extraction removes scripts/styles and truncates text.
- OpenAI chat request builder uses the configured base URL and Authorization header without exposing secrets.

Manual verification covers:

- `npm run test`
- `npm run lint`
- `npm run build`
- `/api/health` reaches the configured provider
- Browser workflow submits a sample prompt and renders steps/report
