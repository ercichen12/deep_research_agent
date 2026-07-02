import { describe, expect, it } from "vitest";
import {
  buildOpenCliCommand,
  getOpenCliExecutable,
  isOpenCliBridgeError,
  isOpenCliEmptyResult,
  normalizeOpenCliSearchResults,
  openCliMarkdownToSnippet
} from "@/lib/opencli";

describe("normalizeOpenCliSearchResults", () => {
  it("normalizes OpenCLI Brave and DuckDuckGo rows", () => {
    const rows = [
      {
        rank: 1,
        title: "Grace Brown - Talent Corp CEO of Andromeda",
        url: "https://talentcorp.com.au/speakers/grace-brown/",
        snippet: "Co-Founder and CEO of Andromeda Robotics."
      },
      {
        rank: 2,
        title: "Broken",
        url: "",
        snippet: "No URL"
      }
    ];

    expect(normalizeOpenCliSearchResults(rows)).toEqual([
      {
        title: "Grace Brown - Talent Corp CEO of Andromeda",
        url: "https://talentcorp.com.au/speakers/grace-brown/",
        snippet: "Co-Founder and CEO of Andromeda Robotics."
      }
    ]);
  });
});

describe("isOpenCliBridgeError", () => {
  it("detects Browser Bridge connection errors", () => {
    expect(isOpenCliBridgeError("BROWSER_CONNECT: Browser Bridge extension not connected")).toBe(true);
    expect(isOpenCliBridgeError("ordinary failure")).toBe(false);
  });
});

describe("isOpenCliEmptyResult", () => {
  it("detects empty search results so the UI can treat them as a miss, not a failure", () => {
    expect(isOpenCliEmptyResult("code: EMPTY_RESULT\nmessage: Brave search returned no data")).toBe(true);
    expect(isOpenCliEmptyResult("ordinary failure")).toBe(false);
  });
});

describe("openCliMarkdownToSnippet", () => {
  it("removes images and source boilerplate from markdown", () => {
    const snippet = openCliMarkdownToSnippet(`# About
> 原文链接: https://example.com

![](https://image.example/a.png)

Grace Brown

Founder & CEO`, 80);

    expect(snippet).toBe("About Grace Brown Founder & CEO");
  });
});

describe("getOpenCliExecutable", () => {
  it("uses npx.cmd on Windows so child_process can spawn it", () => {
    expect(getOpenCliExecutable("win32")).toBe("npx.cmd");
    expect(getOpenCliExecutable("linux")).toBe("npx");
  });
});

describe("buildOpenCliCommand", () => {
  it("runs npx.cmd through cmd.exe on Windows because execFile cannot spawn .cmd directly", () => {
    expect(buildOpenCliCommand(["brave", "search", "Grace Brown"], "win32")).toEqual({
      file: "cmd.exe",
      args: ["/d", "/s", "/c", "npx.cmd", "-y", "@jackwener/opencli", "brave", "search", "Grace Brown"]
    });
  });

  it("executes npx directly on non-Windows platforms", () => {
    expect(buildOpenCliCommand(["brave", "search", "Grace Brown"], "linux")).toEqual({
      file: "npx",
      args: ["-y", "@jackwener/opencli", "brave", "search", "Grace Brown"]
    });
  });
});
