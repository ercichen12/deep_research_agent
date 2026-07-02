import { createChatCompletion, getOpenAIConfig } from "@/lib/openai";
import {
  normalizeAgentTask,
  normalizeCoordinatorPlan,
  parseJsonObject,
  type AgentTask,
  type CoordinatorPlan,
  type HeavyBudget,
  type VerificationReport
} from "@/lib/heavy/types";

export type CoordinatorInput = {
  prompt: string;
  runIndex: number;
  budget: HeavyBudget;
  historySummary?: string;
  recommendedNextTasks?: AgentTask[];
};

export async function createCoordinatorPlan(input: CoordinatorInput): Promise<CoordinatorPlan> {
  if (input.recommendedNextTasks?.length) {
    return normalizeCoordinatorPlan(
      {
        objective: `Run ${input.runIndex} follows verifier recommended next tasks.`,
        tasks: input.recommendedNextTasks
      },
      input.runIndex,
      input.budget
    );
  }

  try {
    const config = getOpenAIConfig();
    const completion = await createChatCompletion({
      ...config,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "你是 Apodex Heavy 风格的研究主控。你只负责拆分独立子 Agent 任务，不生成最终答案。输出严格 JSON。"
        },
        {
          role: "user",
          content: buildCoordinatorPrompt(input)
        }
      ]
    });
    const normalized = normalizeCoordinatorPlan(parseJsonObject(completion.content), input.runIndex, input.budget);
    if (normalized.tasks.length > 0) {
      return normalized;
    }
  } catch {
    // Heuristic fallback keeps the Heavy run usable when the coordinator model fails.
  }

  return buildHeuristicCoordinatorPlan(input.prompt, input.runIndex, input.budget);
}

export function buildHeuristicCoordinatorPlan(prompt: string, runIndex: number, budget: HeavyBudget): CoordinatorPlan {
  const lower = prompt.toLowerCase();
  const tasks = isDataSolutionPrompt(lower) ? dataSolutionTasks() : findPeopleCompanyTasks();

  return normalizeCoordinatorPlan(
    {
      objective: isDataSolutionPrompt(lower)
        ? "拆分海关数据清洗、实体合并、同行识别、客户分级和架构方案研究。"
        : "拆分找人找公司 Heavy 调研任务，分别核验身份、公司、任职、文章观点、排除条件和增长证据。",
      tasks
    },
    runIndex,
    budget
  );
}

export function tasksFromVerifier(report: VerificationReport, budget: HeavyBudget, runIndex: number): CoordinatorPlan {
  return normalizeCoordinatorPlan(
    {
      objective: `Run ${runIndex} closes verifier gaps.`,
      tasks: report.recommendedNextTasks
    },
    runIndex,
    budget
  );
}

function buildCoordinatorPrompt(input: CoordinatorInput): string {
  return `用户问题：
${input.prompt}

历史摘要：
${input.historySummary || "无"}

预算：
maxAgentsPerRun=${input.budget.maxAgentsPerRun}

输出严格 JSON：
{
  "objective": "本轮研究目标，只拆任务，不回答问题",
  "tasks": [
    {
      "id": "identity_research",
      "role": "identity_research",
      "title": "身份核验",
      "objective": "这个子 Agent 独立要完成什么",
      "questions": ["需要回答的问题"],
      "searchHints": ["英文搜索提示词"]
    }
  ]
}

规则：
- 最多 ${input.budget.maxAgentsPerRun} 个 task。
- task 必须可以独立搜索、读取来源、输出 report。
- 不要输出最终答案。`;
}

function isDataSolutionPrompt(lower: string): boolean {
  return /海关|数据|清洗|客户|分群|分级|同行|存储|架构/.test(lower);
}

function findPeopleCompanyTasks(): AgentTask[] {
  return [
    task("identity_research", "identity_research", "身份核验", "确认候选人姓名、公司、当前职位、所在地是否匹配。", [
      "候选人是否为目标公司的 CEO/Founder/高管？",
      "候选人是否在澳大利亚或与澳大利亚业务强相关？"
    ]),
    task("company-fit_research", "company-fit_research", "公司画像", "确认公司是否属于创新硬件，并识别产品和行业边界。", [
      "公司是否做真实硬件产品？",
      "公司是否具备创新性而非传统制造？"
    ]),
    task("role-tenure_research", "role-tenure_research", "任职年限", "确认候选人在该企业任职是否超过三年。", [
      "候选人何时加入或创立公司？",
      "公开资料是否支持三年以上任期？"
    ]),
    task("article-ai-view_research", "article-ai-view_research", "AI 观点文章", "查找候选人近期发表或接受采访时关于 AI 的观点。", [
      "是否有近期文章、访谈、博客或演讲包含 AI 观点？"
    ]),
    task("exclusion-risk_research", "exclusion-risk_research", "排除项核验", "排除太阳能板、医疗器械、重工制造等不符合条件行业。", [
      "公司是否涉及太阳能板、医疗器械或重工制造？"
    ]),
    task("growth-signal_research", "growth-signal_research", "增长信号", "寻找公开增长率、收入、员工数、融资、客户扩张等增长证据。", [
      "是否有每年增长 30% 或近似增长信号？"
    ])
  ];
}

function dataSolutionTasks(): AgentTask[] {
  return [
    task("data-cleaning_research", "data-cleaning_research", "数据清洗", "研究海关数据字段规范化、异常处理、去重和质量规则。", [
      "海关数据常见脏字段和缺失项如何处理？"
    ]),
    task("entity-resolution_research", "entity-resolution_research", "实体合并", "设计公司名称、地址、联系人和税号等实体合并逻辑。", [
      "如何把同一公司多种写法合并？"
    ]),
    task("peer-identification_research", "peer-identification_research", "同行识别", "研究基于产品、HS code、交易对手、地区的同行识别方法。", [
      "如何判断两个客户是否同行或上下游？"
    ]),
    task("customer-grading_research", "customer-grading_research", "客户分级", "设计客户价值、稳定性、增长潜力和风险的分级指标。", [
      "如何给客户打 A/B/C 级？"
    ]),
    task("data-architecture_analyze", "data-architecture_analyze", "存储架构", "设计文件存储、索引、任务日志和可追溯证据链架构。", [
      "第一版如何存储原始数据、清洗结果和分析结果？"
    ])
  ];
}

function task(id: string, role: string, title: string, objective: string, questions: string[]): AgentTask {
  const searchHints = [title, objective, ...questions].map((value) => value.replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, " ").trim()).filter(Boolean);
  return normalizeAgentTask({
    id,
    role,
    title,
    objective,
    questions,
    searchHints: searchHints.length ? searchHints : [id.replace(/_/g, " ")]
  }) as AgentTask;
}
