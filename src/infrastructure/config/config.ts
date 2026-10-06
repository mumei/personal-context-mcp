/**
 * Provides config capabilities for the infrastructure layer.
 * Responsibility: This module owns the config behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * インフラストラクチャ層のconfig機能を提供します。
 * 責務: このモジュールは、ここで宣言するconfigの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  loadStoredProfileSettings,
  validateActivityRolloverHour,
  validateTimezone,
} from "#infra/config/profileSettings";
import type { BackupCleanupConfig, LayoutConfig, TaskMcpConfig } from "#shared/types";
import { loadStoredMaintenanceSettings, validateMaintenanceSettings } from "#infra/config/maintenanceSettings";
import { CODEX_APP_SERVER_DEFAULT_MODEL } from "#llm/providers/codexAppServer";
import { CLAUDE_CLI_DEFAULT_MODEL } from "#llm/providers/claudeCli";
import { COPILOT_CLI_DEFAULT_MODEL } from "#llm/providers/copilotCli";
import { CURSOR_CLI_DEFAULT_MODEL } from "#llm/providers/cursorCli";
import { GEMINI_CLI_DEFAULT_MODEL } from "#llm/providers/geminiCli";
import { LM_STUDIO_DEFAULT_BASE_URL, LM_STUDIO_DEFAULT_MODEL } from "#llm/providers/lmStudio";

export const defaultLayout: LayoutConfig = {
  tasks: "tasks.yaml",
  contexts: "contexts",
  inputs: "inputs",
  activities: "activities",
  reports: "reports",
  outputs: "outputs",
  agentUpdates: "agent_updates",
  taskMemory: "task_memory",
  reportSummaries: "report_summaries",
  memorySummaries: "memory_summaries",
  cleanupSummaries: "cleanup_summaries",
  globalMemory: "global_memory.yaml",
  knowledge: "knowledge",
  people: "people",
  tickets: "tickets.yaml",
  requestLogs: "request_logs",
  backups: "backups",
};

export const defaultBackupCleanup: BackupCleanupConfig = {
  enabled: true,
  runAt: "03:00",
  keepAllDays: 7,
  keepDailyDays: 30,
  keepWeeklyDays: 180,
  keepMonthlyDays: 365,
  archiveGraceDays: 30,
  maxVersionsPerFilePerDay: 1,
};

/**
 * Performs the public `expandHome` operation provided by this module.
 *
 * このモジュールが提供する公開操作`expandHome`を実行します。
 */
export function expandHome(pathValue: string): string {
  if (pathValue === "~") {
    return homedir();
  }
  if (pathValue.startsWith("~/")) {
    return resolve(homedir(), pathValue.slice(2));
  }
  return pathValue;
}

/**
 * Performs the public `loadConfig` operation provided by this module.
 *
 * このモジュールが提供する公開操作`loadConfig`を実行します。
 */
