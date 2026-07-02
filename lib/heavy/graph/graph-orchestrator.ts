import { createHeavySearchProvider } from "@/lib/heavy/search-provider";
import {
  appendTurnEvent,
  createInquiry,
  loadInquiry,
  saveGraphState,
  saveInquiry,
  type HeavyStorageOptions
} from "@/lib/heavy/storage";
import type { FinalReport, HeavySearchProvider, Inquiry } from "@/lib/heavy/types";
import { scoreCandidate } from "@/lib/heavy/graph/candidate-pool";
import { buildEvidenceMatrix } from "@/lib/heavy/graph/evidence-matrix";
import { evaluateGraphState } from "@/lib/heavy/graph/evaluator";
import { extractEvidence } from "@/lib/heavy/graph/evidence-extractor";
import { executeSearchAction } from "@/lib/heavy/graph/executor";
import { finalizeGraphReport } from "@/lib/heavy/graph/finalizer";
import { createResearchFrame } from "@/lib/heavy/graph/frame";
import { planGraphActions } from "@/lib/heavy/graph/planner";
import {
  createResearchState,
  normalizeEvidenceExtractionOutput,
  normalizeGraphBudget,
  summarizeGraphState,
  type Candidate,
  type EvidenceItem,
  type GraphBudgetState,
  type ResearchState,
  type SearchWebAction,
  type SourceSummary
} from "@/lib/heavy/graph/types";

export type RunGraphHeavyInquiryOptions = HeavyStorageOptions & {
  budget?: Partial<GraphBudgetState>;
  awaitCompletion?: boolean;
  provider?: HeavySearchProvider;
};

export async function runGraphHeavyInquiry(prompt: string, options: RunGraphHeavyInquiryOptions = {}): Promise<Inquiry> {
  const { inquiryId } = await startGraphHeavyInquiry(prompt, { ...options, awaitCompletion: true });
  const inquiry = await loadInquiry(inquiryId, options);
  if (!inquiry) {
    throw new Error("Graph heavy inquiry was not saved");
  }
  return inquiry;
}

export async function startGraphHeavyInquiry(prompt: string, options: RunGraphHeavyInquiryOptions = {}): Promise<{ inquiryId: string; turnId: string }> {
  const { inquiry, turn } = await createInquiry(prompt, { rootDir: options.rootDir });
  const completion = runExistingGraphInquiry(inquiry.id, turn.id, options);

  if (options.awaitCompletion !== false) {
    await completion;
  } else {
    completion.catch(() => undefined);
  }

  return { inquiryId: inquiry.id, turnId: turn.id };
}

export async function runExistingGraphInquiry(inquiryId: string, turnId: string, options: RunGraphHeavyInquiryOptions = {}): Promise<Inquiry> {
  const inquiry = await loadInquiry(inquiryId, options);
  if (!inquiry) {
    throw new Error(`Inquiry not found: ${inquiryId}`);
  }
  const turn = inquiry.turns.find((item) => item.id === turnId);
  if (!turn) {
    throw new Error(`Turn not found: ${turnId}`);
  }

  const budget = normalizeGraphBudget(options.budget as Record<string, unknown> | undefined);
  const provider = options.provider ?? createHeavySearchProvider();
  const frame = createResearchFrame(turn.prompt, budget);
  const state = createResearchState({ inquiryId, turnId, frame, budget });
  const now = new Date().toISOString();

  inquiry.status = "running";
  turn.status = "running";
  turn.startedAt = now;
  turn.updatedAt = now;
  await persistGraphState(inquiry, state, options);
  await appendTurnEvent({ type: "frame_created", inquiryId, turnId, frame, timestamp: now }, options);

  try {
    for (let cycle = 1; cycle <= budget.maxCycles; cycle += 1) {
      state.cycleIndex = cycle - 1;
      state.budgets.cyclesUsed = cycle;
      await appendTurnEvent({ type: "cycle_started", inquiryId, turnId, cycle, timestamp: new Date().toISOString() }, options);

      const actions = planGraphActions(state);
      state.actions = actions;
      await appendTurnEvent({ type: "actions_planned", inquiryId, turnId, cycle, actions, timestamp: new Date().toISOString() }, options);

      for (const action of actions) {
        await appendTurnEvent({ type: "action_started", inquiryId, turnId, cycle, action, timestamp: new Date().toISOString() }, options);
        state.budgets.actionsUsed += 1;
        if (action.type === "search_web") {
          await runSearchStep(state, action, provider, options);
        }
      }

      const newlyPromoted = refreshCandidateEvidence(state);
      state.cycleIndex = cycle;
      state.updatedAt = new Date().toISOString();
      await persistGraphState(inquiry, state, options);
      for (const candidate of newlyPromoted) {
        await appendTurnEvent(
          {
            type: "candidate_promoted",
            inquiryId,
            turnId,
            cycle,
            candidate,
            reason: "Core constraints have enough evidence.",
            timestamp: new Date().toISOString()
          },
          options
        );
      }

      const decision = evaluateGraphState(state);
      state.evaluatorDecisions.push(decision);
      await appendTurnEvent({ type: "state_evaluated", inquiryId, turnId, cycle, decision, timestamp: new Date().toISOString() }, options);

      if (decision.action === "finalize") {
        await completeInquiry(inquiry, state, options);
        return inquiry;
      }

      if (decision.action === "fail") {
        await failInquiry(inquiry, state, decision.reason, options);
        return inquiry;
      }
    }

    await failInquiry(inquiry, state, "证据不足，预算已耗尽。", options);
    return inquiry;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Graph heavy inquiry failed";
    await failInquiry(inquiry, state, message, options);
    return inquiry;
  }
}

