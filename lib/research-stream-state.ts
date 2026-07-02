import type { ResearchResponse, ResearchStreamEvent } from "@/lib/types";

export function applyResearchStreamEvent(current: ResearchResponse, event: ResearchStreamEvent): ResearchResponse {
  if (event.type === "step") {
    const nextSteps = [...current.steps];
    const index = nextSteps.findIndex((step) => step.id === event.step.id);
    if (index >= 0) {
      nextSteps[index] = event.step;
    } else {
      nextSteps.push(event.step);
    }
    return { ...current, steps: nextSteps };
  }

  if (event.type === "heartbeat") {
    return current;
  }

  if (event.type === "search_done") {
    return {
      ...current,
      searchLogs: [...current.searchLogs, event.log],
      queries: upsertQuery(current.queries, {
        query: event.log.query,
        keywords: event.log.keywords,
        rationale: "streamed search query"
      })
    };
  }

  if (event.type === "read_done") {
    return {
      ...current,
      sources: upsertSource(current.sources, event.source)
    };
  }

  if (event.type === "iteration_done") {
    return {
      ...current,
      iterations: upsertIteration(current.iterations ?? [], event.iteration),
      candidates: event.iteration.candidates,
      conditionMatrix: event.iteration.conditionMatrix
    };
  }

  if (event.type === "report_done") {
    return {
      ...current,
      report: event.report,
      model: event.model
    };
  }

  if (event.type === "log_saved") {
    return {
      ...current,
      searchLogPath: event.path
    };
  }

  if (event.type === "final") {
    return event.result;
  }

  return current;
}

export function emptyResearchResult(): ResearchResponse {
  return {
    report: "",
    steps: [],
    sources: [],
    model: "",
    queries: [],
    searchLogs: [],
    iterations: [],
    candidates: [],
    conditionMatrix: []
  };
}

function upsertQuery(queries: ResearchResponse["queries"], query: ResearchResponse["queries"][number]) {
  if (queries.some((item) => item.query === query.query)) {
    return queries;
  }
  return [...queries, query];
}

function upsertSource(sources: ResearchResponse["sources"], source: ResearchResponse["sources"][number]) {
  if (sources.some((item) => item.url === source.url)) {
    return sources.map((item) => (item.url === source.url ? source : item));
  }
  return [...sources, source];
}

function upsertIteration(iterations: NonNullable<ResearchResponse["iterations"]>, iteration: NonNullable<ResearchResponse["iterations"]>[number]) {
  if (iterations.some((item) => item.iteration === iteration.iteration)) {
    return iterations.map((item) => (item.iteration === iteration.iteration ? iteration : item));
  }
  return [...iterations, iteration];
}
