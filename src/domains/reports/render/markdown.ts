/**
 * Markdown report rendering.
 * Markdownレポートのレンダリングを提供します。
 *
 * @remarks
 * This module owns the exact Markdown document layout. It does not load raw task
 * sources directly, render text or HTML, choose formats, or persist output.
 * このモジュールは、Markdown文書のレイアウトを厳密に担当します。タスクの元データを
 * 直接読み込むこと、テキストやHTMLをレンダリングすること、形式を選択すること、出力を
 * 永続化することは行いません。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";
import { buildReportData } from "#domain/reports/render/data";
import {
  asStringArray,
  compactTaskSummary,
  dateToDisplay,
  hasReportSummary,
  groupReportTasksByProject,
  reportStatusOrder,
  sectionLabel,
  statusLabels,
  statusMarks,
  taskDetails,
  taskHeading,
  tierTitle,
  weekday,
} from "#domain/reports/render/policy";

/**
 * Renders the report for a date as Markdown.
 * 指定日のレポートをMarkdownとしてレンダリングします。
 */
export async function renderMarkdownReport(repo: Repository, date: string): Promise<string> {
  const data = await buildReportData(repo, date);
  const lines: string[] = [];

  lines.push(`# ${dateToDisplay(date)}（${weekday(date)}）`);
  lines.push("");
  lines.push(`- tasks: ${data.tasks.length}`);
  for (const status of data.activeStatuses) {
    lines.push(`- ${statusMarks[status]} ${statusLabels[status]}: ${data.counts[status]}`);
  }
  lines.push("");
  if (hasReportSummary(data.reportSummary)) {
    lines.push("## 本日まとめ");
    lines.push("");
    if (data.reportSummary.headline) {
      lines.push(`- ${data.reportSummary.headline}`);
    }
    for (const [label, items] of [
      ["やったこと", asStringArray(data.reportSummary.done)],
      ["これからやること", asStringArray(data.reportSummary.next)],
      ["リスク", asStringArray(data.reportSummary.risks)],
      ["メモ", asStringArray(data.reportSummary.notes)],
    ] as const) {
      if (items.length === 0) continue;
      lines.push(`- ${label}`);
      items.forEach((item) => lines.push(`  - ${item}`));
    }
    lines.push("");
  }
  if (data.changedTasksByStatus.size > 0) {
    lines.push("## 本日差分・状況報告");
    lines.push("");
    for (const status of reportStatusOrder) {
      const statusTasks = data.changedTasksByStatus.get(status) ?? [];
      if (statusTasks.length === 0) {
        continue;
      }
      lines.push(`### ${sectionLabel(status)}`);
      lines.push("");
      for (const group of groupReportTasksByProject(statusTasks)) {
        lines.push(`#### ${group.project}`);
        lines.push("");
        for (const task of group.tasks) {
          const details = taskDetails(task, data.previousDiffs);
          lines.push(`##### ${taskHeading(task)}`);
          if (details.done.length > 0) {
            lines.push("- やったこと");
            details.done.forEach((item) => lines.push(`  - ${item}`));
          }
          if (details.next.length > 0) {
            lines.push("- これからやること");
            details.next.forEach((item) => lines.push(`  - ${item}`));
          }
          if (details.done.length === 0 && details.next.length === 0 && task.title === "daily") {
            compactTaskSummary(task).forEach((item) => lines.push(`- ${item}`));
          }
          lines.push("");
        }
      }
    }
  }

  for (const tier of [1, 2, 3]) {
    const tierTasks = data.tasks.filter((task) => Number(task.tier) === tier);
    if (tierTasks.length === 0) {
      continue;
    }
    lines.push(`## ${tierTitle(tier)}`);
    lines.push("");
    for (const group of groupReportTasksByProject(tierTasks)) {
      lines.push(`### ${group.project}`);
      lines.push("");
      for (const task of group.tasks) {
        lines.push(`#### ${taskHeading(task)}`);
        compactTaskSummary(task).forEach((item) => lines.push(`- ${item}`));
        lines.push("");
      }
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
