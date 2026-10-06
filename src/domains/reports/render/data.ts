/**
 * Repository-backed model loading for report rendering.
 * レポートレンダリング向けの、リポジトリを利用したモデル読み込みを提供します。
 *
 * @remarks
 * This module owns loading and combining tasks, context, memory, report entries,
 * summaries, and previous rendered differences. It does not define presentation
 * strings, render complete documents, or write generated output.
 * このモジュールは、タスク、コンテキスト、メモリ、レポート項目、サマリー、過去に
 * レンダリングされた差分の読み込みと統合を担当します。表示文字列の定義、文書全体の
 * レンダリング、生成結果の書き込みは行いません。
 *
 * @packageDocumentation
 */

import { dateDaysAgo } from "#shared/date";
import type { Repository } from "#infra/repository/repository";
import type { TaskStatus } from "#shared/types";
import { isTaskDeleted } from "#domain/tasks/state";
import type { ReportData, TextReportTask } from "#domain/reports/render/model";
import {
  asRecord,
  asStringArray,
  changedTasks,
  compareReportTasks,
  mergeReportEntry,
  normalizeDiffText,
  reportKeyFromHeading,
  reportableTask,
  reportStatusOrder,
  statusLabels,
  taskHeadingLine,
} from "#domain/reports/render/policy";

/**
 * Loads daily-difference lines from the previous text report, grouped by task.
 * 前回のテキストレポートから日次差分行を読み込み、タスク単位にまとめます。
 */
export async function loadPreviousTodayDiffs(repo: Repository, date: string): Promise<Map<string, Set<string>>> {
  const previous = await repo.loadOutput("text", dateDaysAgo(date, 1));
  const diffs = new Map<string, Set<string>>();
  if (!previous) {
    return diffs;
  }

  let currentKey: string | undefined;
  let inTodayDiff = false;
  for (const line of previous.split("\n")) {
    if (taskHeadingLine(line)) {
      currentKey = reportKeyFromHeading(line);
      inTodayDiff = false;
      continue;
    }
    if (currentKey && (line === "  - 本日差分:" || line === "  - やったこと:")) {
      inTodayDiff = true;
      continue;
    }
    if (inTodayDiff && line.startsWith("      - ")) {
      if (!diffs.has(currentKey ?? "")) {
        diffs.set(currentKey ?? "", new Set());
      }
      diffs.get(currentKey ?? "")?.add(normalizeDiffText(line.slice("      - ".length)));
      continue;
    }
    if (inTodayDiff && (line.length === 0 || line.startsWith("  - "))) {
      inTodayDiff = false;
    }
  }
  return diffs;
}

/**
 * Loads and merges all tasks eligible for a report date.
 * 指定日のレポート対象となるすべてのタスクを読み込み、統合します。
 */
export async function buildTextReportTasks(repo: Repository, date: string): Promise<TextReportTask[]> {
  const tasksDoc = await repo.loadTasks();
  const report = await repo.loadReport(date);
  const activity = await repo.loadActivity(date);
  const entries = new Map(report.entries.map((entry) => [entry.task_id, entry]));
  const merged: TextReportTask[] = [];

  for (const task of tasksDoc.tasks.filter((item) => !isTaskDeleted(item))) {
    const context = await repo.loadTaskContext(task);
    const memory = await repo.loadTaskMemory(task.id);
    const fromContext = asRecord(context.data);
    const fromMemory =
      asStringArray(memory.summary).length > 0 && asStringArray(fromContext.compact_summary).length === 0
        ? { compact_summary: memory.summary }
        : {};
    const model = mergeReportEntry({ ...fromMemory, ...fromContext, ...task } as TextReportTask, entries.get(task.id));
    const progress = activity.entries
      .filter((entry) => entry.task_id === task.id && typeof entry.ticket_progress === "string")
      .at(-1)?.ticket_progress;
    if (typeof progress === "string") model.ticket_progress = progress;
    merged.push(model);
  }

  const currentTaskIds = new Set(tasksDoc.tasks.map((task) => task.id));
  for (const entry of report.entries) {
    if (currentTaskIds.has(entry.task_id) || !entry.task_snapshot) continue;
    merged.push(
      mergeReportEntry(
        {
          id: entry.task_id,
          title: entry.task_snapshot.title,
          project: entry.task_snapshot.project,
          tier: entry.task_snapshot.tier,
          status: entry.task_snapshot.status,
        },
        entry,
      ),
    );
  }

  return merged.filter((task) => reportableTask(task, date)).sort(compareReportTasks);
}

/**
 * Loads the normalized aggregate consumed by structured report renderers.
 * 構造化レポートのレンダラーが利用する正規化済み集約データを読み込みます。
 */
export async function buildReportData(repo: Repository, date: string): Promise<ReportData> {
  const tasks = await buildTextReportTasks(repo, date);
  const reportSummary = await repo.loadReportSummary(date);
  const counts = Object.keys(statusLabels).reduce<Record<TaskStatus, number>>(
    (acc, status) => {
      const typedStatus = status as TaskStatus;
      acc[typedStatus] = tasks.filter((task) => task.status === typedStatus).length;
      return acc;
    },
    { todo: 0, inProgress: 0, done: 0, waiting: 0, blocked: 0 },
  );
  const previousDiffs = await loadPreviousTodayDiffs(repo, date);
  const changedTasksByStatus = new Map<TaskStatus, TextReportTask[]>();
  for (const task of changedTasks(tasks, date)) {
    const status = task.status ?? "todo";
    changedTasksByStatus.set(status, [...(changedTasksByStatus.get(status) ?? []), task]);
  }

  return {
    date,
    tasks,
    counts,
    previousDiffs,
    reportSummary,
    changedTasksByStatus,
    activeStatuses: reportStatusOrder.filter((status) => counts[status] > 0),
  };
}
