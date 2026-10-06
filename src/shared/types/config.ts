/**
 * Defines shared configuration contracts.
 * Responsibility: This module owns provider selection, storage layout, and application configuration shapes.
 * Non-responsibility: This module does not load, validate, merge, or persist configuration values.
 *
 * 共通の設定契約を定義します。
 * 責務: このモジュールは、プロバイダー選択、保存先レイアウト、アプリケーション設定の形式を担当します。
 * 非責務: このモジュールは、設定値の読み込み、検証、統合、永続化を担当しません。
 *
 * @packageDocumentation
 */

/**
 * Defines the language-model provider modes supported by configuration.
 *
 * 設定でサポートされる言語モデルプロバイダーのモードを定義します。
 */
export type LlmProvider =
  "auto" | "codex_app_server" | "claude_cli" | "copilot_cli" | "cursor_cli" | "gemini_cli" | "lm_studio";

/**
 * Defines the directory layout beneath the configured data root.
 *
 * 設定されたデータルート配下のディレクトリ構成を定義します。
 */
export interface LayoutConfig {
  tasks: string;
  contexts: string;
  inputs: string;
  activities: string;
  reports: string;
  outputs: string;
  agentUpdates: string;
  taskMemory: string;
  reportSummaries: string;
  memorySummaries: string;
  cleanupSummaries: string;
  globalMemory: string;
  knowledge: string;
  people: string;
  tickets: string;
  requestLogs: string;
  backups: string;
}

/** Backup retention and automatic maintenance settings. バックアップ保持と自動メンテナンスの設定です。 */
export interface BackupCleanupConfig {
  enabled: boolean;
  runAt: string;
  keepAllDays: number;
  keepDailyDays: number;
  keepWeeklyDays: number;
  keepMonthlyDays: number;
  archiveGraceDays: number;
  maxVersionsPerFilePerDay: number;
}

/**
 * Defines the complete runtime configuration for Personal Context MCP.
 *
 * Personal Context MCPの完全な実行時設定を定義します。
 */
export interface TaskMcpConfig {
  dataRoot: string;
  timezone: string;
  defaultLookbackDays: number;
  activityRolloverHour: number;
  defaultRenderer: string;
  reportLlmProvider: LlmProvider;
  codexAppServerCommand: string;
  codexAppServerArgs: string[];
  codexAppServerModel?: string;
  codexAppServerTimeoutMs: number;
  claudeCliCommand: string;
  claudeCliArgs: string[];
  claudeCliModel?: string;
  claudeCliTimeoutMs: number;
  copilotCliCommand: string;
  copilotCliArgs: string[];
  copilotCliModel?: string;
  copilotCliTimeoutMs: number;
  cursorCliCommand: string;
  cursorCliArgs: string[];
  cursorCliModel?: string;
  cursorCliTimeoutMs: number;
  geminiCliCommand: string;
  geminiCliArgs: string[];
  geminiCliModel?: string;
  geminiCliTimeoutMs: number;
  lmStudioBaseUrl: string;
  lmStudioApiToken?: string;
  lmStudioModel?: string;
  lmStudioTimeoutMs: number;
  backupCleanup: BackupCleanupConfig;
  layout: LayoutConfig;
  connectedMcpClient?: {
    name?: string;
    version?: string;
    configured_provider: LlmProvider;
    selected_provider: Exclude<LlmProvider, "auto">;
    selected_model?: string;
    selection_reason:
      | "environment_override"
      | "claude_client"
      | "codex_client"
      | "copilot_client"
      | "cursor_client"
      | "gemini_client"
      | "lm_studio_client"
      | "default";
  };
}
