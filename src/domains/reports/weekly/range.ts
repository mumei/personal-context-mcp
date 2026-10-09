/**
 * Resolves weekly report periods using existing operational dates and a configurable weekday.
 * Does not change the Activity journal or the daily report date boundary.
 *
 * 設定可能な曜日と既存の作業日を用いて週次の集計期間を解決します。
 * Activity原本や日次レポートの日付境界は変更しません。
 * @packageDocumentation
 */
import { resolveDate } from "#shared/date";
import type { TaskMcpConfig } from "#shared/types";

export interface WeeklyPeriod {
  week_start: string;
  week_end: string;
  through: string;
  today: string;
  timezone: string;
  rollover_hour: number;
  provisional: boolean;
}

/** Validates a real ISO date, not an instant. 実在するISO暦日を検証します。 */
export function parseWeeklyDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid weekly report date: ${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error(`Invalid weekly report date: ${value}`);
  return date;
}

/** Adds whole date-key days without browser/server timezone drift. タイムゾーンに依存せず日付キーを加算します。 */
export function weeklyDateOffset(value: string, amount: number): string {
  const date = parseWeeklyDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** Resolves one full or partial week; today remains provisional until its work day ends.
 * 完全週または途中週を解決します。当日は作業日の終了まで暫定扱いです。
 */
export function resolveWeeklyPeriod(
  config: Pick<TaskMcpConfig, "timezone" | "activityRolloverHour">,
  weekStartDay: number,
  week?: string,
  through?: string,
  now = new Date(),
): WeeklyPeriod {
  if (!Number.isInteger(weekStartDay) || weekStartDay < 0 || weekStartDay > 6)
    throw new Error("week_start_day must be an integer from 0 to 6.");
  const today = resolveDate(undefined, config, now);
  const focus = week ?? today;
  const weekday = parseWeeklyDate(focus).getUTCDay();
  const start = weeklyDateOffset(focus, -((weekday - weekStartDay + 7) % 7));
  const end = weeklyDateOffset(start, 6);
  const last = through ?? (end < today ? end : today);
  parseWeeklyDate(last);
  if (start > today || last > today) throw new Error("Weekly reports cannot include future work dates.");
  if (last < start || last > end) throw new Error("through must be within the selected week.");
  return {
    week_start: start,
    week_end: end,
    through: last,
    today,
    timezone: config.timezone,
    rollover_hour: config.activityRolloverHour,
    provisional: last < end || last === today,
  };
}
