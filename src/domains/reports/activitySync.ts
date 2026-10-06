/**
 * Tracks which append-only activity entries have been incorporated into each
 * daily report entry and identifies tasks that need regeneration.
 *
 * 追記専用Activityのうち、日次Report Entryへ反映済みの項目を追跡し、
 * 再生成が必要なタスクを特定します。
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import type { Repository } from "#infra/repository/repository";
import type { ActivityEntry, ReportEntry } from "#shared/types";
import { isTaskDeleted } from "#domain/tasks/state";
import { buildTaskActivityIdentityMap } from "#domain/tasks/identity";

/** Activity checkpoint persisted on one generated report entry. 生成済みReport Entryへ保存するActivityチェックポイントです。 */
export interface ReportActivityCheckpoint {
  source_activity_revision: string;
  source_activity_ids: string[];
  activity_generated_at: string;
}

/** One task whose activity journal has entries not reflected in its report. Reportへ未反映のActivityを持つ1タスクです。 */
export interface PendingReportActivityTask {
  task_id: string;
  title: string;
  manual_override: boolean;
  pending_activity_count: number;
  total_activity_count: number;
  last_generated_at?: string;
}

/** Report synchronization state for one operational date. 1運用日のReport同期状態です。 */
export interface ReportActivitySyncState {
  date: string;
  pending_count: number;
  tasks: PendingReportActivityTask[];
}

/** Returns a stable identity for one activity, including legacy entries without an explicit ID. 明示IDがない旧データを含め、Activityの安定した識別子を返します。 */
export function activityIdentity(entry: ActivityEntry): string {
  return entry.activity_id ?? createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}

/** Builds the current checkpoint for a task's complete activity journal. タスクのActivityジャーナル全体に対する現在のチェックポイントを構築します。 */
export function buildReportActivityCheckpoint(
  entries: ActivityEntry[],
  generatedAt = new Date().toISOString(),
): ReportActivityCheckpoint {
  const sourceActivityIds = entries.map(activityIdentity);
  return {
    source_activity_revision: createHash("sha256").update(JSON.stringify(sourceActivityIds)).digest("hex"),
    source_activity_ids: sourceActivityIds,
    activity_generated_at: generatedAt,
  };
}

/** Returns activity entries not included in the saved report checkpoint. 保存済みReportチェックポイントに含まれないActivityを返します。 */
export function unreflectedActivities(entries: ActivityEntry[], reportEntry?: ReportEntry): ActivityEntry[] {
  const reflected = new Set(reportEntry?.source_activity_ids ?? []);
  return entries.filter((entry) => !reflected.has(activityIdentity(entry)));
}

/** Returns whether the report entry reflects the complete current activity journal. Report Entryが現在のActivity全体を反映しているか返します。 */
export function reportEntryReflectsActivities(entries: ActivityEntry[], reportEntry?: ReportEntry): boolean {
  if (entries.length === 0) return true;
  return reportEntry?.source_activity_revision === buildReportActivityCheckpoint(entries, "").source_activity_revision;
}

/** Loads task-level report synchronization state for a date. 指定日のタスク単位Report同期状態を読み込みます。 */
export async function loadReportActivitySyncState(repo: Repository, date: string): Promise<ReportActivitySyncState> {
  const [activity, report, tasksDocument] = await Promise.all([
    repo.loadActivity(date),
    repo.loadReport(date),
    repo.loadTasks(),
  ]);
  const tasksById = new Map(tasksDocument.tasks.map((task) => [task.id, task]));
  const tasksByActivityId = buildTaskActivityIdentityMap(tasksDocument.tasks);
  const reportByTask = new Map(report.entries.map((entry) => [entry.task_id, entry]));
  const activitiesByTask = new Map<string, ActivityEntry[]>();
  for (const entry of activity.entries) {
    const task = tasksByActivityId.get(entry.task_id);
    if (!entry.task_id.trim() || !task || isTaskDeleted(task) || task.report_exclude || task.status === "blocked") {
      continue;
    }
    const entries = activitiesByTask.get(task.id) ?? [];
    entries.push(entry);
    activitiesByTask.set(task.id, entries);
  }
  const tasks = [...activitiesByTask.entries()].flatMap(([taskId, entries]) => {
    const reportEntry = reportByTask.get(taskId);
    if (reportEntryReflectsActivities(entries, reportEntry)) return [];
    const task = tasksById.get(taskId);
    return [
      {
        task_id: taskId,
        title: task?.title ?? reportEntry?.task_snapshot?.title ?? taskId,
        manual_override: reportEntry?.manual_override === true,
        pending_activity_count: unreflectedActivities(entries, reportEntry).length,
        total_activity_count: entries.length,
        ...(reportEntry?.activity_generated_at ? { last_generated_at: reportEntry.activity_generated_at } : {}),
      },
    ];
  });
  return { date, pending_count: tasks.length, tasks };
}