export function loadConfig(argv = process.argv, env = process.env): TaskMcpConfig {
  const argRootIndex = argv.indexOf("--data-root");
  const argRoot = argRootIndex >= 0 ? argv[argRootIndex + 1] : undefined;
  const dataRoot = expandHome(argRoot ?? env.TASK_MCP_DATA_ROOT ?? "~/.tasks");
  const profile = loadStoredProfileSettings(dataRoot);
  const maintenance = loadStoredMaintenanceSettings(dataRoot);
  const backupCleanup = validateMaintenanceSettings({
    enabled: env.TASK_MCP_BACKUP_CLEANUP_ENABLED
      ? env.TASK_MCP_BACKUP_CLEANUP_ENABLED === "true"
      : (maintenance.enabled ?? defaultBackupCleanup.enabled),
    run_at: env.TASK_MCP_BACKUP_CLEANUP_RUN_AT ?? maintenance.run_at ?? defaultBackupCleanup.runAt,
    keep_all_days: Number(
      env.TASK_MCP_BACKUP_KEEP_ALL_DAYS ?? maintenance.keep_all_days ?? defaultBackupCleanup.keepAllDays,
    ),
    keep_daily_days: Number(
      env.TASK_MCP_BACKUP_KEEP_DAILY_DAYS ?? maintenance.keep_daily_days ?? defaultBackupCleanup.keepDailyDays,
    ),
    keep_weekly_days: Number(
      env.TASK_MCP_BACKUP_KEEP_WEEKLY_DAYS ?? maintenance.keep_weekly_days ?? defaultBackupCleanup.keepWeeklyDays,
    ),
    keep_monthly_days: Number(
      env.TASK_MCP_BACKUP_KEEP_MONTHLY_DAYS ?? maintenance.keep_monthly_days ?? defaultBackupCleanup.keepMonthlyDays,
    ),
    archive_grace_days: Number(
      env.TASK_MCP_BACKUP_ARCHIVE_GRACE_DAYS ?? maintenance.archive_grace_days ?? defaultBackupCleanup.archiveGraceDays,
    ),
    max_versions_per_file_per_day: Number(
      env.TASK_MCP_BACKUP_MAX_VERSIONS_PER_FILE_PER_DAY ??
        maintenance.max_versions_per_file_per_day ??
        defaultBackupCleanup.maxVersionsPerFilePerDay,
    ),
  });
  const layout: LayoutConfig = {
    tasks: env.TASK_MCP_LAYOUT_TASKS ?? defaultLayout.tasks,
    contexts: env.TASK_MCP_LAYOUT_CONTEXTS ?? defaultLayout.contexts,
    inputs: env.TASK_MCP_LAYOUT_INPUTS ?? defaultLayout.inputs,
    activities: env.TASK_MCP_LAYOUT_ACTIVITIES ?? defaultLayout.activities,
    reports: env.TASK_MCP_LAYOUT_REPORTS ?? defaultLayout.reports,
    outputs: env.TASK_MCP_LAYOUT_OUTPUTS ?? defaultLayout.outputs,
    agentUpdates: env.TASK_MCP_LAYOUT_AGENT_UPDATES ?? defaultLayout.agentUpdates,
    taskMemory: env.TASK_MCP_LAYOUT_TASK_MEMORY ?? defaultLayout.taskMemory,
    reportSummaries: env.TASK_MCP_LAYOUT_REPORT_SUMMARIES ?? defaultLayout.reportSummaries,
    memorySummaries: env.TASK_MCP_LAYOUT_MEMORY_SUMMARIES ?? defaultLayout.memorySummaries,
    cleanupSummaries: env.TASK_MCP_LAYOUT_CLEANUP_SUMMARIES ?? defaultLayout.cleanupSummaries,
    globalMemory: env.TASK_MCP_LAYOUT_GLOBAL_MEMORY ?? defaultLayout.globalMemory,
    knowledge: env.TASK_MCP_LAYOUT_KNOWLEDGE ?? defaultLayout.knowledge,
    people: env.TASK_MCP_LAYOUT_PEOPLE ?? defaultLayout.people,
    tickets: env.TASK_MCP_LAYOUT_TICKETS ?? defaultLayout.tickets,
    requestLogs: env.TASK_MCP_LAYOUT_REQUEST_LOGS ?? defaultLayout.requestLogs,
    backups: env.TASK_MCP_LAYOUT_BACKUPS ?? defaultLayout.backups,
  };

  return {
    dataRoot,
    timezone: validateTimezone(
      env.TASK_MCP_TIMEZONE ?? profile.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    ),
    defaultLookbackDays: Number(env.TASK_MCP_LOOKBACK_DAYS ?? 7),
    activityRolloverHour: validateActivityRolloverHour(
      Number(env.TASK_MCP_ACTIVITY_ROLLOVER_HOUR ?? profile.activity_rollover_hour ?? 0),
    ),
    defaultRenderer: env.TASK_MCP_DEFAULT_RENDERER ?? "markdown",
    reportLlmProvider: reportLlmProvider(env.TASK_MCP_LLM_PROVIDER ?? env.TASK_MCP_REPORT_LLM_PROVIDER),
    codexAppServerCommand: codexAppServerCommand(env),
    codexAppServerArgs: (env.TASK_MCP_CODEX_APP_SERVER_ARGS ?? "app-server --listen stdio://")
      .split(/\s+/)
      .filter(Boolean),
    codexAppServerModel: env.TASK_MCP_CODEX_APP_SERVER_MODEL ?? CODEX_APP_SERVER_DEFAULT_MODEL,
    codexAppServerTimeoutMs: Number(env.TASK_MCP_CODEX_APP_SERVER_TIMEOUT_MS ?? 120000),
    claudeCliCommand: env.TASK_MCP_CLAUDE_COMMAND ?? "claude",
    claudeCliArgs: (env.TASK_MCP_CLAUDE_ARGS ?? "").split(/\s+/).filter(Boolean),
    claudeCliModel: env.TASK_MCP_CLAUDE_MODEL ?? CLAUDE_CLI_DEFAULT_MODEL,
    claudeCliTimeoutMs: Number(env.TASK_MCP_CLAUDE_TIMEOUT_MS ?? 120000),
    copilotCliCommand: env.TASK_MCP_COPILOT_COMMAND ?? "copilot",
    copilotCliArgs: (env.TASK_MCP_COPILOT_ARGS ?? "").split(/\s+/).filter(Boolean),
    copilotCliModel: env.TASK_MCP_COPILOT_MODEL ?? COPILOT_CLI_DEFAULT_MODEL,
    copilotCliTimeoutMs: Number(env.TASK_MCP_COPILOT_TIMEOUT_MS ?? 120000),
    cursorCliCommand: env.TASK_MCP_CURSOR_COMMAND ?? "cursor-agent",
    cursorCliArgs: (env.TASK_MCP_CURSOR_ARGS ?? "").split(/\s+/).filter(Boolean),
    cursorCliModel: env.TASK_MCP_CURSOR_MODEL ?? CURSOR_CLI_DEFAULT_MODEL,
    cursorCliTimeoutMs: Number(env.TASK_MCP_CURSOR_TIMEOUT_MS ?? 120000),
    geminiCliCommand: env.TASK_MCP_GEMINI_COMMAND ?? "gemini",
    geminiCliArgs: (env.TASK_MCP_GEMINI_ARGS ?? "").split(/\s+/).filter(Boolean),
    geminiCliModel: env.TASK_MCP_GEMINI_MODEL ?? GEMINI_CLI_DEFAULT_MODEL,
    geminiCliTimeoutMs: Number(env.TASK_MCP_GEMINI_TIMEOUT_MS ?? 120000),
    lmStudioBaseUrl: env.TASK_MCP_LM_STUDIO_BASE_URL ?? LM_STUDIO_DEFAULT_BASE_URL,
    lmStudioApiToken: env.TASK_MCP_LM_STUDIO_API_TOKEN,
    lmStudioModel: env.TASK_MCP_LM_STUDIO_MODEL ?? LM_STUDIO_DEFAULT_MODEL,
    lmStudioTimeoutMs: Number(env.TASK_MCP_LM_STUDIO_TIMEOUT_MS ?? 120000),
    backupCleanup: {
      enabled: backupCleanup.enabled,
      runAt: backupCleanup.run_at,
      keepAllDays: backupCleanup.keep_all_days,
      keepDailyDays: backupCleanup.keep_daily_days,
      keepWeeklyDays: backupCleanup.keep_weekly_days,
      keepMonthlyDays: backupCleanup.keep_monthly_days,
      archiveGraceDays: backupCleanup.archive_grace_days,
      maxVersionsPerFilePerDay: backupCleanup.max_versions_per_file_per_day,
    },
    layout,
  };
}

function codexAppServerCommand(env: NodeJS.ProcessEnv): string {
  const configured = env.TASK_MCP_CODEX_APP_SERVER_COMMAND ?? env.CODEX_CLI_PATH;
  if (configured) return configured;
  const bundledCandidates = [
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
  ];
  return bundledCandidates.find((candidate) => existsSync(candidate)) ?? "codex";
}

function reportLlmProvider(value: string | undefined): TaskMcpConfig["reportLlmProvider"] {
  if (
    value === "auto" ||
    value === "codex_app_server" ||
    value === "claude_cli" ||
    value === "copilot_cli" ||
    value === "cursor_cli" ||
    value === "gemini_cli" ||
    value === "lm_studio"
  ) {
    return value;
  }
  return "auto";
}
