/**
 * Defines shared activity-domain contracts.
 * Responsibility: This module owns recorded task activity entries and daily activity documents.
 * Non-responsibility: This module does not own task mutation, report generation, or activity persistence workflows.
 *
 * 共通のアクティビティドメイン契約を定義します。
 * 責務: このモジュールは、記録されたタスクアクティビティ項目と日次アクティビティ文書を担当します。
 * 非責務: このモジュールは、タスク変更、レポート生成、アクティビティ永続化のワークフローを担当しません。
 *
 * @packageDocumentation
 */

import type { TaskStatus, TaskTier } from "#shared/types/task";

/**
 * Defines one recorded task activity.
 *
 * 記録された1件のタスクアクティビティを定義します。
 */
export interface ActivityEntry {
  activity_id?: string;
  occurred_at?: string;
  recorded_at?: string;
  task_id: string;
  ticket_id?: string;
  project?: string;
  title?: string;
  status?: TaskStatus;
  tier?: TaskTier;
  due?: string | null;
  compact_summary?: string[];
  done?: string[];
  next?: string[];
  notes?: string[];
  confirm?: string[];
  external_summary?: string[];
  sources?: string[];
  blocked_by?: string[];
  [key: string]: unknown;
}

/**
 * Defines a dated collection of activity entries.
 *
 * 日付に紐づくアクティビティ項目のコレクションを定義します。
 */
export interface ActivityDocument {
  date: string;
  entries: ActivityEntry[];
  [key: string]: unknown;
}
