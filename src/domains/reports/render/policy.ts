/**
 * Common normalization and presentation policy for report renderers.
 * レポートレンダラー共通の正規化と表示ポリシーを提供します。
 *
 * @remarks
 * This module owns deterministic value coercion, task inclusion rules, labels,
 * headings, and escaping shared across formats. It does not access repositories,
 * assemble complete documents, or persist output.
 * このモジュールは、各形式で共有する決定的な値変換、タスク包含ルール、ラベル、見出し、
 * エスケープを担当します。リポジトリへのアクセス、文書全体の組み立て、出力の永続化は
 * 行いません。
 *
 * @packageDocumentation
 */

import type { ReportEntry, ReportSummaryDocument, TaskStatus } from "#shared/types";
import type { ReportFormat, TextReportTask } from "#domain/reports/render/model";

/**
 * Status marks used in every rendered report format.
 * すべてのレポート出力形式で使用するステータス記号です。
 */
export const statusMarks: Record<TaskStatus, string> = {
  todo: "●",
  inProgress: "▶",
  done: "★",
  waiting: "◇",
  blocked: "▲",
};

/**
 * Human-readable status labels used in rendered summaries.
 * レンダリングされたサマリーで使用する、人が読みやすいステータスラベルです。
 */
export const statusLabels: Record<TaskStatus, string> = {
  todo: "TODO",
  inProgress: "inProgress",
  done: "Done",
  waiting: "外部待ち",
  blocked: "ブロック",
};

/**
 * Stable status ordering for report sections.
 * レポートセクションで使用する固定のステータス順序です。
 */
export const reportStatusOrder: TaskStatus[] = ["done", "todo", "inProgress", "waiting", "blocked"];

const reportStatusRank = new Map(reportStatusOrder.map((status, index) => [status, index]));
const reportCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

/** One project group in deterministic report order. 決定的なレポート順序に並んだ1つのprojectグループです。 */
export interface ReportTaskGroup {
  project: string;
  tasks: TextReportTask[];
}

/** Returns the visible label for a report project group. レポートのprojectグループ表示名を返します。 */
export function reportProjectLabel(task: TextReportTask): string {
  return task.project?.trim() || "未分類";
}

/**
 * Compares tasks by Tier, project, status, manual daily order, title, and id.
 * Tier、project、status、手動日次順、タイトル、idの順でタスクを比較します。
 */
export function compareReportTasks(left: TextReportTask, right: TextReportTask): number {
  const tier = (Number(left.tier) || 999) - (Number(right.tier) || 999);
  if (tier !== 0) return tier;
  const project = reportCollator.compare(reportProjectLabel(left), reportProjectLabel(right));
  if (project !== 0) return project;
  const status =
    (reportStatusRank.get(left.status ?? "todo") ?? 999) - (reportStatusRank.get(right.status ?? "todo") ?? 999);
  if (status !== 0) return status;
  const manualOrder = (left.today_diff_order ?? 999) - (right.today_diff_order ?? 999);
  if (manualOrder !== 0) return manualOrder;
  const title = reportCollator.compare(taskTitle(left), taskTitle(right));
  return title !== 0 ? title : reportCollator.compare(left.id, right.id);
}

/** Sorts tasks and groups adjacent items by project. タスクを並べ替え、隣接する項目をproject単位でまとめます。 */
export function groupReportTasksByProject(tasks: TextReportTask[]): ReportTaskGroup[] {
  const groups = new Map<string, TextReportTask[]>();
  for (const task of [...tasks].sort(compareReportTasks)) {
    const project = reportProjectLabel(task);
    groups.set(project, [...(groups.get(project) ?? []), task]);
  }
  return [...groups].map(([project, groupedTasks]) => ({ project, tasks: groupedTasks }));
}

const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * Coerces an unknown array value into non-empty strings.
 * 未知の配列値を空でない文字列の配列へ変換します。
 */
export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter((item) => item.length > 0) : [];
}

/**
 * Coerces a plain object value into a string-keyed record.
 * プレーンオブジェクトの値を文字列キーのレコードへ変換します。
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Normalizes a date-like value to a report date string when possible.
 * 日付相当の値を、可能な場合はレポート用の日付文字列へ正規化します。
 */
