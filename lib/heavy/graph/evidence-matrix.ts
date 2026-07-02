import type { Candidate, Constraint, EvidenceItem, EvidenceMatrix, EvidenceMatrixCell, ResearchFrame } from "@/lib/heavy/graph/types";

export function buildEvidenceMatrix(frame: ResearchFrame, candidates: Candidate[], evidenceItems: EvidenceItem[]): EvidenceMatrix {
  const constraints = allConstraints(frame);
  const updatedAt = new Date().toISOString();

  return {
    constraintIds: constraints.map((constraint) => constraint.id),
    candidateIds: candidates.map((candidate) => candidate.id),
    cells: candidates.flatMap((candidate) =>
      constraints.map((constraint) => buildCell(candidate.id, constraint, evidenceItems, frame, updatedAt))
    )
  };
}

export function hardConstraintsEnough(candidate: Candidate, frame: ResearchFrame, matrix: EvidenceMatrix): boolean {
  if (hasBlockingExclusion(candidate.id, frame, matrix)) {
    return false;
  }

  return frame.hardConstraints.every((constraint) => {
    const cell = findCell(matrix, candidate.id, constraint.id);
    if (!cell) {
      return false;
    }
    return cell.status === "direct" || (frame.evidencePolicy.proxyEvidenceAllowed && cell.status === "proxy");
  });
}

export function findMatrixCell(matrix: EvidenceMatrix, candidateId: string, constraintId: string): EvidenceMatrixCell | undefined {
  return findCell(matrix, candidateId, constraintId);
}

function buildCell(
  candidateId: string,
  constraint: Constraint,
  evidenceItems: EvidenceItem[],
  frame: ResearchFrame,
  updatedAt: string
): EvidenceMatrixCell {
  const matchingEvidence = evidenceItems.filter(
    (item) => item.subjectIds.includes(candidateId) && item.constraintIds.includes(constraint.id)
  );
  const evidenceIds = matchingEvidence.map((item) => item.id);
  const bestSourceUrls = [...new Set(matchingEvidence.map((item) => item.sourceUrl).filter(Boolean))].slice(0, 5);
  const status = resolveStatus(constraint, matchingEvidence, frame);

  return {
    candidateId,
    constraintId: constraint.id,
    status,
    evidenceIds,
    bestSourceUrls,
    rationale: buildRationale(status, constraint, matchingEvidence.length),
    updatedAt
  };
}

function resolveStatus(
  constraint: Constraint,
  evidenceItems: EvidenceItem[],
  frame: ResearchFrame
): EvidenceMatrixCell["status"] {
  if (!evidenceItems.length) {
    return "missing";
  }

  if (constraint.kind === "exclusion") {
    return "excluded";
  }

  if (evidenceItems.some((item) => item.strength === "contradictory")) {
    return "contradicted";
  }

  if (evidenceItems.some((item) => item.strength === "direct")) {
    return "direct";
  }

  if (frame.evidencePolicy.proxyEvidenceAllowed && evidenceItems.some((item) => item.strength === "proxy")) {
    return "proxy";
  }

  return "unknown";
}

function buildRationale(status: EvidenceMatrixCell["status"], constraint: Constraint, evidenceCount: number): string {
  if (status === "missing") {
    return `No evidence found for ${constraint.label}.`;
  }
  if (status === "excluded") {
    return `Exclusion rule matched: ${constraint.label}.`;
  }
  return `${evidenceCount} evidence item${evidenceCount === 1 ? "" : "s"} support ${constraint.label} as ${status}.`;
}

function hasBlockingExclusion(candidateId: string, frame: ResearchFrame, matrix: EvidenceMatrix): boolean {
  return frame.exclusionRules.some((constraint) => {
    const cell = findCell(matrix, candidateId, constraint.id);
    return cell?.status === "excluded" || cell?.status === "contradicted";
  });
}

function allConstraints(frame: ResearchFrame): Constraint[] {
  return [...frame.hardConstraints, ...frame.softPreferences, ...frame.exclusionRules];
}

function findCell(matrix: EvidenceMatrix, candidateId: string, constraintId: string): EvidenceMatrixCell | undefined {
  return matrix.cells.find((cell) => cell.candidateId === candidateId && cell.constraintId === constraintId);
}
