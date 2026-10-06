/**
 * Provides actions capabilities for the domain layer.
 * Responsibility: This module owns the actions behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * domain層のactions機能を提供します。
 * 責務: このモジュールは、ここで宣言するactionsの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import type { Repository } from "#infra/repository/repository";
import type { ActivityEntry, SaveResult } from "#shared/types";
import { buildTaskActivityIdentityMap } from "#domain/tasks/identity";
import { isTaskDeleted } from "#domain/tasks/state";
import { listTickets } from "#domain/tickets/service";

/**
 * Defines the public `AppendActivityEntryInput` data contract exposed by this module.
 *
 * このモジュールが公開する`AppendActivityEntryInput`データ契約を定義します。
 */
export interface AppendActivityEntryInput {
  task_id: string;
  ticket_id?: string;
  idempotency_key?: string;
  project?: string;
  title?: string;
  done?: string[];
  next?: string[];
  sources?: string[];
  compact_summary?: string[];
  occurred_at?: string;
}

/**
 * Defines the public `AppendActivityEntryResult` data contract exposed by this module.
 *
 * このモジュールが公開する`AppendActivityEntryResult`データ契約を定義します。
 */
export interface AppendActivityEntryResult {
  date: string;
  task_id: string;
  entry: ActivityEntry;
  save: SaveResult;
}

/**
 * Performs the public `appendActivityEntry` operation provided by this module.
 *
 * このモジュールが提供する公開操作`appendActivityEntry`を実行します。
 */
export async function appendActivityEntry(
  repo: Repository,
  date: string,
  input: AppendActivityEntryInput,
  now = new Date(),
): Promise<AppendActivityEntryResult> {
  const occurredAt = input.occurred_at ?? now.toISOString();
  if (Number.isNaN(new Date(occurredAt).getTime())) throw new Error(`Invalid occurred_at: ${occurredAt}`);
  return repo.withTransaction(async () => {
    const tasks = await repo.loadTasks();
    const task = buildTaskActivityIdentityMap(tasks.tasks).get(input.task_id);
    if (!task || isTaskDeleted(task)) throw new Error(`Unknown task_id: ${input.task_id}`);
    if (input.ticket_id && !(await listTickets(repo, task.id)).some((t) => t.ticket_id === input.ticket_id))
      throw new Error("Ticket does not belong to task");
    const activity = await repo.loadActivity(date);
    const duplicate = input.idempotency_key
      ? activity.entries.find((candidate) => candidate.idempotency_key === input.idempotency_key)
      : undefined;
    if (duplicate) {
      if (input.ticket_id && (duplicate.ticket_id !== input.ticket_id || duplicate.task_id !== task.id))
        throw new Error("Activity idempotency key conflict");
      return {
        date,
        task_id: duplicate.task_id,
        entry: duplicate,
        save: { changed: false, path: repo.layoutPath("activities", `${date}.yaml`) },
      };
    }
    const entry: ActivityEntry = {
      activity_id: randomUUID(),
      occurred_at: occurredAt,
      recorded_at: now.toISOString(),
      task_id: task.id,
      ...(input.ticket_id ? { ticket_id: input.ticket_id } : {}),
      ...(input.idempotency_key ? { idempotency_key: input.idempotency_key } : {}),
      ...(input.project ? { project: input.project } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.done ? { done: input.done } : {}),
      ...(input.next ? { next: input.next } : {}),
      ...(input.sources ? { sources: input.sources } : {}),
      ...(input.compact_summary ? { compact_summary: input.compact_summary } : {}),
    };
    activity.entries.push(entry);
    const save = await repo.saveActivity(date, activity, "append-activity-entry");
    return { date, task_id: task.id, entry, save };
  });
}
