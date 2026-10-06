/**
 * Report rendering models shared by data loaders, renderers, and generation.
 * データローダー、レンダラー、生成処理で共有するレポートレンダリングモデルです。
 *
 * @remarks
 * This module owns report-rendering types only. It does not load repository data,
 * apply rendering policy, format output, or write generated reports.
 * このモジュールはレポートレンダリング用の型のみを担当します。リポジトリデータの読み込み、
 * レンダリングポリシーの適用、出力の整形、生成済みレポートの書き込みは行いません。
 *
 * @packageDocumentation
 */

import type { ReportSummaryDocument, SaveResult, Task, TaskStatus } from "#shared/types";

/**
 * Output formats supported by report rendering and generation.
 * レポートのレンダリングと生成でサポートされる出力形式です。
 */
export type ReportFormat = "text" | "markdown" | "html";

/**
 * Result returned after rendering a report, with optional persistence metadata.
 * レポートのレンダリング後に返される結果で、任意の永続化メタデータを含みます。
 */
export interface GenerateTextReportResult {
  date: string;
  renderer: ReportFormat;
  path: string;
  text: string;
  save?: SaveResult;
}

/**
 * Task shape enriched with context and date-specific report fields for rendering.
 * レンダリング向けにコンテキストと日付固有のレポート項目を付加したタスクの型です。
 */
export type TextReportTask = Task & {
  summary?: string[];
  compact_summary?: string[];
  metrics?: Record<string, unknown>;
  source?: { url?: string };
  today_diff?: string[];
  next_actions?: string[];
  decision_points?: string[];
  external_summary?: string[];
  today_diff_heading_only?: boolean;
  today_diff_order?: number;
  has_dated_report_entry?: boolean;
};

/**
 * Normalized data consumed by the Markdown and HTML renderers.
 * MarkdownレンダラーとHTMLレンダラーが利用する正規化済みデータです。
 */
export interface ReportData {
  date: string;
  tasks: TextReportTask[];
  counts: Record<TaskStatus, number>;
  activeStatuses: TaskStatus[];
  changedTasksByStatus: Map<TaskStatus, TextReportTask[]>;
  previousDiffs: Map<string, Set<string>>;
  reportSummary: ReportSummaryDocument;
}
