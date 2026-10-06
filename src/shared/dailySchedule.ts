/**
 * Converts the supported daily automation RRULE subset to and from form-friendly values.
 * Responsibility: This module owns weekday ordering, execution-time validation, and RRULE serialization.
 * Non-responsibility: It is not a general-purpose RFC 5545 parser.
 *
 * 対応する日次自動化RRULEの部分集合を、フォーム向けの値と相互変換します。
 * 責務: 曜日の順序、実行時刻の検証、RRULEへの直列化を担当します。
 * 非責務: RFC 5545全体を扱う汎用パーサーではありません。
 *
 * @packageDocumentation
 */

/**
 * Supported weekday identifiers in display and serialization order.
 *
 * 表示・直列化順の対応曜日識別子です。
 */
export const DAILY_SCHEDULE_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/**
 * A weekday identifier supported by the daily automation form.
 *
 * 日次自動化フォームが対応する曜日識別子です。
 */
export type DailyScheduleWeekday = (typeof DAILY_SCHEDULE_WEEKDAYS)[number];

/**
 * Form-friendly schedule values.
 *
 * フォーム向けのスケジュール値です。
 */
export interface DailyScheduleControls {
  time: string;
  weekdays: DailyScheduleWeekday[];
}

/**
 * Parses the supported RRULE fields and supplies safe defaults for missing time fields.
 *
 * 対応RRULE項目を解析し、時刻項目がない場合は安全な既定値を返します。
 */
export function parseDailySchedule(schedule: string): DailyScheduleControls {
  const hour = Number(schedule.match(/(?:^|;)BYHOUR=(\d{1,2})(?:;|$)/)?.[1] ?? 7);
  const minute = Number(schedule.match(/(?:^|;)BYMINUTE=(\d{1,2})(?:;|$)/)?.[1] ?? 30);
  const requested = schedule.match(/(?:^|;)BYDAY=([A-Z,]+)(?:;|$)/)?.[1]?.split(",") ?? [];
  const weekdays = schedule.includes("FREQ=DAILY")
    ? [...DAILY_SCHEDULE_WEEKDAYS]
    : DAILY_SCHEDULE_WEEKDAYS.filter((day) => requested.includes(day));
  return {
    time: `${String(Math.min(23, hour)).padStart(2, "0")}:${String(Math.min(59, minute)).padStart(2, "0")}`,
    weekdays,
  };
}

/**
 * Builds the canonical weekly RRULE used by the automation adapters.
 *
 * 自動化アダプターで使用する正規化済み週次RRULEを生成します。
 */
export function buildDailySchedule(time: string, weekdays: readonly DailyScheduleWeekday[]): string {
  const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error("Execution time must use HH:MM in the 24-hour clock.");
  const selected = DAILY_SCHEDULE_WEEKDAYS.filter((day) => weekdays.includes(day));
  if (selected.length === 0) throw new Error("At least one execution weekday is required.");
  return `RRULE:FREQ=WEEKLY;BYHOUR=${Number(match[1])};BYMINUTE=${Number(match[2])};BYDAY=${selected.join(",")}`;
}
