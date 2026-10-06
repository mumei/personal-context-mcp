/**
 * Encapsulates backup-retention settings and manual execution for the Settings view.
 * Web設定画面向けのバックアップ保持設定と手動実行をカプセル化します。
 *
 * @packageDocumentation
 */
import { reactive, ref } from "vue";
import { getJson, mutateJson } from "#webUi/services/api";

export interface MaintenanceRunState {
  operational_date: string;
  completed_at: string;
  archived_count: number;
  archived_size_bytes: number;
  deleted_archive_count: number;
  deleted_archive_size_bytes: number;
}

export interface MaintenanceSettingsState {
  enabled: boolean;
  run_at: string;
  keep_all_days: number;
  keep_daily_days: number;
  keep_weekly_days: number;
  keep_monthly_days: number;
  archive_grace_days: number;
  max_versions_per_file_per_day: number;
  last_run?: MaintenanceRunState;
}

export function useMaintenanceSettings() {
  const maintenance = reactive<MaintenanceSettingsState>({
    enabled: true,
    run_at: "03:00",
    keep_all_days: 7,
    keep_daily_days: 30,
    keep_weekly_days: 180,
    keep_monthly_days: 365,
    archive_grace_days: 30,
    max_versions_per_file_per_day: 1,
  });
  const running = ref(false);

  async function load() {
    Object.assign(maintenance, await getJson<MaintenanceSettingsState>("/api/settings/maintenance"));
  }

  async function save() {
    Object.assign(
      maintenance,
      await mutateJson<MaintenanceSettingsState>("/api/settings/maintenance", "PUT", maintenance),
    );
  }

  async function runNow() {
    running.value = true;
    try {
      await mutateJson("/api/settings/maintenance/run", "POST", { dry_run: false });
      await load();
    } finally {
      running.value = false;
    }
  }

  return { maintenance, running, load, save, runNow };
}
