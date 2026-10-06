/**
 * Provides state capabilities for the domain layer.
 * Responsibility: This module owns the state behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * domain層のstate機能を提供します。
 * 責務: このモジュールは、ここで宣言するstateの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import type { Task } from "#shared/types";

/**
 * Performs the public `isTaskDeleted` operation provided by this module.
 *
 * このモジュールが提供する公開操作`isTaskDeleted`を実行します。
 */
export function isTaskDeleted(task: Task | undefined): boolean {
  return task?.deleted === true;
}

/**
 * Performs the public `activeTasks` operation provided by this module.
 *
 * このモジュールが提供する公開操作`activeTasks`を実行します。
 */
export function activeTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => !isTaskDeleted(task));
}
