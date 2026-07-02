import type { FinalReport } from "@/lib/heavy/types";
import type { ResearchState } from "@/lib/heavy/graph/types";
import { rankCandidates } from "@/lib/heavy/graph/candidate-pool";

export function finalizeGraphReport(state: ResearchState): FinalReport {
  const ranked = rankCandidates(state.candidatePool).filter((candidate) => candidate.status !== "rejected");
  const top = ranked[0];
  const evidenceUrls = state.evidenceItems.map((item) => item.sourceUrl).filter(unique);
  const unknowns = state.evaluatorDecisions.flatMap((decision) => decision.unresolvedQuestions).filter(unique);

  if (!top) {
    if (state.evidenceItems.length > 0 && isWorkflowLikeTask(state.frame.taskKind)) {
      const constraintLines = state.frame.hardConstraints
        .map((constraint) => {
          const count = state.evidenceItems.filter((item) => item.constraintIds.includes(constraint.id)).length;
          return `| ${constraint.label} | ${count > 0 ? "supported/proxy" : "unknown"} | ${count} |`;
        })
        .join("\n");
      const sourceUrls = state.evidenceItems.map((item) => item.sourceUrl).filter(unique);
      const artifacts = state.workflowArtifacts;
      const artifactLines =
        artifacts
          .map(
            (artifact) =>
              `## Cycle ${artifact.cycle} · ${artifact.stage}\n\n**${artifact.title}**\n\n${artifact.summary}\n\n${formatList("Findings", artifact.findings)}\n${formatList("Invalid assumptions", artifact.invalidAssumptions)}\n${formatList("Ordered gates", artifact.orderedGates)}`
          )
          .join("\n\n") || "- 暂无 workflow artifact";
      const latestRevision = [...artifacts].reverse().find((artifact) => artifact.stage === "revision");
      return {
        markdown: `# 一句话结论\n\n最大可能路径是围绕 **${state.frame.deliverable}** 执行；这不是单一候选人/公司判断，而是一个需要草案、校验挑错、修正版的 workflow。HS code / HS8542 只能支持品类和贸易流分析，不能单独推断 EOL/HTF。\n\n# 最大可能路径\n\n${latestRevision?.orderedGates.map((gate) => `- ${gate}`).join("\n") || `- ${state.frame.deliverable}`}\n\n# Research Process Artifacts\n\n${artifactLines}\n\n# 证据矩阵\n\n| 条件 | 状态 | 证据数 |\n|---|---|---:|\n${constraintLines}\n\n# 直接证据\n\n${formatEvidence(state.evidenceItems.filter((item) => item.strength === "direct"))}\n\n# 代理证据\n\n${formatEvidence(state.evidenceItems.filter((item) => item.strength === "proxy" || item.strength === "weak"))}\n\n# 排除项和被拒路径\n\n${state.rejectedPaths.map((path) => `- ${path.title}: ${path.reason}`).join("\n") || "- 暂无明确被拒路径"}\n\n# 未确认项\n\n${unknowns.map((item) => `- ${item}`).join("\n") || "- 仍需对关键边界做外部验证"}\n\n# 下一步建议\n\n- 按上述 ordered gates 先跑小样本，验证每个 gate 的输入、输出和不可推断边界。\n- 对 EOL/HTF、交易资格或 DNS 支持这类外部状态，用官方文档、平台规则或人工抽样二次确认。\n\n# 来源\n\n${sourceUrls.map((url) => `- ${url}`).join("\n")}`,
        summary: `最大可能路径：${state.frame.deliverable}`,
        sourceUrls,
        unknowns,
        completedAt: new Date().toISOString()
      };
    }
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

function formatList(title: string, items: string[]): string {
  if (!items.length) {
    return `**${title}:**\n\n- 暂无`;
  }
  return `**${title}:**\n\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function isWorkflowLikeTask(taskKind: ResearchState["frame"]["taskKind"]): boolean {
  return taskKind === "data_workflow_design" || taskKind === "sales_strategy" || taskKind === "market_list_building" || taskKind === "technical_verification";
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}
