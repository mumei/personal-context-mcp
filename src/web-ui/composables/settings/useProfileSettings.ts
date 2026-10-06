/**
 * Encapsulates profile date settings for the Settings view.
 * Responsibility: This module owns profile loading, rollover-hour normalization, and persistence.
 * Non-responsibility: This module does not render controls or display notifications.
 *
 * 設定画面の日付設定をカプセル化します。
 * 責務: このモジュールは、profileの取得、日付境界時刻の正規化、保存を担当します。
 * 非責務: このモジュールは、controlの描画や通知表示を担当しません。
 *
 * @packageDocumentation
 */

import { reactive } from "vue";
import { getJson, mutateJson } from "#webUi/services/api";

export interface ProfileSettingsState {
  timezone: string;
  activity_rollover_hour: number | string;
}

/** Normalizes ASCII or full-width hour input to the supported 0-23 range. */
export function normalizeRolloverHour(value: number | string): number {
  const normalized = String(value).replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
  return Math.max(0, Math.min(23, Number(normalized)));
}

/** Provides reactive profile settings operations. */
export function useProfileSettings() {
  const profile = reactive<ProfileSettingsState>({ timezone: "Asia/Tokyo", activity_rollover_hour: 0 });

  async function load(): Promise<void> {
    Object.assign(profile, await getJson<ProfileSettingsState>("/api/settings/profile"));
  }

  async function save(): Promise<void> {
    profile.activity_rollover_hour = normalizeRolloverHour(profile.activity_rollover_hour);
    await mutateJson("/api/settings/profile", "PUT", profile);
  }

  return { profile, load, save };
}
