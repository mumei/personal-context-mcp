/**
 * Collects dated work evidence for one weekly report without mutating daily sources.
 * Current task metadata is for labels/visibility only, never historical progress evidence.
 *
 * 日次の正本を変更せず、週次レポート用の期間内実績を収集します。
 * 現在のタスク情報はラベルと除外判定専用で、過去の進捗証拠には使用しません。
 * @packageDocumentation
 */
import { createHash } from "node:crypto";
import type { Repository } from "#infra/repository/repository";
import { isTaskDeleted } from "#domain/tasks/state";
import { buildTaskActivityIdentityMap } from "#domain/tasks/identity";
import type { WeeklyPeriod } from "#domain/reports/weekly/range";
import { weeklyDateOffset } from "#domain/reports/weekly/range";

export interface WeeklyTaskSource {
  task_id: string;
  title: string;
  project: string;
  days: Array<{ date: string; done: string[]; next: string[] }>;
}
function lines(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((line): line is string => typeof line === "string" && !!line.trim()).map((line) => line.trim()),
        ),
      ]
    : [];
}

/** Reads only the selected work dates, keeping coverage distinct from missing records.
 * 指定した作業日だけを読み込み、記録済み日と未記録日を区別します。
 */
export async function loadWeeklySource(repo: Repository, period: WeeklyPeriod, generatedAt: string) {
  const [tasksDoc, activityDates, reportDates, globalMemory] = await Promise.all([
    repo.loadTasks(),
    repo.listYamlDates(repo.layoutName("activities")),
    repo.listYamlDates(repo.layoutName("reports")),
    repo.loadGlobalMemory(),
  ]);
  const identity = buildTaskActivityIdentityMap(tasksDoc.tasks);
  const byId = new Map<string, WeeklyTaskSource>();
  const recordedDates: string[] = [];
  const missingDates: string[] = [];
  for (let date = period.week_start; date <= period.through; date = weeklyDateOffset(date, 1)) {
    if (activityDates.includes(date) || reportDates.includes(date)) recordedDates.push(date);
    else missingDates.push(date);
    const [activity, report] = await Promise.all([repo.loadActivity(date), repo.loadReport(date)]);
    for (const task of tasksDoc.tasks) {
      if (isTaskDeleted(task) || task.report_exclude || task.status === "blocked") continue;
      const entry = report.entries.find((item) => item.task_id === task.id);
      if (entry?.report_exclude || entry?.task_snapshot?.status === "blocked") continue;
      const journal = activity.entries.filter((item) => identity.get(item.task_id)?.id === task.id);
      const entries = journal.filter((item) => {
        const instant = typeof item.occurred_at === "string" ? Date.parse(item.occurred_at) : NaN;
        return Number.isNaN(instant) || instant <= Date.parse(generatedAt);
      });
      // Prefer primary journal facts; a dated report is used only where no journal
      // exists, so the same accomplishment is never counted twice as two sources.
      const done = journal.length ? lines(entries.flatMap((item) => item.done ?? [])) : lines(entry?.done);
      const next = journal.length ? lines(entries.flatMap((item) => item.next ?? [])) : lines(entry?.next);
      if (!done.length && !next.length) continue;
      const current = byId.get(task.id) ?? {
        task_id: task.id,
        title: task.title,
        project: task.project ?? "",
        days: [],
      };
      if (entry?.task_snapshot) {
        current.title = entry.task_snapshot.title;
        current.project = entry.task_snapshot.project ?? "";
      }
      current.days.push({ date, done, next });
      byId.set(task.id, current);
    }
  }
  const tasks = [...byId.values()].sort(
    (a, b) => a.project.localeCompare(b.project, "ja") || a.title.localeCompare(b.title, "ja"),
  );
  const source = {
    period: {
      week_start: period.week_start,
      week_end: period.week_end,
      through: period.through,
      timezone: period.timezone,
      rollover_hour: period.rollover_hour,
    },
    recorded_dates: recordedDates,
    missing_dates: missingDates,
    tasks,
    global_memory: { rules: globalMemory.rules ?? [], preferences: globalMemory.preferences ?? [] },
  };
  return { source, revision: createHash("sha256").update(JSON.stringify(source)).digest("hex") };
}
