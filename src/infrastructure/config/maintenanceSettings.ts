/**
 * Loads and persists deterministic maintenance settings.
 * Responsibility: This module validates the backup retention policy stored under config/maintenance.yaml.
 * Non-responsibility: It does not select, archive, restore, or delete backup files.
 *
 * 決定的なメンテナンス設定を読み書きします。
 * 責務: config/maintenance.yamlに保存するバックアップ保持ポリシーを検証します。
 * 非責務: バックアップの選択、アーカイブ、復元、削除は行いません。
 *
 * @packageDocumentation
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import type { Repository } from "#infra/repository/repository";
import type { BackupCleanupConfig, TaskMcpConfig } from "#shared/types";

export interface StoredMaintenanceSettings {
  enabled: boolean;
  run_at: string;
  keep_all_days: number;
  keep_daily_days: number;
  keep_weekly_days: number;
  keep_monthly_days: number;
  archive_grace_days: number;
  max_versions_per_file_per_day: number;
}

export interface MaintenanceSettingsView extends StoredMaintenanceSettings {
  path: string;
  last_run?: MaintenanceRunState;
}

export interface MaintenanceRunState {
  operational_date: string;
  started_at: string;
  completed_at: string;
  archived_count: number;
  archived_size_bytes: number;
  deleted_archive_count: number;
  deleted_archive_size_bytes: number;
}

export function maintenanceSettingsPath(dataRoot: string): string {
  return join(dataRoot, "config", "maintenance.yaml");
}

export function maintenanceStatePath(dataRoot: string): string {
  return join(dataRoot, "config", "maintenance-state.yaml");
}

function integer(name: string, value: unknown, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

export function validateMaintenanceSettings(input: StoredMaintenanceSettings): StoredMaintenanceSettings {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.run_at)) throw new Error("run_at must use HH:MM from 00:00 to 23:59.");
  const settings = {
    enabled: Boolean(input.enabled),
    run_at: input.run_at,
    keep_all_days: integer("keep_all_days", input.keep_all_days, 1, 3650),
    keep_daily_days: integer("keep_daily_days", input.keep_daily_days, 1, 3650),
    keep_weekly_days: integer("keep_weekly_days", input.keep_weekly_days, 1, 3650),
    keep_monthly_days: integer("keep_monthly_days", input.keep_monthly_days, 1, 3650),
    archive_grace_days: integer("archive_grace_days", input.archive_grace_days, 1, 3650),
    max_versions_per_file_per_day: integer(
      "max_versions_per_file_per_day",
      input.max_versions_per_file_per_day,
      1,
      100,
    ),
  };
  if (
    settings.keep_all_days > settings.keep_daily_days ||
    settings.keep_daily_days > settings.keep_weekly_days ||
    settings.keep_weekly_days > settings.keep_monthly_days
  ) {
    throw new Error(
      "Retention periods must satisfy keep_all_days <= keep_daily_days <= keep_weekly_days <= keep_monthly_days.",
    );
  }
  return settings;
}

export function loadStoredMaintenanceSettings(dataRoot: string): Partial<StoredMaintenanceSettings> {
  try {
    const parsed = YAML.parse(readFileSync(maintenanceSettingsPath(dataRoot), "utf8")) as {
      backup_cleanup?: Partial<StoredMaintenanceSettings>;
    } | null;
    return parsed?.backup_cleanup ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function backupCleanupConfigToStored(config: BackupCleanupConfig): StoredMaintenanceSettings {
  return {
    enabled: config.enabled,
    run_at: config.runAt,
    keep_all_days: config.keepAllDays,
    keep_daily_days: config.keepDailyDays,
    keep_weekly_days: config.keepWeeklyDays,
    keep_monthly_days: config.keepMonthlyDays,
    archive_grace_days: config.archiveGraceDays,
    max_versions_per_file_per_day: config.maxVersionsPerFilePerDay,
  };
}

export async function loadMaintenanceRunState(repo: Repository): Promise<MaintenanceRunState | undefined> {
  const parsed = await repo.loadYaml<{ last_run?: MaintenanceRunState }>({}, "config", "maintenance-state.yaml");
  return parsed.last_run;
}

export async function maintenanceSettingsView(
  repo: Repository,
  config: TaskMcpConfig,
): Promise<MaintenanceSettingsView> {
  return {
    ...backupCleanupConfigToStored(config.backupCleanup),
    path: maintenanceSettingsPath(config.dataRoot),
    last_run: await loadMaintenanceRunState(repo),
  };
}

export async function updateMaintenanceSettings(
  repo: Repository,
  config: TaskMcpConfig,
  input: StoredMaintenanceSettings,
): Promise<MaintenanceSettingsView> {
  const value = validateMaintenanceSettings(input);
  await repo.writeText(
    maintenanceSettingsPath(repo.root),
    YAML.stringify({ backup_cleanup: value }),
    "maintenance-settings",
  );
  config.backupCleanup = {
    enabled: value.enabled,
    runAt: value.run_at,
    keepAllDays: value.keep_all_days,
    keepDailyDays: value.keep_daily_days,
    keepWeeklyDays: value.keep_weekly_days,
    keepMonthlyDays: value.keep_monthly_days,
    archiveGraceDays: value.archive_grace_days,
    maxVersionsPerFilePerDay: value.max_versions_per_file_per_day,
  };
  return maintenanceSettingsView(repo, config);
}
