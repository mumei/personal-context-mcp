/**
 * Defines shared input-domain contracts.
 * Responsibility: This module owns collected external input items and daily input documents.
 * Non-responsibility: This module does not own input collection, task linking behavior, or persistence workflows.
 *
 * 共通の入力ドメイン契約を定義します。
 * 責務: このモジュールは、収集された外部入力項目と日次入力文書を担当します。
 * 非責務: このモジュールは、入力収集、タスク紐付けの振る舞い、永続化ワークフローを担当しません。
 *
 * @packageDocumentation
 */

/**
 * Defines one collected input item.
 *
 * 収集された1件の入力項目を定義します。
 */
export interface InputItem {
  input_id?: string;
  source?: string;
  project?: string;
  title: string;
  url?: string | null;
  received_at?: string;
  summary?: string[];
  action_required?: boolean | null;
  related_task_id?: string | null;
  [key: string]: unknown;
}

/**
 * Defines a dated collection of input items.
 *
 * 日付に紐づく入力項目のコレクションを定義します。
 */
export interface InputsDocument {
  date: string;
  generated_at?: string;
  items: InputItem[];
  [key: string]: unknown;
}
