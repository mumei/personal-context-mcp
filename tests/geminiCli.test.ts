import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { geminiCliArguments, generateTextWithGeminiCli, parseGeminiCliOutput } from "#llm/providers/geminiCli";

const request = {
  command: process.execPath,
  args: [fileURLToPath(new URL("./fixtures/fakeGemini.mjs", import.meta.url))],
  prompt: "summarize this",
  cwd: process.cwd(),
  model: "gemini-2.5-pro",
  timeoutMs: 5_000,
  outputSchema: { type: "object" },
};

describe("Gemini CLI provider", () => {
  it("uses headless JSON output and a fixed model", () => {
    const args = geminiCliArguments(request);
    expect(args).toContain("--prompt");
    expect(args).toContain("json");
    expect(args[args.indexOf("--model") + 1]).toBe("gemini-2.5-pro");
    expect(args).toContain("--skip-trust");
    expect(args[args.indexOf("--prompt") + 1]).toContain("Return only JSON matching this JSON Schema");
  });

  it("executes from an isolated directory and returns generated text", async () => {
    const result = await generateTextWithGeminiCli(request);
    const payload = JSON.parse(result.text);
    expect(payload).toMatchObject({ model: "gemini-2.5-pro" });
    expect(payload.cwd).not.toBe(request.cwd);
  });

  it("rejects invalid or failed output", () => {
    expect(() => parseGeminiCliOutput("not-json")).toThrow("invalid JSON");
    expect(() => parseGeminiCliOutput('{"error":{"message":"failed"}}')).toThrow("failed");
  });

  it("terminates a process that exceeds the configured timeout", async () => {
    await expect(generateTextWithGeminiCli({ ...request, prompt: "timeout", timeoutMs: 30 })).rejects.toThrow(
      "timed out after 30ms",
    );
  });
});
