/**
 * Provides repartition capabilities for the domain layer.
 * Responsibility: This module owns the repartition behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * domain層のrepartition機能を提供します。
 * 責務: このモジュールは、ここで宣言するrepartitionの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { operationalDateInTimeZone } from "#shared/date";
import type { Repository } from "#infra/repository/repository";
import type { ActivityDocument, ActivityEntry, AgentUpdate, TaskMcpConfig } from "#shared/types";

/**
 * Defines the public `ActivityRepartitionResult` data contract exposed by this module.
 *
 * このモジュールが公開する`ActivityRepartitionResult`データ契約を定義します。
 */
export interface ActivityRepartitionResult {
  moved_entries: number;
  enriched_entries: number;
  changed_files: string[];
  unresolved_legacy_entries: number;
  invalid_timestamp_entries: number;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

/**
 * Performs the public `repartitionActivities` operation provided by this module.
 *
 * このモジュールが提供する公開操作`repartitionActivities`を実行します。
 */
export async function repartitionActivities(
  repo: Repository,
  target: Pick<TaskMcpConfig, "timezone"> & Partial<Pick<TaskMcpConfig, "activityRolloverHour">>,
): Promise<ActivityRepartitionResult> {
  return repo.withTransaction(async () => {
    const [activityDates, updateDates] = await Promise.all([
      repo.listYamlDates(repo.layoutName("activities")),
      repo.listYamlDates(repo.layoutName("agentUpdates")),
    ]);
    const updates = new Map<string, AgentUpdate>();
    for (const date of updateDates) {
      const doc = await repo.loadAgentUpdates(date);
      for (const update of doc.updates) updates.set(update.update_id, update);
    }

    const original = new Map<string, ActivityDocument>();
    const redistributed = new Map<string, ActivityDocument>();
    for (const date of activityDates) {
      const doc = await repo.loadActivity(date);
      original.set(date, doc);
      redistributed.set(date, { ...doc, date, entries: [] });
    }

    let movedEntries = 0;
    let enrichedEntries = 0;
    let unresolvedLegacyEntries = 0;
    let invalidTimestampEntries = 0;
    for (const [sourceDate, doc] of original) {
      for (const sourceEntry of doc.entries) {
        const entry: ActivityEntry = { ...sourceEntry };
        const updateId = typeof entry.agent_update_id === "string" ? entry.agent_update_id : undefined;
        const update = updateId ? updates.get(updateId) : undefined;
        if (!entry.occurred_at && update && validTimestamp(update.occurred_at ?? update.received_at)) {
          entry.occurred_at = update.occurred_at ?? update.received_at;
          entry.recorded_at ??= update.received_at;
          enrichedEntries += 1;
        }

        let targetDate = sourceDate;
        if (entry.occurred_at === undefined) {
          unresolvedLegacyEntries += 1;
        } else if (!validTimestamp(entry.occurred_at)) {
          invalidTimestampEntries += 1;
        } else {
          targetDate = operationalDateInTimeZone(
            target.timezone,
            target.activityRolloverHour ?? 0,
            new Date(entry.occurred_at),
          );
          if (targetDate !== sourceDate) movedEntries += 1;
        }
        const targetDoc = redistributed.get(targetDate) ?? { date: targetDate, entries: [] };
        targetDoc.entries.push(entry);
        redistributed.set(targetDate, targetDoc);
      }
    }

    const changedFiles: string[] = [];
    const allDates = new Set([...original.keys(), ...redistributed.keys()]);
    for (const date of [...allDates].sort()) {
      const before = original.get(date) ?? { date, entries: [] };
      const after = redistributed.get(date) ?? { date, entries: [] };
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const save = await repo.saveActivity(date, after, "repartition-activities");
      changedFiles.push(save.path);
    }
    return {
      moved_entries: movedEntries,
      enriched_entries: enrichedEntries,
      changed_files: changedFiles,
      unresolved_legacy_entries: unresolvedLegacyEntries,
      invalid_timestamp_entries: invalidTimestampEntries,
    };
  });
}
