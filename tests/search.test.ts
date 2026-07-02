import { describe, expect, it } from "vitest";
import { buildBingSearchUrl, filterLowValueResults, parseSearchResults } from "@/lib/search";

describe("buildBingSearchUrl", () => {
  it("targets the overseas English Bing market", () => {
    const url = new URL(buildBingSearchUrl("Andromeda Robotics Grace Brown"));

    expect(url.hostname).toBe("www.bing.com");
    expect(url.searchParams.get("mkt")).toBe("en-US");
    expect(url.searchParams.get("cc")).toBe("US");
    expect(url.searchParams.get("setlang")).toBe("en-US");
    expect(url.searchParams.get("ensearch")).toBe("1");
  });
});

describe("parseSearchResults", () => {
  it("extracts result titles and decoded URLs from DuckDuckGo HTML", () => {
    const html = `
      <html>
        <body>
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone&amp;rut=abc">First Result</a>
          <a class="result__a" href="https://example.com/two">Second Result</a>
        </body>
      </html>
    `;

    const results = parseSearchResults(html);

    expect(results).toEqual([
      { title: "First Result", url: "https://example.com/one" },
      { title: "Second Result", url: "https://example.com/two" }
    ]);
  });

  it("extracts result titles and URLs from Bing HTML", () => {
    const html = `
      <html>
        <body>
          <li class="b_algo">
            <h2><a href="https://example.com/andromeda">Andromeda Robotics raises funding</a></h2>
            <p>Snippet text</p>
          </li>
          <li class="b_algo">
            <h2><a href="https://example.com/grace">Grace Brown discusses AI robots</a></h2>
          </li>
        </body>
      </html>
    `;

    const results = parseSearchResults(html);

    expect(results).toEqual([
      { title: "Andromeda Robotics raises funding", url: "https://example.com/andromeda" },
      { title: "Grace Brown discusses AI robots", url: "https://example.com/grace" }
    ]);
  });

  it("unwraps Bing redirect URLs before filtering internal search links", () => {
    const html = `
      <html>
        <body>
          <li class="b_algo">
            <h2>
              <a href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1aHR0cHM6Ly9vcGVuYWkuY29tLw&amp;ntb=1">
                OpenAI Official Website
              </a>
            </h2>
          </li>
        </body>
      </html>
    `;

    const results = parseSearchResults(html);

    expect(results).toEqual([{ title: "OpenAI Official Website", url: "https://openai.com/" }]);
  });

  it("filters dictionary and generic government pages from search results", () => {
    const results = filterLowValueResults([
      { title: "Australia 是什么意思", url: "https://www.iciba.com/word?w=Australia" },
      { title: "About Australia", url: "https://www.dfat.gov.au/about-australia" },
      { title: "Grace Brown - CEO @ Andromeda", url: "https://www.linkedin.com/in/grace" }
    ]);

    expect(results).toEqual([{ title: "Grace Brown - CEO @ Andromeda", url: "https://www.linkedin.com/in/grace" }]);
  });
});