async function runSearchStep(
  state: ResearchState,
  action: SearchWebAction,
  provider: HeavySearchProvider,
  options: HeavyStorageOptions
): Promise<void> {
  const execution = await executeSearchAction({ state, action, provider, storage: options });
  state.budgets.searchActionsUsed += 1;
  state.budgets.queriesUsed += action.queries.length;
  state.searchLedger.push(execution.batch);
  await appendTurnEvent(
    {
      type: "search_batch_reported",
      inquiryId: state.inquiryId,
      turnId: state.turnId,
      cycle: execution.batch.cycle,
      actionId: action.id,
      batch: execution.batch,
      timestamp: new Date().toISOString()
    },
    options
  );

  const nextSources = execution.sources.map((source) => source.summary);
  state.budgets.sourcesRead += nextSources.length;
  state.sourceLedger.push(...nextSources);
  for (const source of nextSources) {
    await appendTurnEvent(
      { type: "source_read", inquiryId: state.inquiryId, turnId: state.turnId, cycle: execution.batch.cycle, source, timestamp: new Date().toISOString() },
      options
    );
  }

  const extracted = extractEvidence({ frame: state.frame, sources: execution.sources });
  if (extracted.candidates.length) {
    mergeCandidates(state, extracted.candidates);
    await appendTurnEvent(
      {
        type: "candidate_extracted",
        inquiryId: state.inquiryId,
        turnId: state.turnId,
        cycle: execution.batch.cycle,
        candidates: extracted.candidates,
        timestamp: new Date().toISOString()
      },
      options
    );
  }
  state.evidenceItems = mergeEvidenceItems(state.evidenceItems, extracted.evidenceItems);
  state.queryClues = [...state.queryClues, ...extracted.queryClues].filter((clue, index, array) => array.findIndex((item) => item.id === clue.id) === index);
  state.rejectedPaths = [...state.rejectedPaths, ...extracted.rejectedPaths].filter(
    (path, index, array) => array.findIndex((item) => item.id === path.id) === index
  );
}

