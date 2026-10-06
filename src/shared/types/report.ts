/**
 * Defines shared report-domain contracts.
 * Responsibility: This module owns task report entries and dated report documents.
 * Non-responsibility: This module does not own report generation, rendering, persistence, or memory summaries.
 *
 * 共通のレポートドメイン契約を定義します。
 * 責務: このモジュールは、タスクのレポート項目と日付付きレポート文書を担当します。
 * 非責務: このモジュールは、レポート生成、描画、永続化、メモリ要約を担当しません。
 *
 * @packageDocumentation
 */

import type { TaskStatus, TaskTier } from "#shared/types/task";

/**
 * Defines one task entry in a report.
 *
 * レポート内の1件のタスク項目を定義します。
 */
export interface ReportEntry {
  task_id: string;
  done?: string[];
  next?: string[];
  task_snapshot?: {
    title: string;
    project?: string;
    tier?: TaskTier;
    status?: TaskStatus;
    summary: string[];
  };
  /**
   * Provides the legacy summary field for reports written before `task_snapshot` was introduced.
   *
   * @deprecated Read legacy report data only; new data should use `task_snapshot`.
   *
   * `task_snapshot`導入前に書き込まれたレポート向けの旧要約フィールドを提供します。
   *
   * @deprecated 旧レポートデータの読み取り専用です。新しいデータでは`task_snapshot`を使用してください。
   */
  task_summary?: string[];
  manual_override?: boolean;
  source_activity_revision?: string;
  source_activity_ids?: string[];
  activity_generated_at?: string;
  report_exclude?: boolean;
  today_diff_heading_only?: boolean;
  today_diff_order?: number;
  [key: string]: unknown;
}

/**
 * Defines a dated collection of report entries.
 *
 * 日付に紐づくレポート項目のコレクションを定義します。
 */
export interface ReportDocument {
  date: string;
  entries: ReportEntry[];
  [key: string]: unknown;
}
