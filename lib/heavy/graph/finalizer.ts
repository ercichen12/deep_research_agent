import type { FinalReport } from "@/lib/heavy/types";
import type { ResearchState } from "@/lib/heavy/graph/types";
import { rankCandidates } from "@/lib/heavy/graph/candidate-pool";

export function finalizeGraphReport(state: ResearchState): FinalReport {
  const ranked = rankCandidates(state.candidatePool).filter((candidate) => candidate.status !== "rejected");
  const top = ranked[0];
  const evidenceUrls = state.evidenceItems.map((item) => item.sourceUrl).filter(unique);
  const unknowns = state.evaluatorDecisions.flatMap((decision) => decision.unresolvedQuestions).filter(unique);

  if (!top) {
    return {
      markdown: `# 一句话结论\n\n没有找到足够公开证据形成候选。\n\n# 未确认项\n\n${unknowns.map((item) => `- ${item}`).join("\n") || "- 缺少可用来源"}`,
      summary: "证据不足",
      sourceUrls: evidenceUrls,
      unknowns,
      completedAt: new Date().toISOString()
    };
  }

  const matrixRows = state.evidenceMatrix.cells
    .filter((cell) => cell.candidateId === top.id)
    .map((cell) => `| ${cell.constraintId} | ${cell.status} | ${cell.bestSourceUrls.join(", ") || "未找到"} |`)
    .join("\n");
  const directEvidence = state.evidenceItems.filter((item) => item.subjectIds.includes(top.id) && item.strength === "direct");
  const proxyEvidence = state.evidenceItems.filter((item) => item.subjectIds.includes(top.id) && item.strength === "proxy");

  return {
    markdown: `# 一句话结论\n\n最大可能候选是 **${top.name}**，当前置信度为 ${top.confidence}，评分 ${top.score}/100。\n\n# 最大可能答案 / 候选排名\n\n1. ${top.name} - ${top.summary}\n\n# 证据矩阵\n\n| 条件 | 状态 | 来源 |\n|---|---|---|\n${matrixRows}\n\n# 直接证据\n\n${formatEvidence(directEvidence)}\n\n# 代理证据\n\n${formatEvidence(proxyEvidence)}\n\n# 排除项和被拒路径\n\n${state.rejectedPaths.map((path) => `- ${path.title}: ${path.reason}`).join("\n") || "- 暂无明确被拒路径"}\n\n# 未确认项\n\n${unknowns.map((item) => `- ${item}`).join("\n") || "- 暂无"}\n\n# 下一步建议\n\n- 对缺失条件继续查官方页、新闻采访、融资或年报类来源。\n\n# 来源\n\n${evidenceUrls.map((url) => `- ${url}`).join("\n")}`,
    summary: `最大可能候选：${top.name}`,
    sourceUrls: evidenceUrls,
    unknowns,
    completedAt: new Date().toISOString()
  };
}

function formatEvidence(items: ResearchState["evidenceItems"]): string {
  return items.map((item) => `- ${item.claim} [来源](${item.sourceUrl})`).join("\n") || "- 暂无";
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}
