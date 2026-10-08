/**
 * Builds the read-only Activity calendar projection used by Personal Context MCP Web.
 * Responsibility: This module filters immutable Activity entries by configured local calendar dates
 * into compact calendar events, daily counts, and project filters.
 * Non-responsibility: This module does not mutate Activity, infer missing durations, or merge journal entries.
 *
 * Personal Context MCP Webで使用する読み取り専用Activityカレンダー投影を構築します。
 * 責務: 設定タイムゾーンの暦日で不変Activityを絞り込み、軽量なカレンダーイベント、
 * 日別件数、プロジェクトフィルターへ変換します。
 * 非責務: Activityの変更、欠落した所要時間の推測、ジャーナル項目の統合は行いません。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";
import type { ActivityEntry, TaskMcpConfig } from "#shared/types";
import { todayInTimeZone } from "#shared/date";

const MAX_RANGE_DAYS = 62;

/** Calendar event projected from one immutable Activity entry. 1件の不変Activityから投影するカレンダーイベントです。 */
export interface ActivityCalendarEvent {
  id: string;
  operational_date: string;
  calendar_date: string;
  occurred_at?: string;
  recorded_at?: string;
  started_at?: string;
  ended_at?: string;
  task_id: string;
  project: string;
  title: string;
  status?: string;
  summary: string;
  done: string[];
  next: string[];
}

/** Complete range response consumed by the Activity calendar UI. ActivityカレンダーUIが使用する期間レスポンスです。 */
export interface ActivityCalendarView {
  from: string;
  to: string;
  timezone: string;
  today: string;
  rollover_hour: number;
  events: ActivityCalendarEvent[];
  daily_counts: Record<string, number>;
  projects: string[];
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid calendar date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error(`Invalid calendar date: ${value}`);
  return date;
}

function inclusiveDayCount(from: string, to: string): number {
  const start = parseDate(from).getTime();
  const end = parseDate(to).getTime();
  if (end < start) throw new Error("Activity calendar 'to' must not be before 'from'.");
  return Math.floor((end - start) / 86_400_000) + 1;
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function eventTimestamp(value: unknown): string | undefined {
  const text = optionalText(value);
  // Offset-free legacy times cannot be positioned without inventing a timezone.
  return text && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(text) && !Number.isNaN(Date.parse(text)) ? text : undefined;
}

function eventSummary(entry: ActivityEntry): string {
  return (
    textList(entry.done)[0] ??
    textList(entry.compact_summary)[0] ??
    textList(entry.next)[0] ??
    optionalText(entry.title) ??
    entry.task_id
  );
}

/** Builds a bounded calendar projection without changing canonical Activity. 正規Activityを変更せず期間投影を構築します。 */
export async function buildActivityCalendar(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone" | "activityRolloverHour">,
  from: string,
  to: string,
): Promise<ActivityCalendarView> {
  const days = inclusiveDayCount(from, to);
  if (days > MAX_RANGE_DAYS) throw new Error(`Activity calendar range must be ${MAX_RANGE_DAYS} days or fewer.`);

  const [availableDates, tasksDocument] = await Promise.all([
    repo.listYamlDates(repo.layoutName("activities")),
    repo.loadTasks(),
  ]);
  const tasksById = new Map(tasksDocument.tasks.map((task) => [task.id, task]));
  const calendarDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const events: ActivityCalendarEvent[] = [];
  // Backfills and timezone changes can place events in any storage date. Storage
  // dates are not a safe index for calendar dates; keep reads sequential and bounded in memory.
  for (const date of availableDates) {
    const document = await repo.loadActivity(date);
    document.entries.forEach((entry, index) => {
      const occurredAt = eventTimestamp(entry.occurred_at);
      const calendarDate = occurredAt ? calendarDateFormatter.format(new Date(occurredAt)) : document.date;
      if (calendarDate < from || calendarDate > to) return;
      const task = tasksById.get(entry.task_id);
      events.push({
        id: optionalText(entry.activity_id) ?? `${document.date}-${index}-${entry.task_id}`,
        operational_date: document.date,
        calendar_date: calendarDate,
        ...(occurredAt ? { occurred_at: occurredAt } : {}),
        ...(optionalText(entry.recorded_at) ? { recorded_at: optionalText(entry.recorded_at) } : {}),
        ...(optionalText(entry.started_at) ? { started_at: optionalText(entry.started_at) } : {}),
        ...(optionalText(entry.ended_at) ? { ended_at: optionalText(entry.ended_at) } : {}),
        task_id: entry.task_id,
        project: optionalText(task?.project) ?? optionalText(entry.project) ?? "Unassigned",
        title: optionalText(task?.title) ?? optionalText(entry.title) ?? entry.task_id,
        ...(optionalText(entry.status) ? { status: optionalText(entry.status) } : {}),
        summary: eventSummary(entry),
        done: textList(entry.done),
        next: textList(entry.next),
      });
    });
  }
  events.sort((left, right) => {
    return (
      left.calendar_date.localeCompare(right.calendar_date) ||
      (left.occurred_at ? Date.parse(left.occurred_at) : 0) - (right.occurred_at ? Date.parse(right.occurred_at) : 0) ||
      left.id.localeCompare(right.id)
    );
  });

  const dailyCounts: Record<string, number> = {};
  for (const event of events) dailyCounts[event.calendar_date] = (dailyCounts[event.calendar_date] ?? 0) + 1;

  return {
    from,
    to,
    timezone: config.timezone,
    today: todayInTimeZone(config.timezone),
    rollover_hour: config.activityRolloverHour,
    events,
    daily_counts: dailyCounts,
    projects: [...new Set(events.map((event) => event.project))].sort((a, b) => a.localeCompare(b, "ja")),
  };
}
