import { describe, expect, it } from "vitest";
import {
  classifyEvidenceSource,
  findExpectedSignalHits,
  summarizeSearchBatch
} from "@/lib/heavy/graph/source-classification";
import { buildEvidenceMatrix, hardConstraintsEnough } from "@/lib/heavy/graph/evidence-matrix";
import { rankCandidates, scoreCandidate } from "@/lib/heavy/graph/candidate-pool";
import { normalizeEvidenceExtractionOutput, normalizeResearchFrame } from "@/lib/heavy/graph/types";
import type { Candidate, SourceSummary } from "@/lib/heavy/graph/types";

describe("Graph Heavy deterministic helpers", () => {
  it("classifies source types and matches expected signals deterministically", () => {
    expect(
      classifyEvidenceSource({
        url: "https://andromedarobotics.example/about",
        title: "Official company about page",
        candidateDomains: ["andromedarobotics.example"]
      })
    ).toBe("official");
    expect(classifyEvidenceSource({ url: "https://www.linkedin.com/in/grace-brown", title: "Grace Brown" })).toBe("profile");
    expect(classifyEvidenceSource({ url: "https://www.supplychainconnect.com/rankings", title: "Distributor ranking" })).toBe("directory");
    expect(classifyEvidenceSource({ url: "https://trade.example.com/customs-data", title: "Import database" })).toBe("database");
    expect(classifyEvidenceSource({ url: "https://example.com/search", title: "Search result", hasFullText: false })).toBe("snippet");

    expect(findExpectedSignalHits(["AI hardware", "CEO", "annual-growth"], ["Grace Brown is CEO of an AI-hardware company."])).toEqual([
      "AI hardware",
      "CEO"
    ]);
  });

  it("summarizes provider calls into empty/weak/mixed/strong search quality", () => {
    const empty = summarizeSearchBatch({
      id: "batch_empty",
      actionId: "act_1",
      cycle: 1,
      queries: ["unfindable query"],
      providerCalls: []
    });
    expect(empty.quality).toBe("empty");

    const weak = summarizeSearchBatch({
      id: "batch_weak",
      actionId: "act_1",
      cycle: 1,
      queries: ["Grace Brown CEO"],
      expectedSignals: ["CEO", "robotics"],
      providerCalls: [
        {
          provider: "opencli",
          engine: "google",
          query: "Grace Brown CEO",
          status: "done",
          durationMs: 10,
          results: [
            { title: "Grace Brown", url: "https://example.com/a", snippet: "CEO", provider: "opencli", engine: "google" }
          ]
        }
      ]
    });
    expect(weak.quality).toBe("weak");

    const strong = summarizeSearchBatch({
      id: "batch_strong",
      actionId: "act_1",
      cycle: 1,
      queries: ["Grace Brown Andromeda Robotics CEO AI hardware"],
      expectedSignals: ["CEO", "robotics", "AI hardware"],
      candidateAliases: ["Grace Brown", "Andromeda Robotics"],
      providerCalls: Array.from({ length: 10 }, (_, index) => ({
        provider: "opencli" as const,
        engine: "google",
        query: "Grace Brown Andromeda Robotics CEO AI hardware",
        status: "done" as const,
        durationMs: 10,
        results: [
          {
            title: index < 2 ? `Official Andromeda Robotics ${index}` : `Robotics source ${index}`,
            url: index < 2 ? `https://andromedarobotics.example/about/${index}` : `https://source${index}.example/article`,
            snippet: "Grace Brown CEO robotics AI hardware",
            provider: "opencli" as const,
            engine: "google"
          }
        ]
      }))
    });

    expect(strong.dedupedResultCount).toBe(10);
    expect(strong.uniqueDomainCount).toBeGreaterThanOrEqual(5);
    expect(strong.officialOrPrimaryCount).toBeGreaterThanOrEqual(2);
    expect(strong.quality).toBe("strong");
  });

  it("builds evidence matrix cells and treats exclusion evidence as rejection", () => {
    const frame = normalizeResearchFrame({
      taskKind: "find_person_company",
      userGoal: "Find candidate",
      deliverable: "candidate ranking",
      hardConstraints: [
        { id: "role", label: "CEO", core: true },
        { id: "geo", label: "Australia", core: true }
      ],
      softPreferences: [{ id: "growth", label: "30% annual growth" }],
      exclusionRules: [{ id: "no_solar", label: "not solar" }]
    });
    const output = normalizeEvidenceExtractionOutput({
      candidates: [{ id: "cand_1", kind: "person_company", name: "Grace Brown / Andromeda", aliases: ["Grace Brown"] }],
      evidenceItems: [
        {
          id: "ev_role",
          claim: "Grace Brown is CEO",
          subjectIds: ["cand_1"],
          constraintIds: ["role"],
          sourceUrl: "https://andromedarobotics.example/team",
          sourceTitle: "Team",
          sourceType: "official",
          provider: "opencli",
          paraphrase: "Official page lists Grace Brown as CEO.",
          strength: "direct"
        },
        {
          id: "ev_growth",
          claim: "Funding suggests growth",
          subjectIds: ["cand_1"],
          constraintIds: ["growth"],
          sourceUrl: "https://news.example/andromeda-funding",
          sourceTitle: "Funding",
          sourceType: "news",
          provider: "opencli",
          paraphrase: "Funding is proxy growth evidence.",
          strength: "proxy"
        },
        {
          id: "ev_exclusion",
          claim: "A rejected candidate sells solar panels",
          subjectIds: ["cand_solar"],
          constraintIds: ["no_solar"],
          sourceUrl: "https://solar.example/about",
          sourceTitle: "Solar",
          sourceType: "official",
          provider: "opencli",
          paraphrase: "The company sells solar panels.",
          strength: "direct"
        }
      ]
    });

    const matrix = buildEvidenceMatrix(frame, [
      ...output.candidates,
      { ...output.candidates[0], id: "cand_solar", name: "Solar Candidate" }
    ], output.evidenceItems);

    expect(matrix.cells.find((cell) => cell.candidateId === "cand_1" && cell.constraintId === "role")?.status).toBe("direct");
    expect(matrix.cells.find((cell) => cell.candidateId === "cand_1" && cell.constraintId === "growth")?.status).toBe("proxy");
    expect(matrix.cells.find((cell) => cell.candidateId === "cand_1" && cell.constraintId === "geo")?.status).toBe("missing");
    expect(matrix.cells.find((cell) => cell.candidateId === "cand_solar" && cell.constraintId === "no_solar")?.status).toBe("excluded");
  });

  it("scores, promotes, and ranks candidates without using LLM-provided scores", () => {
    const frame = normalizeResearchFrame({
      taskKind: "find_person_company",
      userGoal: "Find candidate",
      deliverable: "candidate ranking",
      hardConstraints: [
        { id: "role", label: "CEO", core: true },
        { id: "geo", label: "Australia", core: true }
      ],
      softPreferences: [{ id: "growth", label: "30% annual growth" }],
      exclusionRules: [{ id: "no_solar", label: "not solar" }]
    });
    const candidate: Candidate = {
      id: "cand_1",
      kind: "person_company",
      name: "Grace Brown / Andromeda Robotics",
      aliases: ["Grace Brown", "Andromeda Robotics"],
      summary: "Likely candidate",
      entities: {},
      matchedConstraints: [],
      missingConstraints: [],
      directEvidenceIds: [],
      proxyEvidenceIds: [],
      risks: [],
      score: 0,
      confidence: "low",
      status: "active"
    };
    const evidence = normalizeEvidenceExtractionOutput({
      evidenceItems: [
        {
          id: "ev_role",
          claim: "CEO",
          subjectIds: ["cand_1"],
          constraintIds: ["role"],
          sourceUrl: "https://andromedarobotics.example/team",
          sourceTitle: "Team",
          sourceType: "official",
          provider: "opencli",
          paraphrase: "CEO",
          strength: "direct"
        },
        {
          id: "ev_geo",
          claim: "Australia",
          subjectIds: ["cand_1"],
          constraintIds: ["geo"],
          sourceUrl: "https://news.example/andromeda-australia",
          sourceTitle: "Australia",
          sourceType: "news",
          provider: "opencli",
          paraphrase: "Australia",
          strength: "proxy"
        },
        {
          id: "ev_growth",
          claim: "Growth proxy",
          subjectIds: ["cand_1"],
          constraintIds: ["growth"],
          sourceUrl: "https://funding.example/andromeda",
          sourceTitle: "Funding",
          sourceType: "news",
          provider: "opencli",
          paraphrase: "Growth proxy",
          strength: "proxy"
        }
      ]
    }).evidenceItems;
    const matrix = buildEvidenceMatrix(frame, [candidate], evidence);
    const sources: SourceSummary[] = evidence.map((item) => ({
      sourceHash: item.sourceHash ?? item.id,
      title: item.sourceTitle,
      url: item.sourceUrl,
      provider: item.provider,
      engine: "google",
      status: "read",
      readCharCount: 1000,
      evidenceIds: [item.id]
    }));

    const scored = scoreCandidate(candidate, frame, matrix, sources);

    expect(scored.score).toBeGreaterThan(40);
    expect(scored.confidence).toBe("medium");
    expect(scored.status).toBe("promoted");
    expect(hardConstraintsEnough(scored, frame, matrix)).toBe(true);

    const weaker = { ...scored, id: "cand_2", name: "Weaker", score: 10, confidence: "low" as const, directEvidenceIds: [] };
    expect(rankCandidates([weaker, scored]).map((item) => item.id)).toEqual(["cand_1", "cand_2"]);
  });
});
