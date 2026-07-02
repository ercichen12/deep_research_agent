import { createChatCompletion, getOpenAIConfig, type ChatCompletionResult } from "@/lib/openai";
import type { AgentReport, FinalReport, VerificationReport } from "@/lib/heavy/types";

export type SynthesizerInput = {
  prompt: string;
  reports: AgentReport[];
  verificationReports: VerificationReport[];
  incomplete?: boolean;
};

export async function synthesizeFinalReport(input: SynthesizerInput): Promise<FinalReport> {
  try {
    const config = getOpenAIConfig();
    const completion: ChatCompletionResult = await createChatCompletion({
      ...config,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "你是 Heavy 终稿 Agent。你只能读取 AgentReport、VerificationReport 和 sources，不允许自行搜索。输出中文 Markdown。"
        },
        {
          role: "user",
          content: buildSynthesisPrompt(input)
        }
      ]
    });
    return normalizeFinalMarkdown(completion.content, input);
  } catch {
    return heuristicFinalReport(input);
  }
}

export function heuristicFinalReport(input: SynthesizerInput): FinalReport {
  const supportedFindings = input.reports.flatMap((report) =>
    report.findings.filter((finding) => finding.support === "supported" && finding.sourceUrls.length > 0).map((finding) => ({ report, finding }))
  );
  const unknowns = Array.from(
    new Set([
      ...input.verificationReports.flatMap((report) => report.unknowns),
      ...input.verificationReports.flatMap((report) => report.missingEvidence)
    ])
  );
  const sourceUrls = Array.from(new Set(input.reports.flatMap((report) => report.sources.map((source) => source.url))));

  const evidenceLines = supportedFindings.length
    ? supportedFindings.map(({ report, finding }) => `- ${finding.claim} (${finding.sourceUrls.map((url) => `[来源](${url})`).join(", ")})`)
    : ["- 暂无足够来源支持的确定结论。"];

  const markdown = `# ${input.incomplete ? "未完全确认的 Heavy 研究报告" : "Heavy 研究报告"}

## 一句话结论

${supportedFindings.length > 0 ? "已有部分公开来源支持的结论，但仍需按不确定项继续尽调。" : "当前证据不足，不能给出确定结论。"}

## 证据链

${evidenceLines.join("\n")}

## 条件逐条核验

${input.reports.map((report) => `- ${report.role}: ${report.summary}`).join("\n") || "- 暂无 Agent 报告。"}

## 来源引用

${sourceUrls.map((url, index) => `- [${index + 1}] ${url}`).join("\n") || "- 暂无来源。"}

## 不确定项

${unknowns.map((item) => `- ${item}`).join("\n") || "- 暂无。"}

## 下一步建议

- 对不确定项做人工尽调或增加一轮 targeted Heavy run。`;

  return {
    markdown,
    summary: input.incomplete ? "未完全确认" : "已生成 Heavy 终稿",
    sourceUrls,
    unknowns,
    completedAt: new Date().toISOString()
  };
}

function normalizeFinalMarkdown(markdown: string, input: SynthesizerInput): FinalReport {
  const allSourceUrls = Array.from(new Set(input.reports.flatMap((report) => report.sources.map((source) => source.url))));
  const unknowns = Array.from(new Set(input.verificationReports.flatMap((report) => [...report.unknowns, ...report.missingEvidence])));
  const sourceUrls = allSourceUrls.filter((url) => markdown.includes(url));

  return {
    markdown: ensureMarkdownHasUnknowns(markdown.trim(), unknowns),
    summary: input.incomplete ? "未完全确认" : "已生成 Heavy 终稿",
    sourceUrls: sourceUrls.length ? sourceUrls : allSourceUrls,
    unknowns,
    completedAt: new Date().toISOString()
  };
}

function ensureMarkdownHasUnknowns(markdown: string, unknowns: string[]): string {
  if (unknowns.length === 0 || /不确定项|未知|待确认/.test(markdown)) {
    return markdown;
  }

  return `${markdown}

## 不确定项

${unknowns.map((item) => `- ${item}`).join("\n")}`;
}

function buildSynthesisPrompt(input: SynthesizerInput): string {
  return `用户问题：
${input.prompt}

是否未完全确认：${input.incomplete ? "是" : "否"}

AgentReport JSON：
${JSON.stringify(input.reports, null, 2)}

VerificationReport JSON：
${JSON.stringify(input.verificationReports, null, 2)}

请输出 Markdown，结构必须包含：
1. 一句话结论
2. 证据链
3. 条件逐条核验
4. 来源引用，必须使用 source URL 链接
5. 不确定项
6. 下一步建议

规则：
- 不允许自行搜索。
- 不允许把没有 sourceUrls 的 claim 写成确定事实。
- 对 unknowns/missingEvidence 必须进入不确定项。`;
}
