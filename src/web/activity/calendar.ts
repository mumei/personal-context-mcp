/**
 * Builds the read-only Activity calendar projection used by Personal Context MCP Web.
 * Responsibility: This module loads a bounded operational-date range and converts immutable Activity entries
 * into compact calendar events, daily counts, and project filters.
 * Non-responsibility: This module does not mutate Activity, infer missing durations, or merge journal entries.
 *
 * Personal Context MCP Webで使用する読み取り専用Activityカレンダー投影を構築します。
 * 責務: 範囲制限された運用日付のActivityを読み込み、不変の各項目を軽量なカレンダーイベント、
 * 日別件数、プロジェクトフィルターへ変換します。
 * 非責務: Activityの変更、欠落した所要時間の推測、ジャーナル項目の統合は行いません。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";
import type { ActivityEntry, TaskMcpConfig } from "#shared/types";

const MAX_RANGE_DAYS = 62;

/** Calendar event projected from one immutable Activity entry. 1件の不変Activityから投影するカレンダーイベントです。 */
export interface ActivityCalendarEvent {
  id: string;
  operational_date: string;
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
  rollover_hour: number;
  events: ActivityCalendarEvent[];
  daily_counts: Record<string, number>;
  projects: string[];
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid calendar date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid calendar date: ${value}`);
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
    repo
      .listYamlDates(repo.layoutName("activities"))
      .then((dates) => dates.filter((date) => date >= from && date <= to)),
    repo.loadTasks(),
  ]);
  const tasksById = new Map(tasksDocument.tasks.map((task) => [task.id, task]));
  const documents = await Promise.all(availableDates.map((date) => repo.loadActivity(date)));
  const events = documents.flatMap((document) =>
    document.entries.map((entry, index): ActivityCalendarEvent => {
      const occurredAt = optionalText(entry.occurred_at);
      const task = tasksById.get(entry.task_id);
      return {
        id: optionalText(entry.activity_id) ?? `${document.date}-${index}-${entry.task_id}`,
        operational_date: document.date,
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
      };
    }),
  );
  events.sort((left, right) => {
    const leftTime = left.occurred_at ?? left.recorded_at ?? left.operational_date;
    const rightTime = right.occurred_at ?? right.recorded_at ?? right.operational_date;
    return leftTime.localeCompare(rightTime) || left.id.localeCompare(right.id);
  });

  const dailyCounts: Record<string, number> = {};
  for (const event of events) dailyCounts[event.operational_date] = (dailyCounts[event.operational_date] ?? 0) + 1;

  return {
    from,
    to,
    timezone: config.timezone,
    rollover_hour: config.activityRolloverHour,
    events,
    daily_counts: dailyCounts,
    projects: [...new Set(events.map((event) => event.project))].sort((a, b) => a.localeCompare(b, "ja")),
  };
}
