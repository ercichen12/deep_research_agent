import type { FinalReport } from "@/lib/heavy/types";
import { rankCandidates } from "@/lib/heavy/graph/candidate-pool";
import type { ResearchState } from "@/lib/heavy/graph/types";

export function finalizeGraphReport(state: ResearchState): FinalReport {
  const ranked = rankCandidates(state.candidatePool).filter((candidate) => candidate.status !== "rejected");
  const top = ranked[0];
  const evidenceUrls = state.evidenceItems.map((item) => item.sourceUrl).filter(unique);
  const unknowns = candidateUnknowns(state);

  if (!top) {
    if (state.evidenceItems.length > 0 && isWorkflowLikeTask(state.frame.taskKind)) {
      return finalizeWorkflowReport(state);
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
    markdown: `# 一句话结论\n\n最大可能候选是 **${top.name}**，当前置信度为 ${top.confidence}，评分 ${top.score}/100。\n\n# 最大可能答案 / 候选排名\n\n1. ${top.name} - ${top.summary}\n\n# 证据矩阵\n\n| 条件 | 状态 | 来源 |\n|---|---|---|\n${matrixRows}\n\n# 直接证据\n\n${formatEvidence(directEvidence, 12)}\n\n# 代理证据\n\n${formatEvidence(proxyEvidence, 10)}\n\n# 排除项和被拒路径\n\n${state.rejectedPaths.map((path) => `- ${path.title}: ${path.reason}`).join("\n") || "- 暂无明确被拒路径"}\n\n# 未确认项\n\n${unknowns.map((item) => `- ${item}`).join("\n") || "- 暂无"}\n\n# 下一步建议\n\n- 对缺失条件继续查官方页、新闻采访、融资或年报类来源。\n\n# 来源\n\n${evidenceUrls.map((url) => `- ${url}`).join("\n")}`,
    summary: `最大可能候选：${top.name}`,
    sourceUrls: evidenceUrls,
    unknowns,
    completedAt: new Date().toISOString()
  };
}

function finalizeWorkflowReport(state: ResearchState): FinalReport {
  const sourceUrls = state.evidenceItems.map((item) => item.sourceUrl).filter(unique);
  const unknowns = workflowUnknowns(state);
  const directEvidence = state.evidenceItems.filter((item) => item.strength === "direct");
  const proxyEvidence = state.evidenceItems.filter((item) => item.strength === "proxy" || item.strength === "weak");
  const matrix = workflowEvidenceMatrix(state);

  if (isHs8542Workflow(state)) {
    return {
      markdown: `# 一句话结论

最大可能答案不是“继续搜更多网页”，而是把 HS8542 海关记录落成一条 **可审计的数据流水线**：清洗原始记录，合并买卖双方实体，先排除制造/自用/物流噪声，再用交易行为识别同行和潜在客户，最后只把 EOL/HTF 当作外部验证字段，不能从 HS code 单独推断。

# 最大可能工作流

| 顺序 | 阶段 | 输入 | 输出 | 关键规则 |
|---:|---|---|---|---|
| 1 | Raw ingest | HS8542 shipment rows, importer/exporter, product description, date, quantity, value, origin/destination | raw_shipments | 保留原始行号、来源、抓取时间，不在原表覆盖清洗结果 |
| 2 | Cleaning | raw_shipments | normalized_shipments | 标准化公司名、地址、国家、HS/HTS code、日期、币种、数量单位；删除空 importer/exporter 和明显测试行 |
| 3 | Entity merge | normalized party fields | entities, entity_aliases | 公司名归一、地址/国家/域名/电话辅助合并；相似但证据不足的只进候选合并队列 |
| 4 | Strong exclusion | entities + shipment context | excluded_entities | 排除 manufacturer/internal-use/forwarder/logistics/repair-only 信号，尤其是 FOR MANUFACTURING 不能直接当买家需求 |
| 5 | Peer detection | supplier overlap, lane overlap, HS8542 mix, shipment rhythm | peer_candidates | 同供应商、同贸易 lane、同品类结构、相似采购频次形成同行/竞品候选 |
| 6 | Customer tiering | cleaned shipments + external verification | customer_scores, customer_tiers | 先用贸易行为打分，再用外部 EOL/HTF、官网、库存/采购线索校验 |
| 7 | Storage and audit | all intermediate tables | research warehouse | 每个分数、排除、合并、外部验证都保留 evidence_id 和 source_url |

# 字段和表结构

| 表 | 必备字段 | 用途 |
|---|---|---|
| raw_shipments | source_id, row_id, hs_code, description, importer_raw, exporter_raw, date, value, quantity, origin, destination | 原始事实层，支持回溯 |
| normalized_shipments | shipment_id, importer_entity_candidate, exporter_entity_candidate, normalized_description, normalized_value_usd, normalized_quantity, trade_lane | 清洗后的分析层 |
| entities | entity_id, canonical_name, country, entity_type, confidence, merged_from_aliases | 买家/供应商/物流/制造商实体 |
| entity_aliases | alias, entity_id, match_method, match_confidence, evidence_id | 解释为什么合并 |
| exclusion_flags | entity_id, flag_type, reason, evidence_id | 排除制造、自用、物流、维修等噪声 |
| peer_candidates | entity_id, peer_group_id, shared_suppliers, shared_lanes, similarity_score | 找同行和相似买家 |
| customer_scores | entity_id, recency_score, frequency_score, value_score, supplier_diversity_score, external_fit_score, total_score | 客户分级 |
| external_verifications | entity_id, signal_type, signal_value, source_url, checked_at, confidence | EOL/HTF、官网、产品线、库存需求等外部证据 |

# 客户分级规则

| 等级 | 条件 | 动作 |
|---|---|---|
| A | 近 12 个月有多次 HS8542 进口、金额/频次高、供应商多样、外部证据显示采购或库存相关需求 | 优先人工核验和销售触达 |
| B | 交易行为强，但缺 EOL/HTF 或采购意图外部证据 | 进入二次 enrichment |
| C | 有 HS8542 行为但频次低或金额低 | 批量低成本触达或观察 |
| D | 只有弱交易信号，实体合并不确定 | 暂缓，先补实体证据 |
| E | 命中 manufacturer/internal-use/logistics/repair-only 排除项 | 不作为买家线索 |

# EOL / HTF 边界

- HS8542 只能证明货物分类和贸易行为，不能证明某家公司正在买 EOL/HTF。
- Product description 只能作为候选线索，不能单独推出生命周期状态。
- EOL/HTF 必须来自外部来源：原厂生命周期公告、授权分销商库存、独立库存平台、BOM/采购询盘、维修替换需求、公开招标或采购文本。
- 如果外部验证缺失，结论只能写成 “HS8542 buyer candidate”，不能写成 “EOL/HTF buyer”。

# 证据矩阵

| 条件 | 状态 | 直接证据 | 代理证据 |
|---|---|---:|---:|
${matrix}

# 直接证据

${formatEvidence(directEvidence, 12)}

# 代理证据

${formatEvidence(proxyEvidence, 10)}

# 排除项和被拒路径

${state.rejectedPaths.map((path) => `- ${path.title}: ${path.reason}`).join("\n") || "- 当前没有明确被拒路径；执行时必须新增 manufacturer/internal-use/logistics 排除队列。"}

# 未确认项

${unknowns.map((item) => `- ${item}`).join("\n")}

# 下一步执行顺序

1. 先抽 500 到 2,000 行 HS8542 样本，跑 raw -> normalized -> entity merge。
2. 人工抽查前 50 个 entity merge，确认合并阈值不会误合并同名公司。
3. 建立 exclusion_flags，先剔除 manufacturer、logistics、internal-use、repair-only。
4. 对剩余实体跑 recency/frequency/value/supplier diversity 分数。
5. 对 A/B 级实体做外部 EOL/HTF enrichment，不足证据的保持 unknown。
6. 产出 A/B/C/D/E 名单和每个客户的 evidence packet。

# 来源

${sourceUrls.slice(0, 40).map((url) => `- ${url}`).join("\n")}`,
      summary: "最大可能路径：HS8542 customs-data customer segmentation workflow",
      sourceUrls,
      unknowns,
      completedAt: new Date().toISOString()
    };
  }

  return {
    markdown: `# 一句话结论

最大可能路径是围绕 **${state.frame.deliverable}** 执行；已有证据支持 workflow 方向，但仍需把关键边界保持为 unknown，不能把无来源推断写成确定事实。

# 最大可能路径

${workflowGates(state).map((gate) => `- ${gate}`).join("\n")}

# 证据矩阵

| 条件 | 状态 | 直接证据 | 代理证据 |
|---|---|---:|---:|
${matrix}

# 直接证据

${formatEvidence(directEvidence, 12)}

# 代理证据

${formatEvidence(proxyEvidence, 10)}

# 未确认项

${unknowns.map((item) => `- ${item}`).join("\n")}

# 来源

${sourceUrls.slice(0, 40).map((url) => `- ${url}`).join("\n")}`,
    summary: `最大可能路径：${state.frame.deliverable}`,
    sourceUrls,
    unknowns,
    completedAt: new Date().toISOString()
  };
}

function workflowEvidenceMatrix(state: ResearchState): string {
  return state.frame.hardConstraints
    .map((constraint) => {
      const direct = state.evidenceItems.filter((item) => item.constraintIds.includes(constraint.id) && item.strength === "direct").length;
      const proxy = state.evidenceItems.filter((item) => item.constraintIds.includes(constraint.id) && item.strength !== "direct").length;
      const status = direct > 0 ? "direct-supported" : proxy > 0 ? "proxy-supported" : "unknown";
      return `| ${constraint.label} | ${status} | ${direct} | ${proxy} |`;
    })
    .join("\n");
}

function candidateUnknowns(state: ResearchState): string[] {
  return state.evaluatorDecisions.flatMap((decision) => decision.unresolvedQuestions).filter(unique);
}

function workflowUnknowns(state: ResearchState): string[] {
  const stages = new Set(state.workflowArtifacts.map((artifact) => artifact.stage));
  const unknowns = state.frame.hardConstraints
    .filter((constraint) => !state.evidenceItems.some((item) => item.constraintIds.includes(constraint.id)))
    .map((constraint) => `缺少 ${constraint.label} 的来源证据`);
  if (!stages.has("critique")) {
    unknowns.push("workflow 还没有完成校验挑错");
  }
  if (!stages.has("revision")) {
    unknowns.push("workflow 还没有重建为有序 gates");
  }
  if (isHs8542Workflow(state)) {
    unknowns.push("EOL/HTF 需要外部生命周期、库存、采购或供应商来源验证，不能由 HS8542 单独确认");
    unknowns.push("客户分级阈值需要用真实样本分布校准");
    unknowns.push("实体合并阈值需要人工抽样验证，避免误合并同名公司");
  }
  return unknowns.filter(unique);
}

function workflowGates(state: ResearchState): string[] {
  const revision = [...state.workflowArtifacts].reverse().find((artifact) => artifact.stage === "revision" && artifact.orderedGates.length > 0);
  if (revision) {
    return revision.orderedGates;
  }
  return [
    `Define success criteria for ${state.frame.deliverable}.`,
    "Collect and normalize source data.",
    "Extract evidence and label unsupported assumptions.",
    "Build ordered gates and keep unknowns explicit."
  ];
}

function formatEvidence(items: ResearchState["evidenceItems"], limit = 20): string {
  const seen = new Set<string>();
  const lines = [];
  for (const item of items) {
    const key = `${item.claim}|${item.sourceUrl}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    lines.push(`- ${item.claim} [来源](${item.sourceUrl})`);
    if (lines.length >= limit) {
      break;
    }
  }
  return lines.join("\n") || "- 暂无";
}

function isWorkflowLikeTask(taskKind: ResearchState["frame"]["taskKind"]): boolean {
  return taskKind === "data_workflow_design" || taskKind === "sales_strategy" || taskKind === "market_list_building" || taskKind === "technical_verification";
}

function isHs8542Workflow(state: ResearchState): boolean {
  return state.frame.taskKind === "data_workflow_design" && /hs\s*8542|hs8542|customs|海关/i.test(state.frame.userGoal);
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}
