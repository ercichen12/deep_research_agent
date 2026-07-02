import { describe, expect, it } from "vitest";
import { getSeedSources } from "@/lib/seeds";

describe("getSeedSources", () => {
  it("adds Andromeda sources for Australian innovative hardware CEO searches", () => {
    const sources = getSeedSources(
      "我要找澳大利亚创新硬件公司CEO，最好有AI观点文章，不做太阳能板医疗器械重工"
    );

    expect(sources.some((source) => source.title.includes("Andromeda"))).toBe(true);
    expect(sources.some((source) => source.url.includes("andromedarobotics.ai"))).toBe(true);
  });
});
