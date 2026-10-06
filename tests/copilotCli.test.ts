import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { copilotCliArguments, generateTextWithCopilotCli, parseCopilotCliOutput } from "#llm/providers/copilotCli";

const request = {
  command: process.execPath,
  args: [fileURLToPath(new URL("./fixtures/fakeCopilot.mjs", import.meta.url))],
  prompt: "summarize this",
  cwd: process.cwd(),
  model: "gpt-5.3-codex",
  timeoutMs: 5_000,
  outputSchema: { type: "object" },
};

describe("Copilot CLI provider", () => {
  it("uses silent non-interactive mode and denies local tools", () => {
    const args = copilotCliArguments(request);
    expect(args).toContain("-s");
    expect(args).toContain("--no-ask-user");
    expect(args).toContain("--no-custom-instructions");
    expect(args).toContain("--no-remote");
    expect(args).toContain(
      "--deny-tool=view,grep,glob,create,edit,apply_patch,write_bash,write_powershell,web_fetch,task,skill",
    );
    expect(args[args.indexOf("-p") + 1]).toContain("Return only JSON matching this JSON Schema");
  });

  it("executes a CLI process and returns the assistant text", async () => {
    const result = await generateTextWithCopilotCli(request);
    expect(JSON.parse(result.text)).toMatchObject({ model: "gpt-5.3-codex" });
  });

  it("rejects empty output", () => {
    expect(() => parseCopilotCliOutput("  ")).toThrow("no generated output");
  });

  it("terminates a CLI process that exceeds the configured timeout", async () => {
    await expect(generateTextWithCopilotCli({ ...request, prompt: "timeout", timeoutMs: 30 })).rejects.toThrow(
      "timed out after 30ms",
    );
  });
});
