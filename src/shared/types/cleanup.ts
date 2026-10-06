/**
 * Defines shared cleanup-domain contracts.
 * Responsibility: This module owns cleanup summary, grouped result, and affected-file contracts.
 * Non-responsibility: This module does not own cleanup candidate discovery, archival, restoration, or finalization.
 *
 * 共通のクリーンアップドメイン契約を定義します。
 * 責務: このモジュールは、クリーンアップ要約、グループ化された結果、対象ファイルの契約を担当します。
 * 非責務: このモジュールは、クリーンアップ候補の検出、アーカイブ、復元、確定処理を担当しません。
 *
 * @packageDocumentation
 */

/**
 * Defines one file represented in a cleanup summary.
 *
 * クリーンアップ要約に含まれる1件のファイルを定義します。
 */
export interface CleanupSummaryFile {
  relative_path: string;
  target: string;
  kind: string;
  size_bytes: number;
  archived_to?: string;
  restore_to?: string;
  inferred_task_ids?: string[];
  content_kind?: "text" | "directory" | "binary_or_large" | "unreadable";
  summary?: string[];
  content_preview?: string;
}

/**
 * Defines the result summary for one cleanup operation.
 *
 * 1回のクリーンアップ処理の結果要約を定義します。
 */
export interface CleanupSummary {
  summary_id: string;
  created_at: string;
  source: "current" | "archive";
  target: string;
  archive_date?: string;
  candidate_count: number;
  total_size_bytes: number;
  groups: Array<{
    target: string;
    kind: string;
    count: number;
    size_bytes: number;
  }>;
  inferred_task_ids?: string[];
  files: CleanupSummaryFile[];
  notes?: string[];
}

/**
 * Defines a dated collection of cleanup summaries.
 *
 * 日付に紐づくクリーンアップ要約のコレクションを定義します。
 */
export interface CleanupSummariesDocument {
  date: string;
  summaries: CleanupSummary[];
  [key: string]: unknown;
}
