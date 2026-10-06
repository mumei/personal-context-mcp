/**
 * @packageDocumentation
 * Selects the external LLM provider used by the web UI and invokes generation requests.
 * It does not build feature-specific prompts, parse generated responses, or persist results.
 * Web UI から利用する外部 LLM プロバイダーを選択し、生成リクエストを実行する。
 * 個別機能のプロンプト構築、生成レスポンスの解析、結果の永続化は担当しない。
 */
import { createExternalLlmGenerator } from "#llm/providerRuntime";
import type { ExternalLlmProvider, LlmGenerationRequest, LlmGenerationResult } from "#llm/types";
import type { TaskMcpConfig } from "#shared/types";

/**
 * Resolves the external LLM provider available to web requests.
 * Web リクエストで利用可能な外部 LLM プロバイダーを解決する。
 */
export function webExternalProvider(config: TaskMcpConfig): ExternalLlmProvider {
  return config.reportLlmProvider === "auto" ? "codex_app_server" : config.reportLlmProvider;
}

/**
 * Sends a generation request to the external LLM configured for the web application.
 * Web 用に構成された外部 LLM へ生成リクエストを送信する。
 */
export async function generateWebLlm(config: TaskMcpConfig, input: LlmGenerationRequest): Promise<LlmGenerationResult> {
  return createExternalLlmGenerator(config, webExternalProvider(config))(input);
}

/**
 * Converts an LLM generation result into common Web API metadata.
 * LLM 生成結果を Web API の共通メタデータへ変換する。
 */
export function webLlmMetadata(config: TaskMcpConfig, result: LlmGenerationResult) {
  const provider = result.provider ?? webExternalProvider(config);
  return {
    llm_provider: provider,
    model: result.model,
    ...(provider === "codex_app_server"
      ? { codex_thread_id: result.threadId, codex_turn_id: result.turnId }
      : provider === "claude_cli"
        ? { claude_session_id: result.sessionId }
        : {}),
  };
}
