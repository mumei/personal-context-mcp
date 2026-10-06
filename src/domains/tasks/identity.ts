/**
 * Resolves canonical task identities and legacy Activity task-id aliases.
 * Responsibility: This module validates task identity collisions and maps Activity journal IDs to canonical tasks.
 * Non-responsibility: This module does not mutate tasks or rewrite immutable Activity entries.
 *
 * 正規タスクIDと旧Activity用task-id aliasを解決します。
 * 責務: このモジュールは、タスク識別子の衝突検証とActivityジャーナルIDから正規タスクへの対応付けを担当します。
 * 非責務: このモジュールは、タスク更新や不変Activityの書き換えを担当しません。
 *
 * @packageDocumentation
 */

import type { Task } from "#shared/types";

/** Builds an identity lookup containing canonical IDs and declared Activity aliases. */
export function buildTaskActivityIdentityMap(tasks: Task[]): Map<string, Task> {
  const identities = new Map<string, Task>();
  for (const task of tasks) identities.set(task.id, task);
  for (const task of tasks) {
    for (const rawAlias of task.activity_aliases ?? []) {
      const alias = rawAlias.trim();
      if (!alias) throw new Error(`Task activity alias must not be empty: ${task.id}`);
      const existing = identities.get(alias);
      if (existing && existing.id !== task.id) {
        throw new Error(`Task activity alias conflicts with another task identity: ${alias}`);
      }
      identities.set(alias, task);
    }
  }
  return identities;
}
