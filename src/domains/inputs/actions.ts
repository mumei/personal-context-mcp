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
import type { InputItem, SaveResult } from "#shared/types";

/**
 * Defines the public `UpsertInputItemMode` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`UpsertInputItemMode`を定義します。
 */
export type UpsertInputItemMode = "replace" | "append" | "delete";

/**
 * Defines the public `UpsertInputItemInput` data contract exposed by this module.
 *
 * このモジュールが公開する`UpsertInputItemInput`データ契約を定義します。
 */
export interface UpsertInputItemInput {
  input_id?: string;
  title: string;
  mode: UpsertInputItemMode;
  source?: string;
  project?: string;
  url?: string | null;
  received_at?: string;
  summary?: string[];
  action_required?: boolean | null;
  related_task_id?: string | null;
}

/**
 * Defines the public `UpsertInputItemResult` data contract exposed by this module.
 *
 * このモジュールが公開する`UpsertInputItemResult`データ契約を定義します。
 */
export interface UpsertInputItemResult {
  date: string;
  mode: UpsertInputItemMode;
  title: string;
  item?: InputItem;
  removed?: InputItem;
  save: SaveResult;
}

function inputKey(item: Pick<InputItem, "title" | "source" | "url">): string {
  return `${item.source ?? ""}\n${item.url ?? ""}\n${item.title}`;
}

function appendUnique(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  const merged = [...(existing ?? [])];
  for (const item of incoming ?? []) {
    if (!merged.includes(item)) {
      merged.push(item);
    }
  }
  return merged.length > 0 ? merged : undefined;
}

function replaceItem(input: UpsertInputItemInput): InputItem {
  return {
    input_id: input.input_id ?? randomUUID(),
    title: input.title,
    ...(input.source ? { source: input.source } : {}),
    ...(input.project ? { project: input.project } : {}),
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.received_at ? { received_at: input.received_at } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.action_required !== undefined ? { action_required: input.action_required } : {}),
    ...(input.related_task_id !== undefined ? { related_task_id: input.related_task_id } : {}),
  };
}

function appendItem(existing: InputItem | undefined, input: UpsertInputItemInput): InputItem {
  const item: InputItem = {
    ...(existing ?? { title: input.title }),
    input_id: existing?.input_id ?? input.input_id ?? randomUUID(),
    title: input.title,
    ...(input.source ? { source: input.source } : {}),
    ...(input.project ? { project: input.project } : {}),
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.received_at ? { received_at: input.received_at } : {}),
    ...(input.action_required !== undefined ? { action_required: input.action_required } : {}),
    ...(input.related_task_id !== undefined ? { related_task_id: input.related_task_id } : {}),
  };
  const summary = appendUnique(existing?.summary, input.summary);
  if (summary) item.summary = summary;
  return item;
}

/**
 * Performs the public `upsertInputItem` operation provided by this module.
 *
 * このモジュールが提供する公開操作`upsertInputItem`を実行します。
 */
export async function upsertInputItem(
  repo: Repository,
  date: string,
  input: UpsertInputItemInput,
): Promise<UpsertInputItemResult> {
  return repo.withTransaction(async () => {
    const doc = await repo.loadInputs(date);
    const key = inputKey(input);
    const index = doc.items.findIndex((item) =>
      input.input_id ? item.input_id === input.input_id : inputKey(item) === key,
    );

    if (input.mode === "delete") {
      const removed = index >= 0 ? doc.items.splice(index, 1)[0] : undefined;
      const save = await repo.saveInputs(date, doc, "delete-input-item");
      return { date, mode: input.mode, title: input.title, removed, save };
    }

    const item =
      input.mode === "replace" ? replaceItem(input) : appendItem(index >= 0 ? doc.items[index] : undefined, input);
    if (index >= 0) {
      doc.items[index] = item;
    } else {
      doc.items.push(item);
    }

    const save = await repo.saveInputs(date, doc, `${input.mode}-input-item`);
    return { date, mode: input.mode, title: input.title, item, save };
  });
}
