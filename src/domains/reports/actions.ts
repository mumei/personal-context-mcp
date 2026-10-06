/**
 * Provides actions capabilities for the domain layer.
 * Responsibility: This module owns the actions behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * domain層のactions機能を提供します。
 * 責務: このモジュールは、ここで宣言するactionsの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";
import type { ActivityEntry, ReportEntry, SaveResult } from "#shared/types";
import { isTaskDeleted } from "#domain/tasks/state";
import { buildReportActivityCheckpoint } from "#domain/reports/activitySync";

/**
 * Defines the public `UpdateReportEntryMode` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`UpdateReportEntryMode`を定義します。
 */
export type UpdateReportEntryMode = "replace" | "append" | "delete" | "clear_override";

/**
 * Defines the public `UpdateReportEntryInput` data contract exposed by this module.
 *
 * このモジュールが公開する`UpdateReportEntryInput`データ契約を定義します。
 */
export interface UpdateReportEntryInput {
  task_id: string;
  mode: UpdateReportEntryMode;
  done?: string[];
  next?: string[];
  today_diff_heading_only?: boolean;
  today_diff_order?: number;
}

/**
 * Defines the public `UpdateReportEntryResult` data contract exposed by this module.
 *
 * このモジュールが公開する`UpdateReportEntryResult`データ契約を定義します。
 */
export interface UpdateReportEntryResult {
  date: string;
  mode: UpdateReportEntryMode;
  task_id: string;
  entry?: ReportEntry;
  removed?: ReportEntry;
  save: SaveResult;
}

/**
 * Defines the public `GenerateReportEntriesResult` data contract exposed by this module.
 *
 * このモジュールが公開する`GenerateReportEntriesResult`データ契約を定義します。
 */
export interface GenerateReportEntriesResult {
  date: string;
  entries: ReportEntry[];
  source_activity_count: number;
  save: SaveResult;
}

const generatedEntryLimits = {
  done: 4,
  next: 3,
} as const;

function appendUnique(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  const merged = [...(existing ?? [])];
  for (const item of incoming ?? []) {
    if (!merged.includes(item)) {
      merged.push(item);
    }
  }
  return merged.length > 0 ? merged : undefined;
}

function nonEmptyItems(items: string[] | undefined): string[] | undefined {
  const values = [...new Set((items ?? []).filter((item) => item.trim().length > 0))];
  return values.length > 0 ? values : undefined;
}

function mergeNewestActivityIntoReportEntry(existing: ReportEntry | undefined, activity: ActivityEntry): ReportEntry {
  const entry: ReportEntry = {
    ...(existing ?? { task_id: activity.task_id }),
    task_id: activity.task_id,
  };
  const done = nonEmptyItems(entry.done) ?? nonEmptyItems(activity.done)?.slice(0, generatedEntryLimits.done);
  const next = nonEmptyItems(entry.next) ?? nonEmptyItems(activity.next)?.slice(0, generatedEntryLimits.next);
  if (done) entry.done = done;
  if (next) entry.next = next;
  return entry;
}

function replaceEntry(input: UpdateReportEntryInput): ReportEntry {
  return {
    task_id: input.task_id,
    manual_override: true,
    ...(input.done ? { done: input.done } : {}),
    ...(input.next ? { next: input.next } : {}),
    ...(input.today_diff_heading_only !== undefined ? { today_diff_heading_only: input.today_diff_heading_only } : {}),
    ...(input.today_diff_order !== undefined ? { today_diff_order: input.today_diff_order } : {}),
  };
}

function appendEntry(existing: ReportEntry | undefined, input: UpdateReportEntryInput): ReportEntry {
  const visibleEntry = { ...(existing ?? { task_id: input.task_id }) };
  delete visibleEntry.report_exclude;
  const entry: ReportEntry = {
    ...visibleEntry,
    task_id: input.task_id,
    manual_override: true,
    ...(input.today_diff_heading_only !== undefined ? { today_diff_heading_only: input.today_diff_heading_only } : {}),
    ...(input.today_diff_order !== undefined ? { today_diff_order: input.today_diff_order } : {}),
  };
  const done = appendUnique(existing?.done, input.done);
  const next = appendUnique(existing?.next, input.next);
  if (done) entry.done = done;
  if (next) entry.next = next;
  return entry;
}

/**
 * Performs the public `updateReportEntry` operation provided by this module.
 *
 * このモジュールが提供する公開操作`updateReportEntry`を実行します。
 */
