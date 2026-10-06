/**
 * Manages failure classification and cached external LLM execution for MCP generation.
 * Responsibility: This module owns normalized provider failure codes and lazy external-provider generator construction.
 * Non-responsibility: This module does not build prompts, parse generated domain data, or persist results.
 *
 * MCP生成向けの失敗分類とcacheされた外部LLM実行を管理します。
 * 責務: このモジュールは、正規化されたProvider失敗codeと外部Provider generatorの遅延生成を担当します。
 * 非責務: このモジュールは、prompt構築、生成されたドメインデータの解析、結果の永続化を担当しません。
 *
 * @packageDocumentation
 */
import { createExternalLlmGenerator } from "#llm/providerRuntime";
import type { ExternalLlmProvider, LlmGenerationRequest, LlmGenerationResult } from "#llm/types";
import type { TaskMcpConfig } from "#shared/types";

/**
 * Defines provider execution and health operations used by generation workflows.
 *
 * 生成ワークフローが利用するProvider実行・健全性操作を定義します。
 */
export interface ProviderExecution {
  markProviderFailure(provider: ExternalLlmProvider, error: unknown): string;
  generateWithExternalProvider(
    provider: ExternalLlmProvider,
    request: LlmGenerationRequest,
  ): Promise<LlmGenerationResult>;
}

/**
 * Creates provider execution state scoped to one generation runtime.
 *
 * 1つのgeneration runtimeに限定されたProvider実行状態を作成します。
 */
export function createProviderExecution(config: TaskMcpConfig): ProviderExecution {
  const externalGenerators = new Map<ExternalLlmProvider, ReturnType<typeof createExternalLlmGenerator>>();
  const providerFailureCode = (error: unknown): string => {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes("-32601") || message.includes("method not found")) return "method_not_found";
    if (message.includes("model") && (message.includes("require") || message.includes("unavailable"))) {
      return "model_unavailable";
    }
    if (message.includes("timeout") || message.includes("timed out")) return "timeout";
    if (message.includes("unsupported") || message.includes("not support")) return "unsupported";
    return "provider_error";
  };
  const markProviderFailure = (provider: ExternalLlmProvider, error: unknown): string =>
    `${provider}:${providerFailureCode(error)}`;
  const generateWithExternalProvider = (
    provider: ExternalLlmProvider,
    request: LlmGenerationRequest,
  ): Promise<LlmGenerationResult> => {
    let generate = externalGenerators.get(provider);
    if (!generate) {
      generate = createExternalLlmGenerator(config, provider);
      externalGenerators.set(provider, generate);
    }
    return generate(request);
  };

  return {
    markProviderFailure,
    generateWithExternalProvider,
  };
}
