/**
 * Defines contracts shared by the settings composables.
 * Responsibility: This module owns settings UI state shapes shared across composables and components.
 * Non-responsibility: This module does not fetch, mutate, or render settings.
 *
 * 設定Composable間で共有する契約を定義します。
 * 責務: このモジュールは、Composableとcomponentで共有する設定UI状態の型を担当します。
 * 非責務: このモジュールは、設定の取得、変更、描画を担当しません。
 *
 * @packageDocumentation
 */

export type DailyTaskRunner = "codex" | "cursor" | "claude_code_loop" | "claude_desktop" | "copilot_cli" | "gemini_cli";

export interface DailyTaskClientStatus {
  runner: DailyTaskRunner;
  state: "configured" | "not_configured";
  selected: boolean;
  detection: "local" | "external";
  name?: string;
  schedule?: string;
  model?: string;
  enabled?: boolean;
}

export interface LlmProviderStatus {
  configured_provider: string;
  selected_provider: string;
  selected_model: string;
  selection_reason: string;
  client_name?: string;
  client_version?: string;
  providers: Array<{ id: string; model: string; command: string; selected: boolean }>;
}

export interface AutomationStatus {
  connected_client: { name?: string; version?: string; runner?: DailyTaskRunner };
  llm_provider: LlmProviderStatus;
  clients: DailyTaskClientStatus[];
  model_options: Record<DailyTaskRunner, Array<{ value: string; recommended: boolean }>>;
}

export interface DailyTaskSettings {
  version: 1;
  name: string;
  enabled: boolean;
  runner: DailyTaskRunner;
  schedule: string;
  timezone: string;
  model: string;
  reasoning_effort: "low" | "medium" | "high";
  workspace: string;
  claude_loop_interval: string;
  prompt: string;
}

export interface DailyTaskIntegration {
  mode: "" | "managed" | "assisted";
  status: "" | "synchronized" | "setup_required";
  setup_url: string;
  setup_command: string;
  notes: string[];
}

export interface DailyTaskSetupResponse {
  integration: Omit<DailyTaskIntegration, "mode" | "status"> & {
    mode: "managed" | "assisted";
    status: "synchronized" | "setup_required";
  };
  source_runner?: DailyTaskRunner;
  source_stop_note?: string;
}
