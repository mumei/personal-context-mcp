/**
 * Encapsulates weekly report settings for the Settings view.
 * Responsibility: This module owns loading and saving the selected week start day.
 * Non-responsibility: This module does not render controls or report content.
 *
 * 設定画面向けに週次レポート設定をカプセル化します。
 * 責務: このモジュールは週開始曜日の取得と保存を担当します。
 * 非責務: controlやレポート本文の描画は担当しません。
 *
 * @packageDocumentation
 */

import { computed, reactive } from "vue";
import { getJson, mutateJson } from "#webUi/services/api";

export interface ReportSettingsState {
  week_start_day: number;
  path: string;
}

/** Provides reactive weekly report settings operations. */
export function useReportSettings() {
  const report = reactive<ReportSettingsState>({ week_start_day: 1, path: "" });
  const closingDay = computed({
    get: () => (report.week_start_day + 6) % 7,
    set: (value: number) => {
      report.week_start_day = (value + 1) % 7;
    },
  });

  async function load(): Promise<void> {
    Object.assign(report, await getJson<ReportSettingsState>("/api/settings/report"));
  }

  async function save(): Promise<void> {
    const result = await mutateJson<ReportSettingsState>("/api/settings/report", "PUT", {
      week_start_day: report.week_start_day,
    });
    Object.assign(report, result);
  }

  return { report, closingDay, load, save };
}