export function normalizeDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Converts an ISO-style date to the display form used by reports.
 * ISO形式の日付をレポートで使用する表示形式へ変換します。
 */
export function dateToDisplay(date: string): string {
  return date.replace(/-/g, "/");
}

/**
 * Returns the Japanese weekday label for a report date.
 * レポート日付に対応する日本語の曜日ラベルを返します。
 */
export function weekday(date: string): string {
  return weekdays[new Date(`${date}T00:00:00.000Z`).getUTCDay()] ?? "";
}

/**
 * Returns the compact due-date suffix for a task heading.
 * タスク見出しに付加する簡潔な期限表記を返します。
 */
export function dueText(task: TextReportTask): string {
  const due = normalizeDate(task.due);
  if (!due) {
    return "";
  }
  const [, month, day] = due.split("-");
  return ` (~${Number(month)}/${Number(day)})`;
}

/**
 * Determines whether a completed task belongs to the specified report date.
 * 完了済みタスクが指定されたレポート日の対象かどうかを判定します。
 */
export function completedOnReportDate(task: TextReportTask, date: string): boolean {
  if (task.status !== "done") {
    return false;
  }
  const completed = normalizeDate(task.completed_on ?? task.done_on ?? task.completed_at);
  if (completed) {
    return completed === date;
  }
  return normalizeDate(task.due) === date;
}

/**
 * Determines whether a task should appear in a report for the specified date.
 * タスクを指定日のレポートに表示すべきかどうかを判定します。
 */
export function reportableTask(task: TextReportTask, date: string): boolean {
  if (task.report_exclude) {
    return false;
  }
  if (task.status === "blocked") {
    return false;
  }
  if (task.status === "done") {
    return completedOnReportDate(task, date) || task.has_dated_report_entry === true;
  }
  return true;
}

/**
 * Returns the report-facing title for a task.
 * タスクのレポート表示用タイトルを返します。
 */
export function taskTitle(task: TextReportTask): string {
  return task.title === "daily" ? "(daily)" : task.title;
}

/**
 * Builds the canonical task heading shared by all report formats.
 * すべてのレポート形式で共有する標準タスク見出しを組み立てます。
 */
export function taskHeading(task: TextReportTask): string {
  const status = task.status ?? "todo";
  return `${statusMarks[status]} [ ${task.project ?? ""} ] ${taskTitle(task)}${dueText(task)}`;
}

/**
 * Builds the stable key used to compare a task's daily differences.
 * タスクの日次差分を比較するための安定したキーを組み立てます。
 */
export function taskReportKey(task: TextReportTask): string {
  return `[ ${task.project ?? ""} ] ${taskTitle(task)}`;
}

/**
 * Selects at most two compact summary lines for a task.
 * タスクの簡潔なサマリー行を最大2件選択します。
 */
export function compactTaskSummary(task: TextReportTask): string[] {
  const compact = asStringArray(task.compact_summary);
  if (typeof task.ticket_progress === "string") return [task.ticket_progress, ...compact.slice(0, 1)];
  if (compact.length > 0) {
    return compact.slice(0, 2);
  }
  return [
    ...asStringArray(task.external_summary),
    ...asStringArray(task.summary),
    ...asStringArray(task.today_diff),
  ].slice(0, 2);
}

/**
 * Selects and orders tasks with date-specific report changes.
 * 日付固有のレポート変更があるタスクを選択し、順序付けします。
 */
export function changedTasks(tasks: TextReportTask[], date: string): TextReportTask[] {
  return tasks
    .filter((task) => {
      const changed =
        asStringArray(task.today_diff).length > 0 ||
        task.today_diff_heading_only ||
        asStringArray(task.external_summary).length > 0 ||
        asStringArray(task.next_actions).length > 0 ||
        asStringArray(task.decision_points).length > 0;
      return changed || completedOnReportDate(task, date);
    })
    .sort(compareReportTasks);
}

/**
 * Normalizes whitespace before comparing report difference lines.
 * レポート差分行を比較する前に空白を正規化します。
 */
export function normalizeDiffText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Extracts a task comparison key from a rendered text heading.
 * レンダリング済みのテキスト見出しからタスク比較キーを抽出します。
 */
