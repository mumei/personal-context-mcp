import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { claudeCliArguments, generateTextWithClaudeCli, parseClaudeCliOutput } from "#llm/providers/claudeCli";

const request = {
  command: process.execPath,
  args: [fileURLToPath(new URL("./fixtures/fakeClaude.mjs", import.meta.url))],
  prompt: "summarize this",
  cwd: process.cwd(),
  model: "claude-sonnet-4-6",
  timeoutMs: 5_000,
  outputSchema: { type: "object" },
};

describe("Claude CLI provider", () => {
  it("isolates the child session from tools, MCP servers, and session persistence", () => {
    const args = claudeCliArguments(request);
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(args.slice(args.indexOf("--setting-sources"), args.indexOf("--setting-sources") + 2)).toEqual([
      "--setting-sources",
      "",
    ]);
    expect(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2)).toEqual([
      "--permission-mode",
      "dontAsk",
    ]);
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", ""]);
    expect(args).toContain("--json-schema");
  });

  it("executes a CLI process and extracts structured output", async () => {
    const result = await generateTextWithClaudeCli(request);
    expect(JSON.parse(result.text)).toMatchObject({
      received_prompt: "summarize this",
      model: "claude-sonnet-4-6",
      schema_present: true,
      tools_disabled: true,
      strict_mcp: true,
    });
    expect(result).toMatchObject({ sessionId: "fake-session", totalCostUsd: 0.001 });
  });

  it("rejects failed and malformed envelopes", () => {
    expect(() => parseClaudeCliOutput("not-json")).toThrow("invalid JSON");
    expect(() => parseClaudeCliOutput(JSON.stringify({ is_error: true, result: "failed" }))).toThrow("failed");
  });

  it("terminates a CLI process that exceeds the configured timeout", async () => {
    await expect(generateTextWithClaudeCli({ ...request, prompt: "hang", timeoutMs: 30 })).rejects.toThrow(
      "timed out after 30ms",
    );
  });
});
