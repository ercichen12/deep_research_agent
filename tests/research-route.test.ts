import { describe, expect, it } from "vitest";
import { parseResearchBudget } from "@/app/api/research/route";

describe("parseResearchBudget", () => {
  it("accepts bounded positive integer research budget overrides", () => {
    expect(
      parseResearchBudget({
        maxIterations: 1,
        queriesPerIteration: "2",
        resultsPerIteration: 3
      })
    ).toEqual({
      maxIterations: 1,
      queriesPerIteration: 2,
      resultsPerIteration: 3
    });
  });

  it("ignores invalid budget overrides so defaults stay high-precision", () => {
    expect(
      parseResearchBudget({
        maxIterations: 0,
        queriesPerIteration: 99,
        resultsPerIteration: "many"
      })
    ).toEqual({});
  });
});