export function reportKeyFromHeading(line: string): string {
  const markPattern = Object.values(statusMarks)
    .map((mark) => mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("");
  return line.replace(new RegExp(`^[${markPattern}]\\s+`), "").replace(/ \(~\d{1,2}\/\d{1,2}\)$/, "");
}

/**
 * Determines whether a text line is a rendered task heading.
 * テキスト行がレンダリング済みのタスク見出しかどうかを判定します。
 */
export function taskHeadingLine(line: string): boolean {
  return Object.values(statusMarks).some((mark) => line.startsWith(`${mark} [ `));
}

/**
 * Removes daily differences already present in the previous report, except URLs.
 * URLを除き、前回のレポートにすでに存在する日次差分を取り除きます。
 */
export function filteredTodayDiff(task: TextReportTask, previousDiffs: Map<string, Set<string>>): string[] {
  const previous = previousDiffs.get(taskReportKey(task)) ?? new Set();
  return asStringArray(task.today_diff).filter(
    (item) => /https?:\/\/\S+/i.test(item) || !previous.has(normalizeDiffText(item)),
  );
}

/**
 * Returns the section label used for a status.
 * ステータスに使用するセクションラベルを返します。
 */
export function sectionLabel(status: TaskStatus): string {
  return status === "inProgress" ? "in progress" : statusLabels[status].toLowerCase();
}

/**
 * Returns the display title for a task tier.
 * タスク階層の表示用タイトルを返します。
 */
export function tierTitle(tier: number): string {
  return tier === 1 ? "Tier1（優先度高）" : tier === 2 ? "Tier2（すぐ実行できないもの）" : "Tier3（優先度が低い）";
}

/**
 * Selects task detail lists shared by Markdown and HTML rendering.
 * MarkdownとHTMLのレンダリングで共有するタスク詳細リストを選択します。
 */
export function taskDetails(
  task: TextReportTask,
  previousDiffs: Map<string, Set<string>>,
): {
  done: string[];
  next: string[];
} {
  return {
    done: filteredTodayDiff(task, previousDiffs),
    next: asStringArray(task.next_actions),
  };
}

/**
 * Escapes text for safe interpolation into generated HTML.
 * 生成HTMLへ安全に埋め込めるようテキストをエスケープします。
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Returns the output filename extension for a report format.
 * レポート形式に対応する出力ファイル名の拡張子を返します。
 */
export function reportExtension(format: ReportFormat): string {
  return format === "markdown" ? "md" : format === "html" ? "html" : "txt";
}

/**
 * Determines whether a report summary has any renderable content.
 * レポートサマリーにレンダリング可能な内容があるかどうかを判定します。
 */
export function hasReportSummary(summary: ReportSummaryDocument): boolean {
  return Boolean(
    summary.headline ||
    asStringArray(summary.done).length > 0 ||
    asStringArray(summary.next).length > 0 ||
    asStringArray(summary.risks).length > 0 ||
    asStringArray(summary.notes).length > 0,
  );
}

/**
 * Merges a date-specific report entry into a task used for rendering.
 * 日付固有のレポート項目をレンダリング用タスクへ統合します。
 */
export function mergeReportEntry(task: TextReportTask, entry: ReportEntry | undefined): TextReportTask {
  if (!entry) {
    return task;
  }
  const snapshot = entry.task_snapshot;
  return {
    ...task,
    has_dated_report_entry: true,
    ...(snapshot
      ? {
          title: snapshot.title,
          project: snapshot.project,
          tier: snapshot.tier,
          status: snapshot.status,
          compact_summary: asStringArray(snapshot.summary),
        }
      : {
          compact_summary:
            asStringArray(entry.task_summary).length > 0 ? asStringArray(entry.task_summary) : task.compact_summary,
        }),
    today_diff: asStringArray(entry.done),
    next_actions: asStringArray(entry.next),
    report_exclude: entry.report_exclude === true ? true : task.report_exclude,
    today_diff_heading_only:
      typeof entry.today_diff_heading_only === "boolean" ? entry.today_diff_heading_only : undefined,
    today_diff_order: typeof entry.today_diff_order === "number" ? entry.today_diff_order : undefined,
  };
}
