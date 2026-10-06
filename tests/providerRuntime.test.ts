import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createExternalLlmGenerator, resolveExternalLlmModel } from "#llm/providerRuntime";
import { CLAUDE_CLI_DEFAULT_MODEL } from "#llm/providers/claudeCli";
import { CODEX_APP_SERVER_DEFAULT_MODEL } from "#llm/providers/codexAppServer";
import { COPILOT_CLI_DEFAULT_MODEL } from "#llm/providers/copilotCli";
import { CURSOR_CLI_DEFAULT_MODEL } from "#llm/providers/cursorCli";
import { GEMINI_CLI_DEFAULT_MODEL } from "#llm/providers/geminiCli";
import { LM_STUDIO_DEFAULT_MODEL } from "#llm/providers/lmStudio";
import { createTempRepo } from "./helpers.ts";

describe("external LLM provider runtime", () => {
  it("owns default model resolution per provider", async () => {
    const { config } = await createTempRepo();
    config.codexAppServerModel = undefined;
    config.claudeCliModel = undefined;
    config.copilotCliModel = undefined;
    config.cursorCliModel = undefined;
    config.geminiCliModel = undefined;
    config.lmStudioModel = undefined;

    expect(resolveExternalLlmModel(config, "codex_app_server")).toBe(CODEX_APP_SERVER_DEFAULT_MODEL);
    expect(resolveExternalLlmModel(config, "claude_cli")).toBe(CLAUDE_CLI_DEFAULT_MODEL);
    expect(resolveExternalLlmModel(config, "copilot_cli")).toBe(COPILOT_CLI_DEFAULT_MODEL);
    expect(resolveExternalLlmModel(config, "cursor_cli")).toBe(CURSOR_CLI_DEFAULT_MODEL);
    expect(resolveExternalLlmModel(config, "gemini_cli")).toBe(GEMINI_CLI_DEFAULT_MODEL);
    expect(resolveExternalLlmModel(config, "lm_studio")).toBe(LM_STUDIO_DEFAULT_MODEL);
  });

  it("uses the Cursor provider model without receiving a model from the caller", async () => {
    const { config } = await createTempRepo();
    config.cursorCliCommand = process.execPath;
    config.cursorCliArgs = [fileURLToPath(new URL("./fixtures/fakeCursor.mjs", import.meta.url))];
    config.cursorCliModel = "cursor-provider-test";
    const generate = createExternalLlmGenerator(config, "cursor_cli");

    const result = await generate({
      prompt: "provider-owned-model",
      cwd: process.cwd(),
      outputSchema: { type: "object" },
    });

    expect(result).toMatchObject({ provider: "cursor_cli", model: "cursor-provider-test" });
    expect(JSON.parse(result.text)).toMatchObject({ model: "cursor-provider-test" });
  });

  it("uses the Gemini provider model without receiving a model from the caller", async () => {
    const { config } = await createTempRepo();
    config.geminiCliCommand = process.execPath;
    config.geminiCliArgs = [fileURLToPath(new URL("./fixtures/fakeGemini.mjs", import.meta.url))];
    config.geminiCliModel = "gemini-provider-test";
    const generate = createExternalLlmGenerator(config, "gemini_cli");

    const result = await generate({
      prompt: "provider-owned-model",
      cwd: process.cwd(),
      outputSchema: { type: "object" },
    });

    expect(result).toMatchObject({ provider: "gemini_cli", model: "gemini-provider-test" });
    expect(JSON.parse(result.text)).toMatchObject({ model: "gemini-provider-test" });
  });

  it("uses the Copilot provider model without receiving a model from the caller", async () => {
    const { config } = await createTempRepo();
    config.copilotCliCommand = process.execPath;
    config.copilotCliArgs = [fileURLToPath(new URL("./fixtures/fakeCopilot.mjs", import.meta.url))];
    config.copilotCliModel = "copilot-provider-test";
    const generate = createExternalLlmGenerator(config, "copilot_cli");

    const result = await generate({
      prompt: "provider-owned-model",
      cwd: process.cwd(),
      outputSchema: { type: "object" },
    });

    expect(result).toMatchObject({ provider: "copilot_cli", model: "copilot-provider-test" });
    expect(JSON.parse(result.text)).toMatchObject({ model: "copilot-provider-test" });
  });

  it("uses the selected provider model without receiving a model from the caller", async () => {
    const { config } = await createTempRepo();
    config.claudeCliCommand = process.execPath;
    config.claudeCliArgs = [fileURLToPath(new URL("./fixtures/fakeClaude.mjs", import.meta.url))];
    config.claudeCliModel = "claude-provider-test";
    const generate = createExternalLlmGenerator(config, "claude_cli");

    const result = await generate({
      prompt: "provider-owned-model",
      cwd: process.cwd(),
      outputSchema: { type: "object" },
    });

    expect(result).toMatchObject({ provider: "claude_cli", model: "claude-provider-test" });
    expect(JSON.parse(result.text)).toMatchObject({ model: "claude-provider-test" });
  });
});
