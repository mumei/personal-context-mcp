/**
 * Provides provider selector capabilities for the LLM integration layer.
 * Responsibility: This module owns the provider selector behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * LLM統合層のprovider selector機能を提供します。
 * 責務: このモジュールは、ここで宣言するprovider selectorの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import type { LlmProvider, TaskMcpConfig } from "#shared/types";
import { resolveExternalLlmModel } from "#llm/providerRuntime";

/**
 * Defines the public `McpClientIdentity` data contract exposed by this module.
 *
 * このモジュールが公開する`McpClientIdentity`データ契約を定義します。
 */
export interface McpClientIdentity {
  name?: string;
  version?: string;
}

/**
 * Defines the public `LlmProviderSelection` data contract exposed by this module.
 *
 * このモジュールが公開する`LlmProviderSelection`データ契約を定義します。
 */
export interface LlmProviderSelection {
  provider: Exclude<LlmProvider, "auto">;
  reason:
    | "environment_override"
    | "claude_client"
    | "codex_client"
    | "copilot_client"
    | "cursor_client"
    | "gemini_client"
    | "lm_studio_client"
    | "default";
  client: McpClientIdentity;
}

/**
 * Performs the public `selectLlmProvider` operation provided by this module.
 *
 * このモジュールが提供する公開操作`selectLlmProvider`を実行します。
 */
export function selectLlmProvider(
  configured: LlmProvider,
  clientVersion?: { name?: string; version?: string },
): LlmProviderSelection {
  const client = {
    ...(clientVersion?.name ? { name: clientVersion.name } : {}),
    ...(clientVersion?.version ? { version: clientVersion.version } : {}),
  };
  if (configured !== "auto") return { provider: configured, reason: "environment_override", client };
  const name = client.name?.toLowerCase() ?? "";
  if (name.includes("claude")) return { provider: "claude_cli", reason: "claude_client", client };
  if (name.includes("copilot")) return { provider: "copilot_cli", reason: "copilot_client", client };
  if (name.includes("cursor")) return { provider: "cursor_cli", reason: "cursor_client", client };
  if (name.includes("gemini")) return { provider: "gemini_cli", reason: "gemini_client", client };
  if (name.includes("lm studio") || name.includes("lmstudio")) {
    return { provider: "lm_studio", reason: "lm_studio_client", client };
  }
  if (name.includes("codex") || name.includes("openai") || name.includes("chatgpt")) {
    return { provider: "codex_app_server", reason: "codex_client", client };
  }
  return { provider: "codex_app_server", reason: "default", client };
}

/**
 * Performs the public `providerConfigSummary` operation provided by this module.
 *
 * このモジュールが提供する公開操作`providerConfigSummary`を実行します。
 */
export function providerConfigSummary(config: TaskMcpConfig, selection: LlmProviderSelection) {
  return {
    configured_provider: selection.reason === "environment_override" ? selection.provider : "auto",
    selected_provider: selection.provider,
    selection_reason: selection.reason,
    client: selection.client,
    model: resolveExternalLlmModel(config, selection.provider),
  };
}
