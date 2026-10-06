/**
 * Defines shared memory-domain contracts.
 * Responsibility: This module owns task, global, report, and reviewable memory document shapes.
 * Non-responsibility: This module does not own memory extraction, review, application, or persistence workflows.
 *
 * 共通のメモリドメイン契約を定義します。
 * 責務: このモジュールは、タスク、グローバル、レポート、レビュー可能なメモリ文書の形式を担当します。
 * 非責務: このモジュールは、メモリの抽出、レビュー、適用、永続化ワークフローを担当しません。
 *
 * @packageDocumentation
 */

/**
 * Defines a reference to source material used by memory documents.
 *
 * メモリ文書で使用した情報源への参照を定義します。
 */
export interface MemorySourceRef {
  path?: string;
  date?: string;
  task_id?: string;
  section?: string;
}

/**
 * Defines a recursive node in a memory mind map.
 *
 * メモリのマインドマップ内にある再帰的なノードを定義します。
 */
export interface MemoryMindMapNode {
  label: string;
  children?: MemoryMindMapNode[];
}

/**
 * Defines the root and children of a memory mind map.
 *
 * メモリのマインドマップのルートと子要素を定義します。
 */
export interface MemoryMindMap {
  root: string;
  children: MemoryMindMapNode[];
}

/**
 * Defines the accumulated memory for one task.
 *
 * 1件のタスクについて蓄積されたメモリを定義します。
 */
export interface TaskMemoryDocument {
  task_id: string;
  summary?: string[];
  facts?: string[];
  decisions?: string[];
  risks?: string[];
  next?: string[];
  mindmap?: MemoryMindMap;
  sources?: MemorySourceRef[];
  input_hash?: string;
  applied_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * Defines memory shared globally across tasks.
 *
 * タスク全体でグローバルに共有されるメモリを定義します。
 */
export interface GlobalMemoryDocument {
  summary?: string[];
  preferences?: string[];
  rules?: string[];
  sources?: MemorySourceRef[];
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * Defines a durable summary derived from a dated report.
 *
 * 日付付きレポートから生成される永続的な要約を定義します。
 */
export interface ReportSummaryDocument {
  date: string;
  headline?: string;
  done?: string[];
  next?: string[];
  confirm?: string[];
  risks?: string[];
  notes?: string[];
  sources?: MemorySourceRef[];
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * Defines review states available to a generated memory summary.
 *
 * 生成されたメモリ要約で利用できるレビュー状態を定義します。
 */
export type MemorySummaryStatus = "pending" | "applied" | "rejected" | "skipped";

/**
 * Defines the document targets available to a memory summary.
 *
 * メモリ要約で利用できる文書の適用先を定義します。
 */
export type MemorySummaryTarget = "task" | "global" | "report";

/**
 * Defines one generated and reviewable memory summary.
 *
 * 生成され、レビュー可能な1件のメモリ要約を定義します。
 */
export interface MemorySummary {
  summary_id: string;
  status: MemorySummaryStatus;
  target_type: MemorySummaryTarget;
  task_id?: string;
  report_date?: string;
  headline?: string;
  summary?: string[];
  facts?: string[];
  decisions?: string[];
  risks?: string[];
  next?: string[];
  done?: string[];
  confirm?: string[];
  notes?: string[];
  preferences?: string[];
  rules?: string[];
  sources?: MemorySourceRef[];
  input_hash?: string;
  skip_reason?: string;
  seen_count?: number;
  last_seen_at?: string;
  created_at: string;
  applied_at?: string;
  rejected_at?: string;
  review_notes?: string[];
  [key: string]: unknown;
}

/**
 * Defines a dated collection of generated memory summaries.
 *
 * 日付に紐づく生成済みメモリ要約のコレクションを定義します。
 */
export interface MemorySummariesDocument {
  date: string;
  summaries: MemorySummary[];
  [key: string]: unknown;
}
