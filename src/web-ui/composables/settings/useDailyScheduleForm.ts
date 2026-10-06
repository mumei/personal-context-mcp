/**
 * Encapsulates editable daily schedule controls.
 * Responsibility: This module owns execution-time and weekday state plus RRULE conversion.
 * Non-responsibility: This module does not localize weekday labels or persist settings.
 *
 * 編集可能なデイリースケジュールcontrolをカプセル化します。
 * 責務: このモジュールは、実行時刻・曜日の状態とRRULE変換を担当します。
 * 非責務: このモジュールは、曜日ラベルの翻訳や設定保存を担当しません。
 *
 * @packageDocumentation
 */

import { ref } from "vue";
import { buildDailySchedule, parseDailySchedule, type DailyScheduleWeekday } from "#shared/dailySchedule";

const everyDay: DailyScheduleWeekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** Provides schedule form state and RRULE conversion. */
export function useDailyScheduleForm() {
  const executionTime = ref("07:30");
  const selectedWeekdays = ref<DailyScheduleWeekday[]>([...everyDay]);

  function reset(): void {
    executionTime.value = "07:30";
    selectedWeekdays.value = [...everyDay];
  }

  function load(schedule: string): void {
    const controls = parseDailySchedule(schedule);
    executionTime.value = controls.time;
    selectedWeekdays.value = controls.weekdays;
  }

  function serialize(): string {
    return buildDailySchedule(executionTime.value, selectedWeekdays.value);
  }

  return { executionTime, selectedWeekdays, reset, load, serialize };
}
