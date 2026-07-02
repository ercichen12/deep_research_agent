import { hardConstraintsEnough } from "@/lib/heavy/graph/evidence-matrix";
import type { EvaluatorDecision, ResearchState } from "@/lib/heavy/graph/types";

export function evaluateGraphState(state: ResearchState): EvaluatorDecision {
  const cycle = state.cycleIndex;
  const promoted = state.candidatePool.filter((candidate) => candidate.status === "promoted" || candidate.status === "ranked");
  const hasEvidence = state.evidenceItems.length > 0;
  const lastSearch = state.searchLedger.at(-1);
  const budgetExhausted =
    state.budgets.cyclesUsed >= state.budgets.maxCycles ||
    state.budgets.sourcesRead >= state.budgets.maxTotalSourcesToRead ||
    state.budgets.actionsUsed >= state.budgets.maxCycles * state.budgets.maxActionsPerCycle;

  if (isWorkflowLikeTask(state.frame.taskKind)) {
    return evaluateWorkflowState(state, cycle, hasEvidence, budgetExhausted);
  }

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
  if (isRichSearchWithoutExtraction(state, lastSearch)) {
    return decision(
      cycle,
      "revise_query",
      "搜索结果已经足够丰富，但没有抽取出候选或证据，需要围绕已读网页标题重新组合英文关键词并重跑抽取。",
      sourceCluesFromState(state),
      unresolvedFromState(state)
    );
  }
  if (lastSearch?.quality === "empty" || lastSearch?.quality === "weak") {
    return decision(cycle, "revise_query", "搜索结果偏弱，需要调整英文关键词或换角度。", ["revised English queries"], unresolvedFromState(state));
  }
  return decision(cycle, "continue", "继续研究以补足候选和证据矩阵。", ["next search cycle"], unresolvedFromState(state));
}

function evaluateWorkflowState(state: ResearchState, cycle: number, hasEvidence: boolean, budgetExhausted: boolean): EvaluatorDecision {
  const stages = new Set(state.workflowArtifacts.map((artifact) => artifact.stage));
  if (stages.has("revision")) {
    return decision(cycle, "finalize", "workflow 已完成草案、校验挑错和修正版，可以输出带不确定项的最终流程。", [], workflowUnresolvedFromState(state));
  }
  if (!hasEvidence && budgetExhausted) {
    return decision(cycle, "fail", "预算耗尽且证据不足。", [], ["没有找到可用公开证据"]);
  }
  if (hasEvidence && budgetExhausted) {
    return decision(cycle, "finalize", "预算耗尽但已有 workflow 证据，输出未完全确认的流程版本。", [], workflowUnresolvedFromState(state));
  }
  if (!stages.has("draft")) {
    return decision(cycle, "continue", "已有来源后先形成 workflow 草案，不能直接按候选评分终稿。", ["draft workflow"], workflowUnresolvedFromState(state));
  }
  if (!stages.has("critique")) {
    return decision(cycle, "continue", "workflow 草案需要校验和挑错，继续检查无来源结论、过度推断和排除项。", ["critique workflow assumptions"], workflowUnresolvedFromState(state));
  }
  return decision(cycle, "continue", "workflow 校验已完成，需要按有序 gate 重建修正版。", ["revise workflow ordered gates"], workflowUnresolvedFromState(state));
}

function isRichSearchWithoutExtraction(state: ResearchState, lastSearch: ResearchState["searchLedger"][number] | undefined): boolean {
  return Boolean(
    lastSearch &&
      state.evidenceItems.length === 0 &&
      state.candidatePool.length === 0 &&
      state.sourceLedger.length > 0 &&
      lastSearch.quality !== "empty" &&
      lastSearch.quality !== "weak" &&
      (lastSearch.dedupedResultCount >= 8 || state.sourceLedger.length >= 3)
  );
}

function sourceCluesFromState(state: ResearchState): string[] {
  return state.sourceLedger
    .slice(-5)
    .map((source) => source.title)
    .map(compactFocus)
    .filter(Boolean);
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

function workflowUnresolvedFromState(state: ResearchState): string[] {
  const unresolved = state.frame.hardConstraints
    .filter((constraint) => !state.evidenceItems.some((item) => item.constraintIds.includes(constraint.id)))
    .map((constraint) => `缺少 ${constraint.label} 的证据`);
  if (!state.workflowArtifacts.some((artifact) => artifact.stage === "critique")) {
    unresolved.push("workflow 还没有完成校验挑错");
  }
  if (!state.workflowArtifacts.some((artifact) => artifact.stage === "revision")) {
    unresolved.push("workflow 还没有重建为有序 gates");
  }
  return unresolved.filter((value, index, array) => array.indexOf(value) === index);
}

function isWorkflowLikeTask(taskKind: ResearchState["frame"]["taskKind"]): boolean {
  return taskKind === "data_workflow_design" || taskKind === "sales_strategy" || taskKind === "market_list_building" || taskKind === "technical_verification";
}

function compactFocus(value: string): string {
  const normalized = value
    .replace(/\.{2,}/g, " ")
    .replace(/\b(?:who s really|if you re|you know|every day|for ic manufacturers|whether you re|dm me|comment)\b.*$/i, " ")
    .replace(/\b(?:linkedin|post|activity)\b/gi, " ")
    .replace(/[^\w\s:./"'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const maxLength = 120;
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const kept: string[] = [];
  for (const word of normalized.split(/\s+/)) {
    const next = [...kept, word].join(" ");
    if (next.length > maxLength) {
      break;
    }
    kept.push(word);
  }
  return kept.join(" ");
}
