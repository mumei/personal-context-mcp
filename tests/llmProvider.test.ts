import { describe, expect, it } from "vitest";
import { selectLlmProvider } from "#llm/providerSelector";

describe("LLM provider selection", () => {
  it("lets an environment override win over client identity", () => {
    expect(selectLlmProvider("copilot_cli", { name: "claude-code", version: "1" }).provider).toBe("copilot_cli");
    expect(selectLlmProvider("codex_app_server", { name: "claude-code", version: "1" }).provider).toBe(
      "codex_app_server",
    );
  });

  it("selects Claude CLI for a Claude client", () => {
    expect(selectLlmProvider("auto", { name: "Claude Code", version: "2" })).toMatchObject({
      provider: "claude_cli",
      reason: "claude_client",
    });
  });

  it("selects Codex App Server for Codex clients", () => {
    expect(selectLlmProvider("auto", { name: "codex-mcp-client", version: "1" })).toMatchObject({
      provider: "codex_app_server",
      reason: "codex_client",
    });
  });

  it("selects Copilot CLI for a GitHub Copilot client", () => {
    expect(selectLlmProvider("auto", { name: "GitHub Copilot", version: "1" })).toMatchObject({
      provider: "copilot_cli",
      reason: "copilot_client",
    });
  });

  it("selects Cursor CLI for Cursor clients", () => {
    expect(selectLlmProvider("auto", { name: "Cursor", version: "1" })).toMatchObject({
      provider: "cursor_cli",
      reason: "cursor_client",
    });
  });

  it("selects Gemini CLI for Gemini clients", () => {
    expect(selectLlmProvider("auto", { name: "Gemini CLI", version: "1" })).toMatchObject({
      provider: "gemini_cli",
      reason: "gemini_client",
    });
  });

  it("selects LM Studio for LM Studio clients", () => {
    expect(selectLlmProvider("auto", { name: "LM Studio", version: "0.4.0" })).toMatchObject({
      provider: "lm_studio",
      reason: "lm_studio_client",
    });
    expect(selectLlmProvider("auto", { name: "lmstudio-mcp-host", version: "1" })).toMatchObject({
      provider: "lm_studio",
      reason: "lm_studio_client",
    });
  });

  it("defaults unknown clients to Codex App Server", () => {
    expect(selectLlmProvider("auto").provider).toBe("codex_app_server");
  });
});