export async function updateReportEntry(
  repo: Repository,
  date: string,
  input: UpdateReportEntryInput,
): Promise<UpdateReportEntryResult> {
  return repo.withTransaction(async () => {
    const [report, activity] = await Promise.all([repo.loadReport(date), repo.loadActivity(date)]);
    const index = report.entries.findIndex((entry) => entry.task_id === input.task_id);
    const checkpoint = buildReportActivityCheckpoint(
      activity.entries.filter((entry) => entry.task_id === input.task_id),
    );

    if (input.mode === "clear_override") {
      const removed = index >= 0 ? report.entries.splice(index, 1)[0] : undefined;
      const save = await repo.saveReport(date, report, "clear-report-override");
      return {
        date,
        mode: input.mode,
        task_id: input.task_id,
        removed,
        save,
      };
    }

    if (input.mode === "delete") {
      const removed = index >= 0 ? report.entries[index] : undefined;
      const entry: ReportEntry = {
        task_id: input.task_id,
        manual_override: true,
        report_exclude: true,
        ...checkpoint,
        ...(removed?.today_diff_heading_only !== undefined
          ? { today_diff_heading_only: removed.today_diff_heading_only }
          : {}),
        ...(removed?.today_diff_order !== undefined ? { today_diff_order: removed.today_diff_order } : {}),
      };
      if (index >= 0) report.entries[index] = entry;
      else report.entries.push(entry);
      const save = await repo.saveReport(date, report, "exclude-report-entry");
      return { date, mode: input.mode, task_id: input.task_id, entry, removed, save };
    }

    const entry: ReportEntry = {
      ...(input.mode === "replace"
        ? replaceEntry(input)
        : appendEntry(index >= 0 ? report.entries[index] : undefined, input)),
      ...checkpoint,
    };

    if (index >= 0) {
      report.entries[index] = entry;
    } else {
      report.entries.push(entry);
    }

    const save = await repo.saveReport(date, report, `${input.mode}-report-entry`);
    return {
      date,
      mode: input.mode,
      task_id: input.task_id,
      entry,
      save,
    };
  });
}

/**
 * Performs the public `applyReportOverrides` operation provided by this module.
 *
 * このモジュールが提供する公開操作`applyReportOverrides`を実行します。
 */
export function applyReportOverrides(generated: ReportEntry[], existing: ReportEntry[]): ReportEntry[] {
  const result = generated.map((entry) => ({ ...entry }));
  const indexes = new Map(result.map((entry, index) => [entry.task_id, index]));

  for (const previous of existing) {
    const index = indexes.get(previous.task_id);
    if (previous.manual_override) {
      if (index === undefined) {
        indexes.set(previous.task_id, result.length);
        result.push({ ...previous });
      } else {
        result[index] = { ...previous };
      }
      continue;
    }
    if (index === undefined) continue;
    if (previous.today_diff_heading_only !== undefined) {
      result[index].today_diff_heading_only = previous.today_diff_heading_only;
    }
    if (previous.today_diff_order !== undefined) {
      result[index].today_diff_order = previous.today_diff_order;
    }
  }
  return result;
}

/**
 * Performs the public `generateReportEntriesFromActivities` operation provided by this module.
 *
 * このモジュールが提供する公開操作`generateReportEntriesFromActivities`を実行します。
 */
export async function generateReportEntriesFromActivities(
  repo: Repository,
  date: string,
  write = true,
): Promise<GenerateReportEntriesResult> {
  return repo.withTransaction(async () => {
    const activity = await repo.loadActivity(date);
    const existingReport = await repo.loadReport(date);
    const tasks = await repo.loadTasks();
    const tasksById = new Map(tasks.tasks.map((task) => [task.id, task]));
    const visibleActivityEntries = activity.entries.filter((entry) => {
      const task = tasksById.get(entry.task_id);
      return !isTaskDeleted(task) && task?.report_exclude !== true && task?.status !== "blocked";
    });
    const visibleExistingEntries = existingReport.entries.filter((entry) => {
      const task = tasksById.get(entry.task_id);
      return !isTaskDeleted(task) && task?.report_exclude !== true && task?.status !== "blocked";
    });
    const entriesByTask = new Map<string, ReportEntry>();

    for (const activityEntry of [...visibleActivityEntries].reverse()) {
      const current = entriesByTask.get(activityEntry.task_id);
      const merged = mergeNewestActivityIntoReportEntry(current, activityEntry);
      entriesByTask.set(activityEntry.task_id, merged);
    }

    for (const [taskId, entry] of entriesByTask) {
      entriesByTask.set(taskId, {
        ...entry,
        ...buildReportActivityCheckpoint(
          visibleActivityEntries.filter((activityEntry) => activityEntry.task_id === taskId),
        ),
      });
    }

    const entries = applyReportOverrides([...entriesByTask.values()], visibleExistingEntries);
    const save = write
      ? await repo.saveReport(date, { date, entries }, "generate-report-entries-from-activities")
      : { changed: false, path: repo.layoutPath("reports", `${date}.yaml`) };
    return {
      date,
      entries,
      source_activity_count: visibleActivityEntries.length,
      save,
    };
  });
}