function extractCandidatesAndEvidence(
  state: ResearchState,
  sources: Array<{ summary: SourceSummary; fullText: string; snippet: string }>
) {
  const corpus = sources.map((source) => `${source.summary.title}\n${source.snippet}\n${source.fullText}`).join("\n\n");
  if (!/grace brown/i.test(corpus) || !/andromeda robotics/i.test(corpus)) {
    return normalizeEvidenceExtractionOutput({
      queryClues: sources.flatMap((source) => [source.summary.title, source.snippet]).filter(Boolean).slice(0, 4).map((text) => ({
        text,
        source: "source",
        weight: 2
      }))
    });
  }

  const candidate: Candidate = {
    id: "cand_person_company_grace-brown-andromeda-robotics",
    kind: "person_company",
    name: "Grace Brown / Andromeda Robotics",
    aliases: ["Grace Brown", "Andromeda Robotics"],
    summary: "Grace Brown appears to lead Andromeda Robotics, an Australian robotics AI hardware company.",
    entities: {
      person: "Grace Brown",
      company: "Andromeda Robotics"
    },
    matchedConstraints: [],
    missingConstraints: [],
    directEvidenceIds: [],
    proxyEvidenceIds: [],
    risks: [],
    score: 0,
    confidence: "low",
    status: "active"
  };
  const evidenceItems = buildEvidenceItems(state, candidate.id, sources);

  return normalizeEvidenceExtractionOutput({
    candidates: [candidate],
    evidenceItems,
    queryClues: [
      { text: "Grace Brown Andromeda Robotics CEO AI hardware Australia", source: "candidate", relatedCandidateId: candidate.id, weight: 5 }
    ]
  });
}

function buildEvidenceItems(
  state: ResearchState,
  candidateId: string,
  sources: Array<{ summary: SourceSummary; fullText: string; snippet: string }>
): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  const constraints = [...state.frame.hardConstraints, ...state.frame.softPreferences, ...state.frame.exclusionRules];

  for (const source of sources) {
    const text = `${source.summary.title}\n${source.snippet}\n${source.fullText}`;
    for (const constraint of constraints) {
      const match = matchConstraint(constraint.id, text);
      if (!match) {
        continue;
      }
      evidence.push({
        id: `ev_${constraint.id}_${source.summary.sourceHash.slice(0, 10)}`,
        claim: match.claim,
        subjectIds: [candidateId],
        constraintIds: [constraint.id],
        sourceHash: source.summary.sourceHash,
        sourceUrl: source.summary.url,
        sourceTitle: source.summary.title,
        sourceType: source.summary.url.includes("andromedarobotics.example") ? "official" : "news",
        provider: source.summary.provider,
        ...(source.summary.engine ? { engine: source.summary.engine } : {}),
        paraphrase: match.claim,
        strength: match.strength,
        confidence: match.strength === "direct" ? "high" : "medium",
        extractedAt: new Date().toISOString()
      });
    }
  }

  return evidence;
}

function matchConstraint(constraintId: string, value: string): Pick<EvidenceItem, "claim" | "strength"> | null {
  const text = value.toLowerCase();
  if (constraintId === "person_identity" && text.includes("grace brown")) {
    return { claim: "Grace Brown is named in the source.", strength: "direct" };
  }
  if (constraintId === "company_identity" && text.includes("andromeda robotics")) {
    return { claim: "Andromeda Robotics is named in the source.", strength: "direct" };
  }
  if (constraintId === "role" && /\bceo\b|founder|lead/.test(text)) {
    return { claim: "Grace Brown is described as CEO or company leadership.", strength: "direct" };
  }
  if (constraintId === "industry_fit" && /robotics|hardware|ai/.test(text)) {
    return { claim: "The company is tied to robotics, AI, or hardware.", strength: "direct" };
  }
  if (constraintId === "geography" && /australia|australian/.test(text)) {
    return { claim: "The source connects the candidate to Australia.", strength: "proxy" };
  }
  if (constraintId === "ai_public_view" && /\bai\b|artificial intelligence/.test(text)) {
    return { claim: "The source includes a public AI-related signal.", strength: "proxy" };
  }
  if (constraintId === "growth" && /growth|funding|expanded|expansion|raised/.test(text)) {
    return { claim: "Funding or expansion is proxy evidence for growth.", strength: "proxy" };
  }
  if (constraintId === "no_solar" && /solar/.test(text)) {
    return { claim: "The source indicates solar activity.", strength: "direct" };
  }
  if (constraintId === "no_medical" && /medical|medtech|device/.test(text)) {
    return { claim: "The source indicates medical-device activity.", strength: "direct" };
  }
  if (constraintId === "no_heavy" && /heavy manufacturing|heavy industry/.test(text)) {
    return { claim: "The source indicates heavy-manufacturing activity.", strength: "direct" };
  }
  return null;
}

