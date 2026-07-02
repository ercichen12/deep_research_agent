import { hardConstraintsEnough } from "@/lib/heavy/graph/evidence-matrix";
import type { EvaluatorDecision, ResearchState } from "@/lib/heavy/graph/types";

export function evaluateGraphState(state: ResearchState): EvaluatorDecision {
  const cycle = state.cycleIndex;
  const promoted = state.candidatePool.filter((candidate) => candidate.status === "promoted" || candidate.status === "ranked");
  const hasEvidence = state.evidenceItems.length > 0;
  const budgetExhausted =
    state.budgets.cyclesUsed >= state.budgets.maxCycles ||
    state.budgets.sourcesRead >= state.budgets.maxTotalSourcesToRead ||
    state.budgets.actionsUsed >= state.budgets.maxCycles * state.budgets.maxActionsPerCycle;

  const enoughCandidate = promoted.find((candidate) => hardConstraintsEnough(candidate, state.frame, state.evidenceMatrix) && candidate.score >= 45);
  if (enoughCandidate) {
    return decision(cycle, "finalize", `候选 ${enoughCandidate.name} 已满足核心条件，进入排序和终稿。`, [], unresolvedFromState(state));
  }
  if (promoted.length > 1) {
    return decision(cycle, "compare_candidates", "多个候选已推进，需要比较排序。", promoted.map((candidate) => candidate.name), unresolvedFromState(state));
  }
  if (promoted.length === 1 && !budgetExhausted) {
    return decision(cycle, "continue", "已有候选但核心证据还不完整，继续 deep dive。", [promoted[0].name], unresolvedFromState(state));
  }
  if (hasEvidence && budgetExhausted) {
    return decision(cycle, "finalize", "预算耗尽但已有可用证据，输出未完全确认的最大可能答案。", [], unresolvedFromState(state));
  }
  if (!hasEvidence && budgetExhausted) {
    return decision(cycle, "fail", "预算耗尽且证据不足。", [], ["没有找到可用公开证据"]);
  }
  const lastSearch = state.searchLedger.at(-1);
  if (lastSearch?.quality === "empty" || lastSearch?.quality === "weak") {
    return decision(cycle, "revise_query", "搜索结果偏弱，需要调整英文关键词或换角度。", ["revised English queries"], unresolvedFromState(state));
  }
  return decision(cycle, "continue", "继续研究以补足候选和证据矩阵。", ["next search cycle"], unresolvedFromState(state));
}

function decision(
  cycle: number,
  action: EvaluatorDecision["action"],
  reason: string,
  nextFocus: string[],
  unresolvedQuestions: string[]
): EvaluatorDecision {
  return {
    id: `eval_${cycle}_${action}`,
    cycle,
    action,
    reason,
    nextFocus,
    unresolvedQuestions,
    createdAt: new Date().toISOString()
  };
}

function unresolvedFromState(state: ResearchState): string[] {
  const missing = state.evidenceMatrix.cells
    .filter((cell) => cell.status === "missing" || cell.status === "unknown")
    .map((cell) => cell.constraintId)
    .filter((value, index, array) => array.indexOf(value) === index);
  return missing.map((constraintId) => `缺少 ${constraintId} 的直接证据`);
}
