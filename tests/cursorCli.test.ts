import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cursorCliArguments, generateTextWithCursorCli, parseCursorCliOutput } from "#llm/providers/cursorCli";

const request = {
  command: process.execPath,
  args: [fileURLToPath(new URL("./fixtures/fakeCursor.mjs", import.meta.url))],
  prompt: "summarize this",
  cwd: process.cwd(),
  model: "gpt-5",
  timeoutMs: 5_000,
  outputSchema: { type: "object" },
};

describe("Cursor CLI provider", () => {
  it("uses headless JSON output without enabling automatic file changes", () => {
    const args = cursorCliArguments(request);
    expect(args).toContain("-p");
    expect(args).toContain("json");
    expect(args).toContain("--model");
    expect(args).not.toContain("--force");
    expect(args[args.indexOf("-p") + 1]).toContain("Return only JSON matching this JSON Schema");
  });

  it("executes from an isolated directory and returns generated text", async () => {
    const result = await generateTextWithCursorCli(request);
    const payload = JSON.parse(result.text);
    expect(payload).toMatchObject({ model: "gpt-5" });
    expect(payload.cwd).not.toBe(request.cwd);
    expect(result.sessionId).toBe("cursor-test-session");
  });

  it("rejects invalid or failed output", () => {
    expect(() => parseCursorCliOutput("not-json")).toThrow("invalid JSON");
    expect(() => parseCursorCliOutput('{"is_error":true,"result":"failed"}')).toThrow("failed");
  });

  it("terminates a process that exceeds the configured timeout", async () => {
    await expect(generateTextWithCursorCli({ ...request, prompt: "timeout", timeoutMs: 30 })).rejects.toThrow(
      "timed out after 30ms",
    );
  });
});
