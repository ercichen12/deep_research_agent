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
  const querySeeds = state.frame.initialAngles.flatMap((angle) => angle.querySeeds);
  const clueSeeds = state.queryClues.map((clue) => clue.text);
  const revisedQueries = lastSearch && (lastSearch.quality === "empty" || lastSearch.quality === "weak")
    ? [...clueSeeds, ...querySeeds.map((query) => `${query} official profile funding interview`)]
    : querySeeds;

  return normalizeResearchActions(
    [
      {
        type: "search_web",
        purpose: lastSearch ? "revised broad search" : "initial broad search",
        rationale: lastSearch
          ? "Previous search was not strong enough, so revise keywords with official/source-target terms."
          : "Start with English broad search across the user's hard constraints.",
        priority: "high",
        queries: revisedQueries,
        expectedSignals: [
          ...state.frame.hardConstraints.map((constraint) => constraint.label),
          ...state.frame.softPreferences.map((constraint) => constraint.label)
        ],
        maxResults: state.budgets.maxResultsPerQuery
      }
    ],
    cycle,
    state.budgets
  );
}
