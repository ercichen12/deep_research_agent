import { createChatCompletion, getOpenAIConfig } from "@/lib/openai";
import {
  normalizeVerificationReport,
  parseJsonObject,
  type AgentReport,
  type AgentTask,
  type CoordinatorPlan,
  type VerificationIssue,
  type VerificationReport
} from "@/lib/heavy/types";

export type VerifierInput = {
  prompt: string;
  plan: CoordinatorPlan;
  reports: AgentReport[];
};

export async function verifyRun(input: VerifierInput): Promise<VerificationReport> {
  const heuristic = heuristicVerifyRun(input);

  try {
    const config = getOpenAIConfig();
    const completion = await createChatCompletion({
      ...config,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "你是 Heavy 核验 Agent。你只挑错、找冲突、找证据缺口，并建议下一轮任务。输出严格 JSON。"
        },
        {
          role: "user",
          content: buildVerifierPrompt(input)
        }
      ]
    });
    const normalized = normalizeVerificationReport(parseJsonObject(completion.content));
    return normalized.issues.length || normalized.status === "pass" ? normalized : heuristic;
  } catch {
    return heuristic;
  }
}

export function heuristicVerifyRun(input: VerifierInput): VerificationReport {
  const issues: VerificationIssue[] = [];
  const contradictions: VerificationIssue[] = [];
  const missingEvidence = new Set<string>();

  for (const report of input.reports) {
    if (report.status === "failed") {
      issues.push({
        type: "agent_failed",
        severity: "high",
        message: `${report.role} failed: ${report.error ?? "unknown error"}`,
        relatedTaskId: report.taskId
      });
      missingEvidence.add(report.role);
      continue;
    }

    for (const finding of report.findings) {
      if (finding.support === "supported" && finding.sourceUrls.length === 0) {
        issues.push({
          type: "missing_source",
          severity: "high",
          message: `Finding has no source: ${finding.claim}`,
          relatedTaskId: report.taskId
        });
        missingEvidence.add(report.role);
      }

      if (finding.support === "contradicted") {
        const issue = {
          type: "contradiction",
          severity: "high" as const,
          message: `Contradictory finding: ${finding.claim}`,
          relatedTaskId: report.taskId,
          ...(finding.sourceUrls[0] ? { sourceUrl: finding.sourceUrls[0] } : {})
        };
        issues.push(issue);
        contradictions.push(issue);
      }

      if (finding.support === "unknown") {
        issues.push({
          type: "missing_evidence",
          severity: "medium",
          message: `Unknown finding needs evidence: ${finding.claim}`,
          relatedTaskId: report.taskId
        });
        missingEvidence.add(report.role);
      }
    }
  }

  const status: VerificationReport["status"] = input.reports.length === 0 || input.reports.every((report) => report.status === "failed")
    ? "failed"
    : issues.length > 0
      ? "needs_more_research"
      : "pass";

  return normalizeVerificationReport({
    status,
    summary: status === "pass" ? "本轮来源和结论通过基础核验。" : "本轮存在来源缺口、冲突或失败任务，需要补查。",
    issues,
    contradictions,
    missingEvidence: Array.from(missingEvidence),
    recommendedNextTasks: status === "needs_more_research" ? recommendedTasks(Array.from(missingEvidence), input.plan.tasks) : [],
    unknowns: Array.from(missingEvidence)
  });
}

function recommendedTasks(missingEvidence: string[], priorTasks: AgentTask[]): AgentTask[] {
  const byRole = new Map(priorTasks.map((task) => [task.role, task]));
  const tasks = missingEvidence.slice(0, 4).map((gap, index) => {
    const prior = byRole.get(gap);
    return {
      id: `followup_${prior?.id ?? gap}_${index + 1}`,
      role: prior?.role ?? "gap-closure_research",
      title: prior ? `${prior.title}补查` : `${gap} 补查`,
      objective: prior ? `补足 ${prior.title} 的来源证据或解决冲突。` : `补足 ${gap} 的来源证据。`,
      questions: prior?.questions ?? [`What public source can verify ${gap}?`],
      searchHints: prior?.searchHints ?? [gap]
    };
  });

  return tasks.length
    ? tasks
    : [
        {
          id: "evidence-gap_research",
          role: "evidence-gap_research",
          title: "证据缺口补查",
          objective: "补足缺少公开来源支持的关键条件。",
          questions: ["哪些关键结论还缺来源？"],
          searchHints: ["official source evidence"]
        }
      ];
}

function buildVerifierPrompt(input: VerifierInput): string {
  return `用户问题：
${input.prompt}

Coordinator plan:
${JSON.stringify(input.plan, null, 2)}

Agent reports:
${JSON.stringify(input.reports, null, 2)}

输出严格 JSON：
{
  "status": "pass|needs_more_research|failed",
  "summary": "中文核验摘要",
  "issues": [
    { "type": "missing_source|contradiction|missing_evidence|agent_failed", "severity": "low|medium|high", "message": "...", "relatedTaskId": "..." }
  ],
  "contradictions": [],
  "missingEvidence": ["..."],
  "recommendedNextTasks": [
    {
      "id": "growth_research",
      "role": "growth_research",
      "title": "增长率补查",
      "objective": "补足公开增长率证据",
      "questions": ["..."],
      "searchHints": ["English search hint"]
    }
  ],
  "unknowns": ["..."]
}

必须检查：无来源结论、来源不支撑、Agent 间冲突、关键条件缺口。`;
}
