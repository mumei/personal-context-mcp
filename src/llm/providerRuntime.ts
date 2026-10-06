/**
 * Provides provider runtime capabilities for the LLM integration layer.
 * Responsibility: This module owns the provider runtime behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * LLM統合層のprovider runtime機能を提供します。
 * 責務: このモジュールは、ここで宣言するprovider runtimeの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import type { TaskMcpConfig } from "#shared/types";
import { CLAUDE_CLI_DEFAULT_MODEL, generateTextWithClaudeCli } from "#llm/providers/claudeCli";
import { CODEX_APP_SERVER_DEFAULT_MODEL, generateTextWithCodexAppServer } from "#llm/providers/codexAppServer";
import { COPILOT_CLI_DEFAULT_MODEL, generateTextWithCopilotCli } from "#llm/providers/copilotCli";
import { CURSOR_CLI_DEFAULT_MODEL, generateTextWithCursorCli } from "#llm/providers/cursorCli";
import { GEMINI_CLI_DEFAULT_MODEL, generateTextWithGeminiCli } from "#llm/providers/geminiCli";
import { generateTextWithLmStudio, LM_STUDIO_DEFAULT_MODEL } from "#llm/providers/lmStudio";
import type { ExternalLlmProvider, LlmGenerationRequest, LlmGenerationResult, LlmGenerator } from "#llm/types";

/**
 * Performs the public `resolveExternalLlmModel` operation provided by this module.
 *
 * このモジュールが提供する公開操作`resolveExternalLlmModel`を実行します。
 */
export function resolveExternalLlmModel(config: TaskMcpConfig, provider: ExternalLlmProvider): string {
  if (provider === "codex_app_server") return config.codexAppServerModel ?? CODEX_APP_SERVER_DEFAULT_MODEL;
  if (provider === "claude_cli") return config.claudeCliModel ?? CLAUDE_CLI_DEFAULT_MODEL;
  if (provider === "copilot_cli") return config.copilotCliModel ?? COPILOT_CLI_DEFAULT_MODEL;
  if (provider === "cursor_cli") return config.cursorCliModel ?? CURSOR_CLI_DEFAULT_MODEL;
  if (provider === "gemini_cli") return config.geminiCliModel ?? GEMINI_CLI_DEFAULT_MODEL;
  return config.lmStudioModel ?? LM_STUDIO_DEFAULT_MODEL;
}

function retryableCodexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("capacity") ||
    message.includes("exited before completion") ||
    message.includes("server overloaded")
  );
}

async function generateWithCodex(config: TaskMcpConfig, request: LlmGenerationRequest): Promise<LlmGenerationResult> {
  const model = resolveExternalLlmModel(config, "codex_app_server");
  const execute = () =>
    generateTextWithCodexAppServer({
      command: config.codexAppServerCommand,
      args: config.codexAppServerArgs,
      prompt: request.prompt,
      cwd: request.cwd,
      model,
      timeoutMs: config.codexAppServerTimeoutMs,
      outputSchema: request.outputSchema,
    });
  let result;
  try {
    result = await execute();
  } catch (error) {
    if (!retryableCodexError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500));
    result = await execute();
  }
  return {
    ...result,
    provider: "codex_app_server",
    model,
  };
}

async function generateWithClaude(config: TaskMcpConfig, request: LlmGenerationRequest): Promise<LlmGenerationResult> {
  const model = resolveExternalLlmModel(config, "claude_cli");
  const result = await generateTextWithClaudeCli({
    command: config.claudeCliCommand,
    args: config.claudeCliArgs,
    prompt: request.prompt,
    cwd: request.cwd,
    model,
    timeoutMs: config.claudeCliTimeoutMs,
    outputSchema: request.outputSchema ?? {},
  });
  return {
    text: result.text,
    provider: "claude_cli",
    model,
    sessionId: result.sessionId,
  };
}

async function generateWithCopilot(config: TaskMcpConfig, request: LlmGenerationRequest): Promise<LlmGenerationResult> {
  const model = resolveExternalLlmModel(config, "copilot_cli");
  const result = await generateTextWithCopilotCli({
    command: config.copilotCliCommand,
    args: config.copilotCliArgs,
    prompt: request.prompt,
    cwd: request.cwd,
    model,
    timeoutMs: config.copilotCliTimeoutMs,
    outputSchema: request.outputSchema ?? {},
  });
  return { text: result.text, provider: "copilot_cli", model };
}

async function generateWithCursor(config: TaskMcpConfig, request: LlmGenerationRequest): Promise<LlmGenerationResult> {
  const model = resolveExternalLlmModel(config, "cursor_cli");
  const result = await generateTextWithCursorCli({
    command: config.cursorCliCommand,
    args: config.cursorCliArgs,
    prompt: request.prompt,
    cwd: request.cwd,
    model,
    timeoutMs: config.cursorCliTimeoutMs,
    outputSchema: request.outputSchema ?? {},
  });
  return { text: result.text, provider: "cursor_cli", model, sessionId: result.sessionId };
}

async function generateWithGemini(config: TaskMcpConfig, request: LlmGenerationRequest): Promise<LlmGenerationResult> {
  const model = resolveExternalLlmModel(config, "gemini_cli");
  const result = await generateTextWithGeminiCli({
    command: config.geminiCliCommand,
    args: config.geminiCliArgs,
    prompt: request.prompt,
    cwd: request.cwd,
    model,
    timeoutMs: config.geminiCliTimeoutMs,
    outputSchema: request.outputSchema ?? {},
  });
  return { text: result.text, provider: "gemini_cli", model };
}

async function generateWithLmStudio(
  config: TaskMcpConfig,
  request: LlmGenerationRequest,
): Promise<LlmGenerationResult> {
  const model = resolveExternalLlmModel(config, "lm_studio");
  const result = await generateTextWithLmStudio({
    baseUrl: config.lmStudioBaseUrl,
    apiToken: config.lmStudioApiToken,
    prompt: request.prompt,
    model,
    timeoutMs: config.lmStudioTimeoutMs,
    outputSchema: request.outputSchema ?? {},
  });
  return { text: result.text, provider: "lm_studio", model };
}

/**
 * Performs the public `createExternalLlmGenerator` operation provided by this module.
 *
 * このモジュールが提供する公開操作`createExternalLlmGenerator`を実行します。
 */
export function createExternalLlmGenerator(config: TaskMcpConfig, provider: ExternalLlmProvider): LlmGenerator {
  if (provider === "codex_app_server") return (request) => generateWithCodex(config, request);
  if (provider === "claude_cli") return (request) => generateWithClaude(config, request);
  if (provider === "copilot_cli") return (request) => generateWithCopilot(config, request);
  if (provider === "cursor_cli") return (request) => generateWithCursor(config, request);
  if (provider === "gemini_cli") return (request) => generateWithGemini(config, request);
  return (request) => generateWithLmStudio(config, request);
}
