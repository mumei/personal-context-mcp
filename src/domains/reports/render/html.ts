/**
 * HTML report rendering.
 * HTMLレポートのレンダリングを提供します。
 *
 * @remarks
 * This module owns the exact standalone HTML document layout and escaping at its
 * interpolation sites. It does not load raw task sources directly, render text or
 * Markdown, choose formats, or persist output.
 * このモジュールは、単独で表示可能なHTML文書の厳密なレイアウトと、値を埋め込む箇所での
 * エスケープを担当します。タスクの元データを直接読み込むこと、テキストやMarkdownを
 * レンダリングすること、形式を選択すること、出力を永続化することは行いません。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";
import { buildReportData } from "#domain/reports/render/data";
import {
  asStringArray,
  compactTaskSummary,
  dateToDisplay,
  escapeHtml,
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
 * Renders the report for a date as a standalone HTML document.
 * 指定日のレポートを単独で表示可能なHTML文書としてレンダリングします。
 */
export async function renderHtmlReport(repo: Repository, date: string): Promise<string> {
  const data = await buildReportData(repo, date);
  const lines: string[] = [
    "<!doctype html>",
    '<html lang="ja">',
    "<head>",
    '  <meta charset="utf-8">',
    `  <title>${escapeHtml(dateToDisplay(date))} タスクレポート</title>`,
    "  <style>",
    "    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.65; max-width: 920px; margin: 40px auto; padding: 0 24px; color: #1f2937; }",
    "    h1, h2, h3, h4, h5 { line-height: 1.3; }",
    "    h1 { border-bottom: 2px solid #111827; padding-bottom: 12px; }",
    "    h2 { margin-top: 36px; border-bottom: 1px solid #d1d5db; padding-bottom: 8px; }",
    "    .summary { display: flex; gap: 16px; flex-wrap: wrap; padding: 0; list-style: none; }",
    "    .summary li { background: #f3f4f6; border: 1px solid #e5e7eb; padding: 6px 10px; border-radius: 6px; }",
    "    .task { margin: 18px 0 28px; }",
    "    .empty { color: #6b7280; }",
    "  </style>",
    "</head>",
    "<body>",
    `  <h1>${escapeHtml(dateToDisplay(date))}（${escapeHtml(weekday(date))}）</h1>`,
    '  <ul class="summary">',
    `    <li>tasks: ${data.tasks.length}</li>`,
  ];
  for (const status of data.activeStatuses) {
    lines.push(
      `    <li>${escapeHtml(statusMarks[status])} ${escapeHtml(statusLabels[status])}: ${data.counts[status]}</li>`,
    );
  }
  lines.push("  </ul>");
  if (hasReportSummary(data.reportSummary)) {
    lines.push("  <h2>本日まとめ</h2>");
    if (data.reportSummary.headline) {
      lines.push(`  <p>${escapeHtml(data.reportSummary.headline)}</p>`);
    }
    for (const [label, items] of [
      ["やったこと", asStringArray(data.reportSummary.done)],
      ["これからやること", asStringArray(data.reportSummary.next)],
      ["リスク", asStringArray(data.reportSummary.risks)],
      ["メモ", asStringArray(data.reportSummary.notes)],
    ] as const) {
      if (items.length === 0) continue;
      lines.push(`  <h3>${escapeHtml(label)}</h3>`);
      lines.push("  <ul>");
      items.forEach((item) => lines.push(`    <li>${escapeHtml(item)}</li>`));
      lines.push("  </ul>");
    }
  }
  if (data.changedTasksByStatus.size > 0) {
    lines.push("  <h2>本日差分・状況報告</h2>");
    for (const status of reportStatusOrder) {
      const statusTasks = data.changedTasksByStatus.get(status) ?? [];
      if (statusTasks.length === 0) {
        continue;
      }
      lines.push(`  <h3>${escapeHtml(sectionLabel(status))}</h3>`);
      for (const group of groupReportTasksByProject(statusTasks)) {
        lines.push(`  <h4>${escapeHtml(group.project)}</h4>`);
        for (const task of group.tasks) {
          const details = taskDetails(task, data.previousDiffs);
          lines.push('  <section class="task">');
          lines.push(`    <h5>${escapeHtml(taskHeading(task))}</h5>`);
          for (const [label, items] of [
            ["やったこと", details.done],
            ["これからやること", details.next],
          ] as const) {
            if (items.length === 0) {
              continue;
            }
            lines.push(`    <p><strong>${escapeHtml(label)}</strong></p>`);
            lines.push("    <ul>");
            items.forEach((item) => lines.push(`      <li>${escapeHtml(item)}</li>`));
            lines.push("    </ul>");
          }
          if (details.done.length === 0 && details.next.length === 0 && task.title === "daily") {
            lines.push("    <ul>");
            compactTaskSummary(task).forEach((item) => lines.push(`      <li>${escapeHtml(item)}</li>`));
            lines.push("    </ul>");
          }
          lines.push("  </section>");
        }
      }
    }
  }

  for (const tier of [1, 2, 3]) {
    const tierTasks = data.tasks.filter((task) => Number(task.tier) === tier);
    if (tierTasks.length === 0) {
      continue;
    }
    lines.push(`  <h2>${escapeHtml(tierTitle(tier))}</h2>`);
    for (const group of groupReportTasksByProject(tierTasks)) {
      lines.push(`  <h3>${escapeHtml(group.project)}</h3>`);
      for (const task of group.tasks) {
        lines.push('  <section class="task">');
        lines.push(`    <h4>${escapeHtml(taskHeading(task))}</h4>`);
        lines.push("    <ul>");
        compactTaskSummary(task).forEach((item) => lines.push(`      <li>${escapeHtml(item)}</li>`));
        lines.push("    </ul>");
        lines.push("  </section>");
      }
    }
  }

  lines.push("</body>");
  lines.push("</html>");
  return `${lines.join("\n")}\n`;
}
