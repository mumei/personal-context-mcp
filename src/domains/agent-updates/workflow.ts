/**
 * Provides workflow capabilities for the domain layer.
 * Responsibility: This module owns the workflow behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * domain層のworkflow機能を提供します。
 * 責務: このモジュールは、ここで宣言するworkflowの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from "node:crypto";
import { nowIso } from "#shared/date";
import type { Repository } from "#infra/repository/repository";
import type { ActivityEntry, AgentUpdate, AgentUpdateStatus, SaveResult, TaskStatus } from "#shared/types";

/**
 * Defines the public `SubmitAgentUpdateInput` data contract exposed by this module.
 *
 * このモジュールが公開する`SubmitAgentUpdateInput`データ契約を定義します。
 */
export interface SubmitAgentUpdateInput {
  session_id: string;
  source: string;
  summary: string;
  task_id?: string;
  project?: string;
  title?: string;
  done?: string[];
  next?: string[];
  confirm?: string[];
  status_suggestion?: TaskStatus;
  context_updates?: string[];
  sources?: string[];
  confidence?: "low" | "medium" | "high";
  occurred_at?: string;
}

/**
 * Defines the public `CompactAgentUpdatesInput` data contract exposed by this module.
 *
 * このモジュールが公開する`CompactAgentUpdatesInput`データ契約を定義します。
 */
export interface CompactAgentUpdatesInput {
  task_id: string;
  status?: AgentUpdateStatus;
  keep?: "latest";
  dry_run?: boolean;
  reason?: string;
}

/**
 * Defines the public `CompactAgentUpdatesResult` data contract exposed by this module.
 *
 * このモジュールが公開する`CompactAgentUpdatesResult`データ契約を定義します。
 */
export interface CompactAgentUpdatesResult {
  date: string;
  dry_run: boolean;
  task_id: string;
  status: AgentUpdateStatus;
  kept_update?: AgentUpdate;
  compacted_updates: AgentUpdate[];
  compacted_update_ids: string[];
  save?: SaveResult;
  message: string;
}

