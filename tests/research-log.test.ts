import { describe, expect, it } from "vitest";
import { buildResearchLogPath } from "@/lib/research-log";

describe("buildResearchLogPath", () => {
  it("creates a stable JSON path under research-runs", () => {
    const path = buildResearchLogPath("run_2026-06-30T11-30-00-000Z_ab12cd34");

    expect(path.replace(/\\/g, "/")).toMatch(/research-runs\/run_2026-06-30T11-30-00-000Z_ab12cd34\.json$/);
  });
});
