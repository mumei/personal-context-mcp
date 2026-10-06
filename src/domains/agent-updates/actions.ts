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

import type { Repository } from "#infra/repository/repository";
import type { AgentUpdate, AgentUpdateStatus, SaveResult } from "#shared/types";

/**
 * Defines the public `UpdateAgentUpdateStatusInput` data contract exposed by this module.
 *
 * このモジュールが公開する`UpdateAgentUpdateStatusInput`データ契約を定義します。
 */
export interface UpdateAgentUpdateStatusInput {
  update_id: string;
  status: AgentUpdateStatus;
  note?: string;
}

/**
 * Defines the public `UpdateAgentUpdateStatusResult` data contract exposed by this module.
 *
 * このモジュールが公開する`UpdateAgentUpdateStatusResult`データ契約を定義します。
 */
export interface UpdateAgentUpdateStatusResult {
  date: string;
  update: AgentUpdate;
  save: SaveResult;
}

/**
 * Performs the public `updateAgentUpdateStatus` operation provided by this module.
 *
 * このモジュールが提供する公開操作`updateAgentUpdateStatus`を実行します。
 */
export async function updateAgentUpdateStatus(
  repo: Repository,
  date: string,
  input: UpdateAgentUpdateStatusInput,
): Promise<UpdateAgentUpdateStatusResult> {
  if (input.status === "applied") {
    throw new Error("Use apply_agent_updates to mark an update as applied and write its activity entry.");
  }
  return repo.withTransaction(async () => {
    const doc = await repo.loadAgentUpdates(date);
    const update = doc.updates.find((item) => item.update_id === input.update_id);
    if (!update) {
      throw new Error(`Agent update not found: ${input.update_id}`);
    }

    update.status = input.status;
    if (input.note) {
      const notes = Array.isArray(update.review_notes) ? update.review_notes.map(String) : [];
      update.review_notes = [...notes, input.note];
    }
    if (input.status !== "applied") {
      delete update.applied_at;
      delete update.applied_to;
    }

    const save = await repo.saveAgentUpdates(date, doc, "update-agent-update-status");
    return { date, update, save };
  });
}