function fingerprint(input: Pick<SubmitAgentUpdateInput, "session_id" | "task_id" | "summary">): string {
  return createHash("sha256")
    .update(`${input.session_id}\n${input.task_id ?? ""}\n${input.summary.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

function updateSortKey(update: AgentUpdate): string {
  return update.occurred_at ?? update.received_at ?? "";
}

async function buildAgentUpdate(
  repo: Repository,
  date: string,
  input: SubmitAgentUpdateInput,
  preview = false,
): Promise<{ update: AgentUpdate; warnings: string[]; duplicate?: AgentUpdate }> {
  const tasks = await repo.loadTasks();
  const matchedTask = input.task_id ? tasks.tasks.find((task) => task.id === input.task_id) : undefined;
  const warnings: string[] = [];
  if (input.task_id && !matchedTask) {
    warnings.push(`Unknown task_id: ${input.task_id}`);
  }

  const doc = await repo.loadAgentUpdates(date);
  const fp = fingerprint(input);
  const duplicate = doc.updates.find((update) => update.update_id.endsWith(fp));
  if (duplicate) {
    warnings.push(`Possible duplicate update: ${duplicate.update_id}`);
  }

  const status = !matchedTask || input.confidence === "low" || duplicate ? "needs_review" : "pending";
  return {
    warnings,
    duplicate,
    update: {
      update_id: preview ? `${date}-preview-${fp}` : `${date}-${randomUUID()}-${fp}`,
      session_id: input.session_id,
      source: input.source,
      status,
      received_at: nowIso(),
      summary: input.summary,
      task_id: input.task_id,
      project: input.project,
      title: input.title,
      done: input.done,
      next: input.next,
      confirm: input.confirm,
      status_suggestion: input.status_suggestion,
      context_updates: input.context_updates,
      sources: input.sources,
      confidence: input.confidence,
      occurred_at: input.occurred_at,
      warnings,
    },
  };
}

/**
 * Performs the public `previewAgentUpdate` operation provided by this module.
 *
 * このモジュールが提供する公開操作`previewAgentUpdate`を実行します。
 */
export async function previewAgentUpdate(
  repo: Repository,
  date: string,
  input: SubmitAgentUpdateInput,
): Promise<{ update: AgentUpdate; warnings: string[]; duplicate?: AgentUpdate }> {
  return buildAgentUpdate(repo, date, input, true);
}

/**
 * Performs the public `activityEntryForAgentUpdate` operation provided by this module.
 *
 * このモジュールが提供する公開操作`activityEntryForAgentUpdate`を実行します。
 */
export function activityEntryForAgentUpdate(update: AgentUpdate): ActivityEntry | null {
  if (update.status !== "pending" || !update.task_id) {
    return null;
  }
  return {
    activity_id: update.update_id,
    agent_update_id: update.update_id,
    occurred_at: update.occurred_at ?? update.received_at,
    recorded_at: update.received_at,
    task_id: update.task_id,
    project: update.project,
    title: update.title,
    done: update.done,
    next: update.next,
    confirm: update.confirm,
    compact_summary: update.context_updates,
    sources: update.sources,
    status: update.status_suggestion,
  };
}

/**
 * Performs the public `submitAgentUpdate` operation provided by this module.
 *
 * このモジュールが提供する公開操作`submitAgentUpdate`を実行します。
 */
export async function submitAgentUpdate(
  repo: Repository,
  date: string,
  input: SubmitAgentUpdateInput,
): Promise<{ update: AgentUpdate; save: SaveResult; warnings: string[] }> {
  return repo.withTransaction(async () => {
    const { update, warnings, duplicate } = await buildAgentUpdate(repo, date, input);
    const doc = await repo.loadAgentUpdates(date);
    if (duplicate) {
      return {
        update: duplicate,
        warnings,
        save: {
          changed: false,
          path: repo.layoutPath("agentUpdates", `${date}.yaml`),
        },
      };
    }
    doc.updates.push(update);
    const save = await repo.saveAgentUpdates(date, doc, "submit-agent-update");
    return { update, save, warnings };
  });
}

/**
 * Performs the public `applyAgentUpdatesDryRun` operation provided by this module.
 *
 * このモジュールが提供する公開操作`applyAgentUpdatesDryRun`を実行します。
 */
export async function applyAgentUpdatesDryRun(
  repo: Repository,
  date: string,
  updateIds?: string[],
): Promise<{
  entries: ActivityEntry[];
  skipped_updates: string[];
  already_applied_updates: string[];
  warnings: string[];
}> {
  const doc = await repo.loadAgentUpdates(date);
  const activity = await repo.loadActivity(date);
  const existingUpdateIds = new Set(
    activity.entries.map((entry) => entry.agent_update_id).filter((id): id is string => typeof id === "string"),
  );
  const selected = doc.updates.filter((update) => {
    if (updateIds && !updateIds.includes(update.update_id)) {
      return false;
    }
    return update.status === "pending";
  });
  const skipped_updates = doc.updates
    .filter((update) => updateIds?.includes(update.update_id) && update.status !== "pending")
    .map((update) => update.update_id);
  const warnings: string[] = [];
  const entries: ActivityEntry[] = [];
  const already_applied_updates: string[] = [];

  for (const update of selected) {
    if (existingUpdateIds.has(update.update_id)) {
      already_applied_updates.push(update.update_id);
      continue;
    }
    if (!update.task_id) {
      skipped_updates.push(update.update_id);
      warnings.push(`Update ${update.update_id} has no task_id`);
      continue;
    }
    const entry = activityEntryForAgentUpdate(update);
    if (entry) entries.push(entry);
  }

  return { entries, skipped_updates, already_applied_updates, warnings };
}

/**
 * Performs the public `applyAgentUpdates` operation provided by this module.
 *
 * このモジュールが提供する公開操作`applyAgentUpdates`を実行します。
 */
export async function applyAgentUpdates(
  repo: Repository,
  date: string,
  updateIds?: string[],
): Promise<{
  entries: ActivityEntry[];
  skipped_updates: string[];
  already_applied_updates: string[];
  warnings: string[];
  activitySave: SaveResult;
  agentUpdatesSave: SaveResult;
}> {
  return repo.withTransaction(async () => {
    const dryRun = await applyAgentUpdatesDryRun(repo, date, updateIds);
    const activity = await repo.loadActivity(date);
    activity.entries.push(...dryRun.entries);
    const activityPath = repo.layoutPath("activities", `${date}.yaml`);
    const activitySave =
      dryRun.entries.length > 0
        ? await repo.saveActivity(date, activity, "apply-agent-updates")
        : { changed: false, path: activityPath };

    const doc = await repo.loadAgentUpdates(date);
    const appliedIds = new Set(
      doc.updates
        .filter((update) => update.status === "pending")
        .filter((update) => !updateIds || updateIds.includes(update.update_id))
        .filter((update) => !dryRun.skipped_updates.includes(update.update_id))
        .map((update) => update.update_id),
    );
    for (const update of doc.updates) {
      if (!appliedIds.has(update.update_id)) {
        continue;
      }
      update.status = "applied";
      update.applied_at = nowIso();
      update.applied_to = [activitySave.path];
    }
    const agentUpdatesSave =
      appliedIds.size > 0
        ? await repo.saveAgentUpdates(date, doc, "mark-agent-updates-applied")
        : { changed: false, path: repo.layoutPath("agentUpdates", `${date}.yaml`) };

    return {
      ...dryRun,
      activitySave,
      agentUpdatesSave,
    };
  });
}

/**
 * Performs the public `compactAgentUpdates` operation provided by this module.
 *
 * このモジュールが提供する公開操作`compactAgentUpdates`を実行します。
 */
export async function compactAgentUpdates(
  repo: Repository,
  date: string,
  input: CompactAgentUpdatesInput,
): Promise<CompactAgentUpdatesResult> {
  return repo.withTransaction(async () => {
    const status = input.status ?? "pending";
    const doc = await repo.loadAgentUpdates(date);
    const candidates = doc.updates
      .filter((update) => update.task_id === input.task_id && update.status === status)
      .sort((left, right) => {
        const compared = updateSortKey(left).localeCompare(updateSortKey(right));
        return compared !== 0 ? compared : left.update_id.localeCompare(right.update_id);
      });

    if (candidates.length <= 1) {
      return {
        date,
        dry_run: input.dry_run ?? true,
        task_id: input.task_id,
        status,
        kept_update: candidates[0],
        compacted_updates: [],
        compacted_update_ids: [],
        message: "No compaction needed.",
      };
    }

    const kept = candidates[candidates.length - 1];
    const compacted = candidates.slice(0, -1);
    if (!kept) {
      return {
        date,
        dry_run: input.dry_run ?? true,
        task_id: input.task_id,
        status,
        compacted_updates: [],
        compacted_update_ids: [],
        message: "No compaction candidates found.",
      };
    }

    const dryRun = input.dry_run ?? true;
    if (dryRun) {
      return {
        date,
        dry_run: true,
        task_id: input.task_id,
        status,
        kept_update: kept,
        compacted_updates: compacted,
        compacted_update_ids: compacted.map((update) => update.update_id),
        message: `Would mark ${compacted.length} older ${status} updates as rejected and keep ${kept.update_id}.`,
      };
    }

    const compactedAt = nowIso();
    for (const update of doc.updates) {
      if (!compacted.some((item) => item.update_id === update.update_id)) {
        continue;
      }
      update.status = "rejected";
      update.compacted_at = compactedAt;
      update.compacted_into = kept.update_id;
      update.compact_reason = input.reason ?? `Compacted into latest ${input.task_id} update for ${date}.`;
    }
    kept.compacted_from = compacted.map((update) => update.update_id);
    kept.compacted_at = compactedAt;

    const save = await repo.saveAgentUpdates(date, doc, "compact-agent-updates");
    const reloaded = await repo.loadAgentUpdates(date);
    const keptUpdate = reloaded.updates.find((update) => update.update_id === kept.update_id) ?? kept;
    const compactedUpdates = reloaded.updates.filter((update) =>
      compacted.some((item) => item.update_id === update.update_id),
    );

    return {
      date,
      dry_run: false,
      task_id: input.task_id,
      status,
      kept_update: keptUpdate,
      compacted_updates: compactedUpdates,
      compacted_update_ids: compacted.map((update) => update.update_id),
      save,
      message: `Marked ${compacted.length} older ${status} updates as rejected and kept ${kept.update_id}.`,
    };
  });
}
