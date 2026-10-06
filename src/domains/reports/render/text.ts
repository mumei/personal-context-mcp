/**
 * Plain-text report rendering.
 * プレーンテキストレポートのレンダリングを提供します。
 *
 * @remarks
 * This module owns the exact line-oriented text report layout. It does not load
 * unrelated domain data, render Markdown or HTML, choose formats, or write files.
 * このモジュールは、行単位のテキストレポートレイアウトを厳密に担当します。無関係な
 * ドメインデータの読み込み、MarkdownやHTMLのレンダリング、形式選択、ファイル書き込みは
 * 行いません。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";
import type { ReportSummaryDocument, TaskStatus } from "#shared/types";
import { buildTextReportTasks, loadPreviousTodayDiffs } from "#domain/reports/render/data";
import type { TextReportTask } from "#domain/reports/render/model";
import {
  asStringArray,
  changedTasks,
  compactTaskSummary,
  dateToDisplay,
  filteredTodayDiff,
  groupReportTasksByProject,
  hasReportSummary,
  reportStatusOrder,
  statusLabels,
  statusMarks,
  taskHeading,
  tierTitle,
  weekday,
} from "#domain/reports/render/policy";

function renderCompactTask(task: TextReportTask): string[] {
  const lines = [taskHeading(task)];
  const summaries = compactTaskSummary(task);
  for (const summary of summaries) {
    lines.push(`  - ${summary}`);
  }
  const sourceUrl = task.source?.url;
  if (sourceUrl && summaries.length < 2) {
    lines.push(`  - ${sourceUrl}`);
  }
  return lines;
}

function renderSection(lines: string[], title: string): void {
  lines.push("=======================================");
  lines.push(title);
  lines.push("=======================================");
  lines.push("");
}

function taskGap(lines: string[]): void {
  lines.push("");
  lines.push("");
}

async function renderExternalDiff(
  lines: string[],
  repo: Repository,
  tasks: TextReportTask[],
  date: string,
): Promise<void> {
  const previousDiffs = await loadPreviousTodayDiffs(repo, date);
  const tasksByStatus = new Map<TaskStatus, TextReportTask[]>();
  for (const task of changedTasks(tasks, date)) {
    const status = task.status ?? "todo";
    tasksByStatus.set(status, [...(tasksByStatus.get(status) ?? []), task]);
  }

  if (tasksByStatus.size === 0) {
    return;
  }
  renderSection(lines, "本日差分・状況報告");

  for (const status of reportStatusOrder) {
    const statusTasks = tasksByStatus.get(status) ?? [];
    if (statusTasks.length === 0) {
      continue;
    }
    const sectionLabel = status === "inProgress" ? "in progress" : statusLabels[status].toLowerCase();
    lines.push(`[ ${sectionLabel} ]`);
    lines.push("");

    for (const group of groupReportTasksByProject(statusTasks)) {
      lines.push(`-- ${group.project} --`);
      lines.push("");
      for (const task of group.tasks) {
        lines.push(taskHeading(task));
        const doneItems = [...filteredTodayDiff(task, previousDiffs), ...asStringArray(task.external_summary)];
        let renderedDetail = false;
        if (doneItems.length > 0) {
          lines.push("  - やったこと:");
          for (const item of doneItems) {
            lines.push(`      - ${item}`);
          }
          renderedDetail = true;
        }
        const nextActions = asStringArray(task.next_actions);
        if (nextActions.length > 0) {
          lines.push("  - これからやること:");
          for (const item of nextActions) {
            lines.push(`      - ${item}`);
          }
          renderedDetail = true;
        }
        const decisionPoints = asStringArray(task.decision_points);
        if (decisionPoints.length > 0) {
          lines.push("  - 確認:");
          for (const item of decisionPoints) {
            lines.push(`      - ${item}`);
          }
          renderedDetail = true;
        }
        if (!renderedDetail && task.title === "daily") {
          compactTaskSummary(task).forEach((item, index) => {
            if (index === 0) {
              lines.push("  - やったこと:");
            }
            lines.push(`      - ${item}`);
          });
        }
        taskGap(lines);
      }
    }
  }
}

function renderTextReportSummary(lines: string[], summary: ReportSummaryDocument): void {
  if (!hasReportSummary(summary)) {
    return;
  }
  renderSection(lines, "本日まとめ");
  if (summary.headline) {
    lines.push(`- ${summary.headline}`);
  }
  for (const [label, items] of [
    ["やったこと", asStringArray(summary.done)],
    ["これからやること", asStringArray(summary.next)],
    ["リスク", asStringArray(summary.risks)],
    ["メモ", asStringArray(summary.notes)],
  ] as const) {
    if (items.length === 0) continue;
    lines.push(`- ${label}:`);
    items.forEach((item) => lines.push(`    - ${item}`));
  }
  lines.push("");
}

/**
 * Renders the report for a date using the legacy plain-text layout.
 * 指定日のレポートを従来のプレーンテキストレイアウトでレンダリングします。
 */
export async function renderTextReport(repo: Repository, date: string): Promise<string> {
  const tasks = await buildTextReportTasks(repo, date);
  const lines: string[] = [];
  const counts = Object.keys(statusLabels).reduce<Record<TaskStatus, number>>(
    (acc, status) => {
      const typedStatus = status as TaskStatus;
      acc[typedStatus] = tasks.filter((task) => task.status === typedStatus).length;
      return acc;
    },
    { todo: 0, inProgress: 0, done: 0, waiting: 0, blocked: 0 },
  );
  const activeStatuses = reportStatusOrder.filter((status) => counts[status] > 0);

  lines.push(`${dateToDisplay(date)}（${weekday(date)}）`);
  lines.push("");
  lines.push(`tasks: ${tasks.length}`);
  for (const status of activeStatuses) {
    lines.push(`  - ${statusMarks[status]}${statusLabels[status].padEnd(11, " ")}: ${counts[status]}`);
  }
  lines.push("");
  lines.push("");

  renderTextReportSummary(lines, await repo.loadReportSummary(date));
  await renderExternalDiff(lines, repo, tasks, date);

  for (const tier of [1, 2, 3]) {
    const tierTasks = tasks.filter((task) => Number(task.tier) === tier);
    if (tierTasks.length === 0) {
      continue;
    }
    lines.push("");
    renderSection(lines, `■${tierTitle(tier)}`);
    for (const group of groupReportTasksByProject(tierTasks)) {
      lines.push(`-- ${group.project} --`);
      lines.push("");
      for (const task of group.tasks) {
        lines.push(...renderCompactTask(task));
        taskGap(lines);
      }
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
