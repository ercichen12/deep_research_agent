import { findMatrixCell, hardConstraintsEnough } from "@/lib/heavy/graph/evidence-matrix";
import type {
  Candidate,
  ConstraintMatch,
  EvidenceMatrix,
  EvidenceMatrixCell,
  MissingConstraint,
  ResearchFrame,
  SourceSummary
} from "@/lib/heavy/graph/types";

const confidenceWeight: Record<Candidate["confidence"], number> = {
  high: 3,
  medium: 2,
  low: 1
};

export function scoreCandidate(candidate: Candidate, frame: ResearchFrame, matrix: EvidenceMatrix, sources: SourceSummary[]): Candidate {
  const hardCells = frame.hardConstraints.map((constraint) => findMatrixCell(matrix, candidate.id, constraint.id)).filter(isCell);
  const softCells = frame.softPreferences.map((constraint) => findMatrixCell(matrix, candidate.id, constraint.id)).filter(isCell);
  const exclusionCells = frame.exclusionRules.map((constraint) => findMatrixCell(matrix, candidate.id, constraint.id)).filter(isCell);

  const directEvidenceIds = collectEvidenceIds([...hardCells, ...softCells], "direct");
  const proxyEvidenceIds = collectEvidenceIds([...hardCells, ...softCells], "proxy");
  const matchedConstraints = createMatchedConstraints([...hardCells, ...softCells]);
  const missingConstraints = createMissingConstraints(frame, candidate.id, matrix);
  const hasExclusion = exclusionCells.some((cell) => cell.status === "excluded" || cell.status === "contradicted");
  const hardEnough = hardConstraintsEnough(candidate, frame, matrix);
  const sourceScore = scoreSources(sources, [...directEvidenceIds, ...proxyEvidenceIds]);

  const rawScore =
    hardCells.reduce((sum, cell) => sum + scoreConstraintCell(cell, true), 0) +
    softCells.reduce((sum, cell) => sum + scoreConstraintCell(cell, false), 0) +
    sourceScore -
    (hasExclusion ? 100 : 0);
  const score = clamp(Math.round(rawScore), 0, 100);

  return {
    ...candidate,
    matchedConstraints,
    missingConstraints,
    directEvidenceIds,
    proxyEvidenceIds,
    risks: hasExclusion
      ? [...candidate.risks, "Candidate matches an exclusion rule."].filter(unique)
      : candidate.risks,
    score,
    confidence: scoreConfidence({ score, hardCells, hardEnough, directEvidenceIds, proxyEvidenceIds }),
    status: scoreStatus({ score, hasExclusion, hardEnough })
  };
}

export function rankCandidates(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((left, right) => {
    return (
      statusWeight(right.status) - statusWeight(left.status) ||
      right.score - left.score ||
      confidenceWeight[right.confidence] - confidenceWeight[left.confidence] ||
      right.directEvidenceIds.length - left.directEvidenceIds.length ||
      left.name.localeCompare(right.name)
    );
  });
}

function scoreConstraintCell(cell: EvidenceMatrixCell, hard: boolean): number {
  if (cell.status === "direct") {
    return hard ? 34 : 16;
  }
  if (cell.status === "proxy") {
    return hard ? 22 : 9;
  }
  if (cell.status === "contradicted" || cell.status === "excluded") {
    return hard ? -45 : -20;
  }
  return hard ? -8 : 0;
}

function scoreSources(sources: SourceSummary[], evidenceIds: string[]): number {
  const evidenceIdSet = new Set(evidenceIds);
  const relevantSources = sources.filter((source) => source.evidenceIds.some((id) => evidenceIdSet.has(id)));
  const uniqueDomains = new Set(relevantSources.map((source) => domainOf(source.url)).filter(Boolean)).size;
  const officialCount = relevantSources.filter((source) => domainOf(source.url) && /official|team|about/i.test(source.title)).length;

  return Math.min(12, uniqueDomains * 3 + officialCount * 2);
}

function createMatchedConstraints(cells: EvidenceMatrixCell[]): ConstraintMatch[] {
  return cells
    .filter((cell) => cell.status === "direct" || cell.status === "proxy" || cell.status === "contradicted")
    .map((cell) => ({
      constraintId: cell.constraintId,
      status: cell.status === "contradicted" ? "contradicted" : cell.status,
      evidenceIds: cell.evidenceIds
    }));
}

function createMissingConstraints(frame: ResearchFrame, candidateId: string, matrix: EvidenceMatrix): MissingConstraint[] {
  return [...frame.hardConstraints, ...frame.softPreferences]
    .map((constraint) => ({ constraint, cell: findMatrixCell(matrix, candidateId, constraint.id) }))
    .filter(({ cell }) => !cell || cell.status === "missing" || cell.status === "unknown")
    .map(({ constraint, cell }) => ({
      constraintId: constraint.id,
      reason: cell?.rationale ?? `No evidence found for ${constraint.label}.`,
      neededEvidence: [`Find direct evidence for ${constraint.label}.`]
    }));
}

function collectEvidenceIds(cells: EvidenceMatrixCell[], status: "direct" | "proxy"): string[] {
  return [...new Set(cells.filter((cell) => cell.status === status).flatMap((cell) => cell.evidenceIds))];
}

function scoreConfidence(input: {
  score: number;
  hardCells: EvidenceMatrixCell[];
  hardEnough: boolean;
  directEvidenceIds: string[];
  proxyEvidenceIds: string[];
}): Candidate["confidence"] {
  const allHardDirect = input.hardCells.length > 0 && input.hardCells.every((cell) => cell.status === "direct");
  if (input.score >= 75 && allHardDirect && input.directEvidenceIds.length >= 2) {
    return "high";
  }
  if (input.score >= 40 && input.hardEnough && input.directEvidenceIds.length + input.proxyEvidenceIds.length >= 2) {
    return "medium";
  }
  return "low";
}

function scoreStatus(input: { score: number; hasExclusion: boolean; hardEnough: boolean }): Candidate["status"] {
  if (input.hasExclusion) {
    return "rejected";
  }
  if (input.score >= 80 && input.hardEnough) {
    return "ranked";
  }
  if (input.score >= 40 && input.hardEnough) {
    return "promoted";
  }
  return "active";
}

function statusWeight(status: Candidate["status"]): number {
  if (status === "ranked") {
    return 4;
  }
  if (status === "promoted") {
    return 3;
  }
  if (status === "active") {
    return 2;
  }
  return 1;
}

function isCell(value: EvidenceMatrixCell | undefined): value is EvidenceMatrixCell {
  return Boolean(value);
}

function domainOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}
