import { describe, expect, it } from "vitest";
import { buildSearchQueries, containsCjk } from "@/lib/query";

describe("buildSearchQueries", () => {
  it("returns bounded English search queries for a Chinese research prompt", () => {
    const queries = buildSearchQueries(
      "我要找一个公司的CEO，这个公司是做有创新性的硬件，不能做太阳能板、医疗器械、重工制造，公司每年增长30%，CEO在澳大利亚三年以上，最近发过包含AI的文章"
    );

    expect(queries).toHaveLength(5);
    expect(queries[0].query).toContain("Andromeda Robotics");
    expect(queries[0].query).toContain("Australia");
    expect(queries.map((item) => item.query).join(" ")).toContain("CEO");
    expect(queries.map((item) => item.query).join(" ")).toContain("AI");
    expect(queries.map((item) => item.query).join(" ")).toContain("Andromeda Robotics");
    expect(queries.map((item) => item.query).join(" ")).toContain("Morse Micro");
    expect(queries.every((item) => item.query.length <= 140)).toBe(true);
    expect(queries.every((item) => !containsCjk(item.query))).toBe(true);
  });

  it("returns English keywords alongside every query for audit logs", () => {
    const queries = buildSearchQueries("我要找澳大利亚创新硬件公司CEO，最近发过包含AI的文章");

    expect(queries[0]).toEqual(
      expect.objectContaining({
        query: expect.stringContaining("Australia"),
        keywords: expect.arrayContaining(["Australia", "innovative hardware", "CEO", "AI"])
      })
    );
    expect(queries.every((item) => item.keywords.every((keyword) => !containsCjk(keyword)))).toBe(true);
  });
});