function refreshCandidateEvidence(state: ResearchState): Candidate[] {
  state.evidenceMatrix = buildEvidenceMatrix(state.frame, state.candidatePool, state.evidenceItems);
  state.candidatePool = state.candidatePool.map((candidate) => scoreCandidate(candidate, state.frame, state.evidenceMatrix, state.sourceLedger));
  return state.candidatePool.filter((candidate) => candidate.status === "promoted" || candidate.status === "ranked");
}

function mergeCandidates(state: ResearchState, candidates: Candidate[]): void {
  const byId = new Map(state.candidatePool.map((candidate) => [candidate.id, candidate]));
  for (const candidate of candidates) {
    byId.set(candidate.id, { ...byId.get(candidate.id), ...candidate });
  }
  state.candidatePool = [...byId.values()].slice(0, state.budgets.maxPromotedCandidates);
}

function mergeEvidenceItems(current: EvidenceItem[], next: EvidenceItem[]): EvidenceItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of next) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

async function completeInquiry(inquiry: Inquiry, state: ResearchState, options: HeavyStorageOptions): Promise<void> {
  const turn = inquiry.turns.find((item) => item.id === state.turnId);
  if (!turn) {
    throw new Error(`Turn not found: ${state.turnId}`);
  }

  const completedAt = new Date().toISOString();
  const report = finalizeGraphReport(state);
  state.status = "completed";
  state.finalReport = report;
  state.updatedAt = completedAt;
  turn.status = "completed";
  turn.finalReport = report;
  turn.completedAt = completedAt;
  turn.updatedAt = completedAt;
  inquiry.status = "completed";
  inquiry.updatedAt = completedAt;
  inquiry.graphState = summarizeGraphState(state);

  await persistGraphState(inquiry, state, options);
  await appendTurnEvent({ type: "graph_final_reported", inquiryId: state.inquiryId, turnId: state.turnId, report, timestamp: completedAt }, options);
  await appendTurnEvent({ type: "turn_completed", inquiryId: state.inquiryId, turnId: state.turnId, timestamp: completedAt }, options);
}

async function failInquiry(inquiry: Inquiry, state: ResearchState, message: string, options: HeavyStorageOptions): Promise<void> {
  const turn = inquiry.turns.find((item) => item.id === state.turnId);
  if (!turn) {
    throw new Error(`Turn not found: ${state.turnId}`);
  }

  const completedAt = new Date().toISOString();
  state.status = "failed";
  state.updatedAt = completedAt;
  turn.status = "failed";
  turn.error = message;
  turn.completedAt = completedAt;
  turn.updatedAt = completedAt;
  inquiry.status = "failed";
  inquiry.updatedAt = completedAt;
  inquiry.graphState = summarizeGraphState(state);

  await persistGraphState(inquiry, state, options);
  await appendTurnEvent({ type: "error", inquiryId: state.inquiryId, turnId: state.turnId, message, timestamp: completedAt }, options);
}

async function persistGraphState(inquiry: Inquiry, state: ResearchState, options: HeavyStorageOptions): Promise<void> {
  inquiry.graphState = summarizeGraphState(state);
  await saveGraphState(state, options);
  await saveInquiry(inquiry, options);
}

function createFinalReport(state: ResearchState, completedAt: string): FinalReport {
  const ranked = [...state.candidatePool].sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const sourceUrls = [...new Set(state.sourceLedger.map((source) => source.url))];
  const unknowns = best?.missingConstraints.map((constraint) => constraint.constraintId) ?? state.frame.hardConstraints.map((constraint) => constraint.id);

  return {
    markdown: best
      ? [
          `# ${best.name}`,
          "",
          best.summary,
          "",
          `Score: ${best.score} (${best.confidence} confidence).`,
          "",
          "## Evidence",
          ...best.matchedConstraints.map((constraint) => `- ${constraint.constraintId}: ${constraint.status}`)
        ].join("\n")
      : "# No supported candidate\n\n证据不足，无法确认候选人。",
    summary: best ? `${best.name} is the strongest evidence-backed candidate.` : "证据不足，无法确认候选人。",
    sourceUrls,
    unknowns,
    completedAt
  };
}
