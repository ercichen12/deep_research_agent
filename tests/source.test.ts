import { describe, expect, it } from "vitest";
import { extractReadableText } from "@/lib/source";

describe("extractReadableText", () => {
  it("removes scripts/styles, keeps useful text, and truncates long pages", () => {
    const html = `
      <html>
        <head>
          <title>Useful Page</title>
          <style>.hidden { color: red; }</style>
          <script>window.secret = "ignore";</script>
        </head>
        <body>
          <h1>Andromeda Robotics</h1>
          <p>Grace Brown is the CEO and co-founder.</p>
          <p>${"AI robotics ".repeat(500)}</p>
        </body>
      </html>
    `;

    const text = extractReadableText(html, 220);

    expect(text).toContain("Useful Page");
    expect(text).toContain("Grace Brown");
    expect(text).not.toContain("window.secret");
    expect(text.length).toBeLessThanOrEqual(220);
  });

  it("can keep substantially more page text for downstream page readers", () => {
    const html = `
      <html>
        <head><title>Long Page</title></head>
        <body>
          <h1>Grace Brown and Andromeda Robotics</h1>
          <p>${"emotionally intelligent humanoid robotics evidence ".repeat(900)}</p>
        </body>
      </html>
    `;

    const text = extractReadableText(html, 20000);

    expect(text.length).toBeGreaterThan(15000);
    expect(text).toContain("Grace Brown and Andromeda Robotics");
  });
});
