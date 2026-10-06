/**
 * Provides UTC-stable calendar arithmetic for the Activity audit UI.
 * Responsibility: This module derives month, week, and day ranges without depending on browser timezone.
 * Non-responsibility: This module does not load Activity or format event timestamps.
 *
 * Activity監査UI向けにUTCで安定したカレンダー計算を提供します。
 * 責務: ブラウザのタイムゾーンに依存せず、月・週・日の期間を導出します。
 * 非責務: Activity取得やイベント時刻の整形は行いません。
 *
 * @packageDocumentation
 */

export type ActivityCalendarViewMode = "month" | "week" | "day" | "lane";

function parseDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Formats a Date as YYYY-MM-DD using UTC fields. UTCフィールドでDateをYYYY-MM-DDへ整形します。 */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Adds calendar days without local timezone drift. ローカルタイムゾーンのずれなく日数を加算します。 */
export function addDays(value: string, amount: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

/** Returns the Sunday starting the week containing a date. 指定日を含む週の日曜日を返します。 */
export function startOfWeek(value: string): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return dateKey(date);
}

/** Returns all inclusive date keys in a bounded range. 指定範囲内の全日付キーを返します。 */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let current = from; current <= to; current = addDays(current, 1)) dates.push(current);
  return dates;
}

/** Derives the API range required by one calendar view. 表示モードに必要なAPI期間を導出します。 */
export function calendarRange(focusDate: string, view: ActivityCalendarViewMode): { from: string; to: string } {
  if (view === "day") return { from: focusDate, to: focusDate };
  if (view === "week" || view === "lane") {
    const from = startOfWeek(focusDate);
    return { from, to: addDays(from, 6) };
  }
  const focus = parseDate(focusDate);
  const monthStart = dateKey(new Date(Date.UTC(focus.getUTCFullYear(), focus.getUTCMonth(), 1)));
  const monthEnd = dateKey(new Date(Date.UTC(focus.getUTCFullYear(), focus.getUTCMonth() + 1, 0)));
  const from = startOfWeek(monthStart);
  return { from, to: addDays(startOfWeek(monthEnd), 6) };
}

/** Moves focus by one logical page for the selected view. 選択表示の1ページ分だけ基準日を移動します。 */
export function moveFocusDate(value: string, view: ActivityCalendarViewMode, direction: -1 | 1): string {
  if (view === "day") return addDays(value, direction);
  if (view === "week" || view === "lane") return addDays(value, direction * 7);
  const date = parseDate(value);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return dateKey(date);
}

/** Formats a compact calendar range label. カレンダー期間の短いラベルを整形します。 */
export function calendarLabel(value: string, view: ActivityCalendarViewMode, locale: string): string {
  const date = parseDate(value);
  if (view === "month")
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" }).format(date);
  if (view === "day")
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
      timeZone: "UTC",
    }).format(date);
  const from = startOfWeek(value);
  const to = addDays(from, 6);
  const format = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  return `${format.format(parseDate(from))} - ${format.format(parseDate(to))}`;
}
