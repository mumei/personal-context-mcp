/**
 * Defines shared task-domain contracts.
 * Responsibility: This module owns task state, priority, task records, and task collection contracts.
 * Non-responsibility: This module does not own task workflows, persistence, activities, or reports.
 *
 * 共通のタスクドメイン契約を定義します。
 * 責務: このモジュールは、タスクの状態、優先度、タスクレコード、タスクコレクションの契約を担当します。
 * 非責務: このモジュールは、タスクのワークフロー、永続化、アクティビティ、レポートを担当しません。
 *
 * @packageDocumentation
 */

/**
 * Defines the lifecycle states available to a task.
 *
 * タスクで利用できるライフサイクル状態を定義します。
 */
export type TaskStatus = "todo" | "inProgress" | "done" | "waiting" | "blocked";

/**
 * Defines the priority tiers available to a task.
 *
 * タスクで利用できる優先度階層を定義します。
 */
export type TaskTier = 1 | 2 | 3;

/**
 * Defines a task record shared across application boundaries.
 *
 * アプリケーション境界を越えて共有されるタスクレコードを定義します。
 */
export interface Task {
  id: string;
  project?: string;
  title: string;
  tier?: TaskTier;
  status?: TaskStatus;
  due?: string | null;
  completed_on?: string | null;
  blocked_by?: string[];
  cadence?: string;
  activity_aliases?: string[];
  report_exclude?: boolean;
  deleted?: boolean;
  context?: string;
  [key: string]: unknown;
}

/**
 * Defines the persisted collection of task records.
 *
 * 永続化されるタスクレコードのコレクションを定義します。
 */
export interface TasksDocument {
  tasks: Task[];
  [key: string]: unknown;
}
