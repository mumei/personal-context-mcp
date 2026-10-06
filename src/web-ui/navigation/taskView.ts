/**
 * Resolves the task detail tab that should be retained when navigating between tasks.
 * Responsibility: This module owns validation and fallback behavior for task-view route parameters.
 * Non-responsibility: This module does not mutate routes, load task data, or render navigation controls.
 *
 * タスク間を移動するときに維持するタスク詳細タブを解決します。
 * 責務: このモジュールは、タスク表示ルートパラメータの検証とフォールバックを担当します。
 * 非責務: このモジュールは、ルート変更、タスクデータ読込、ナビゲーション描画を担当しません。
 *
 * @packageDocumentation
 */

export const taskViews = ["current", "overview", "context", "memory"] as const;

export type TaskView = (typeof taskViews)[number];

/**
 * Returns the active task view for task-to-task navigation, or the current-status view outside task pages.
 * タスク間遷移では現在のタスク表示を返し、タスク画面外では現在状況表示を返します。
 */
export function retainedTaskView(routeName: unknown, routeView: unknown): TaskView {
  if (routeName !== "task" || typeof routeView !== "string") return "current";
  return taskViews.includes(routeView as TaskView) ? (routeView as TaskView) : "current";
}
