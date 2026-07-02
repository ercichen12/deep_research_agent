import { normalizeResearchActions, type ResearchAction, type ResearchState } from "@/lib/heavy/graph/types";

export function planGraphActions(state: ResearchState): ResearchAction[] {
  const cycle = state.cycleIndex + 1;
  if (state.candidatePool.some((candidate) => candidate.status === "promoted" || candidate.status === "ranked")) {
    return normalizeResearchActions(
      [
        {
          type: "rank_candidates",
          purpose: "rank promoted candidates",
          rationale: "A candidate has enough evidence to rank and finalize.",
          targetCandidateIds: state.candidatePool.map((candidate) => candidate.id)
        }
      ],
      cycle,
      state.budgets
    );
  }

  const lastSearch = state.searchLedger.at(-1);
  const quality = lastSearch?.quality;
  const activeCandidates = state.candidatePool.filter((candidate) => candidate.status === "active");
  if (activeCandidates.length > 0 && quality !== "empty") {
    return normalizeResearchActions(
      activeCandidates.slice(0, state.budgets.maxSearchActionsPerCycle).map((candidate) => ({
        type: "search_web",
        purpose: `candidate deep dive: ${candidate.name}`,
        rationale: "A candidate was found, so verify core constraints, exclusions, and source quality before ranking.",
        priority: "high",
        queries: buildCandidateDeepDiveQueries(state, candidate),
        expectedSignals: [
          candidate.name,
          ...candidate.aliases,
          ...state.frame.hardConstraints.map((constraint) => constraint.label),
          ...state.frame.exclusionRules.map((constraint) => constraint.label)
        ],
        targetCandidateId: candidate.id,
        maxResults: state.budgets.maxResultsPerQuery
      })),
      cycle,
      state.budgets
    );
  }

  const lastDecision = state.evaluatorDecisions.at(-1);
  const clueSeeds = [
    ...state.queryClues.map((clue) => clue.text),
    ...state.sourceLedger.slice(-8).flatMap((source) => [source.title, domainClue(source.url)])
  ].filter(Boolean);
  const needsRevision = quality === "empty" || quality === "weak" || lastDecision?.action === "revise_query";
  const usedQueries = new Set(state.searchLedger.flatMap((batch) => batch.queries ?? []));
  const sourceTargets = revisionTargetsForTask(state.frame.taskKind);
  const angles = state.frame.initialAngles.length
    ? state.frame.initialAngles
    : [{ id: "broad_search", title: "Broad search", priority: "high" as const, querySeeds: ["public evidence research"] }];

  return normalizeResearchActions(
    angles.slice(0, state.budgets.maxSearchActionsPerCycle).map((angle, index) => {
      const revisedQueries = needsRevision
        ? reviseQueries([...clueSeeds, ...angle.querySeeds], sourceTargets, state.budgets.maxQueriesPerSearchAction)
        : angle.querySeeds;
      const baseQueries = filterRepeatedQueries(revisedQueries, usedQueries, state.budgets.maxQueriesPerSearchAction);
      return {
        type: "search_web",
        purpose: needsRevision ? `revised ${angle.title}` : index === 0 ? "initial broad search" : angle.title,
        rationale: lastSearch
          ? "Previous search was not strong enough, so revise keywords with official/source-target terms."
          : "Start with English broad search across the user's hard constraints and Apodex-style source angles.",
        priority: angle.priority,
        queries: baseQueries,
        expectedSignals: [
          ...state.frame.hardConstraints.map((constraint) => constraint.label),
          ...state.frame.softPreferences.map((constraint) => constraint.label),
          ...state.frame.exclusionRules.map((constraint) => constraint.label)
        ],
        maxResults: state.budgets.maxResultsPerQuery
      };
    }),
    cycle,
    state.budgets
  );
}

function filterRepeatedQueries(queries: string[], usedQueries: Set<string>, limit: number): string[] {
  const fresh = queries.filter((query) => !usedQueries.has(query));
  if (fresh.length) {
    return fresh.slice(0, limit);
  }

  return expandRepeatedQueries(queries, usedQueries).slice(0, limit);
}

function expandRepeatedQueries(queries: string[], usedQueries: Set<string>): string[] {
  const variants: string[] = [];
  for (const query of queries) {
    for (const suffix of ["source verification", "official source", "news profile", "primary evidence"]) {
      variants.push(`${query} ${suffix}`);
    }
    if (!query.startsWith('"') && !query.endsWith('"')) {
      variants.push(`"${query}"`);
    }
  }
  return variants.filter((query) => !usedQueries.has(query)).filter(unique);
}

function buildCandidateDeepDiveQueries(state: ResearchState, candidate: { name: string; aliases: string[] }): string[] {
  const names = [candidate.name, ...candidate.aliases].filter(Boolean);
  const constraintTerms = state.frame.hardConstraints
    .filter((constraint) => constraint.core)
    .map((constraint) => constraint.label)
    .join(" ");
  const exclusions = state.frame.exclusionRules.map((constraint) => constraint.label).join(" ");
  return [
    `${names.join(" ")} ${constraintTerms} official profile`,
    `${names.join(" ")} interview funding expansion AI`,
    exclusions ? `${names.join(" ")} ${exclusions}` : `${names.join(" ")} verification sources`
  ];
}

function reviseQueries(seedQueries: string[], sourceTargets: string[], limit: number): string[] {
  const revised: string[] = [];
  for (const seed of seedQueries) {
    if (!seed) {
      continue;
    }
    revised.push(seed);
    for (const target of sourceTargets) {
      revised.push(`${seed} ${target}`);
      if (revised.length >= limit) {
        return revised;
      }
    }
    if (revised.length >= limit) {
      return revised;
    }
  }
  return revised;
}

function revisionTargetsForTask(taskKind: ResearchState["frame"]["taskKind"]): string[] {
  if (taskKind === "find_person_company") {
    return ["official profile funding interview", "CEO founder LinkedIn Crunchbase newsroom"];
  }
  if (taskKind === "find_website") {
    return ["official website product page", "review documentation FAQ"];
  }
  if (taskKind === "technical_verification") {
    return ["official docs public suffix list", "authoritative nameserver delegation support"];
  }
  if (taskKind === "market_list_building") {
    return ["association directory member list", "trade show exhibitor customs database"];
  }
  if (taskKind === "sales_strategy") {
    return ["seller requirements fees escrow", "forum reviews marketplace rules"];
  }
  if (taskKind === "data_workflow_design") {
    return ["data model entity resolution workflow", "external validation boundary"];
  }
  return ["official source documentation", "directory database"];
}

function domainClue(value: string): string {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, "");
    return hostname.split(".").slice(0, -1).join(" ");
  } catch {
    return "";
  }
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}
