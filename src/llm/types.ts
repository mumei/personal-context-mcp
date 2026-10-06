/**
 * Provides types capabilities for the LLM integration layer.
 * Responsibility: This module owns the types behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * LLM統合層のtypes機能を提供します。
 * 責務: このモジュールは、ここで宣言するtypesの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

/**
 * Defines the public `ExternalLlmProvider` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`ExternalLlmProvider`を定義します。
 */
export type ExternalLlmProvider =
  "codex_app_server" | "claude_cli" | "copilot_cli" | "cursor_cli" | "gemini_cli" | "lm_studio";

/**
 * Defines the public `LlmGenerationRequest` data contract exposed by this module.
 *
 * このモジュールが公開する`LlmGenerationRequest`データ契約を定義します。
 */
export interface LlmGenerationRequest {
  prompt: string;
  cwd: string;
  outputSchema?: Record<string, unknown>;
}

/**
 * Defines the public `LlmGenerationResult` data contract exposed by this module.
 *
 * このモジュールが公開する`LlmGenerationResult`データ契約を定義します。
 */
export interface LlmGenerationResult {
  text: string;
  provider?: ExternalLlmProvider;
  model?: string;
  threadId?: string;
  turnId?: string;
  sessionId?: string;
}

/**
 * Defines the public `LlmGenerator` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`LlmGenerator`を定義します。
 */
export type LlmGenerator = (request: LlmGenerationRequest) => Promise<LlmGenerationResult>;
