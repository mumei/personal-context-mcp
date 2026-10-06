/**
 * Permanent cleanup archive deletion workflow.
 *
 * This module owns filtered deletion from dated cleanup archives. It does not
 * inspect live data, create archives, restore entries, or generate summaries.
 *
 * クリーンアップアーカイブを完全削除するワークフローを提供します。
 *
 * このモジュールは日付で区切られたクリーンアップアーカイブから、条件に
 * 一致する項目を削除する処理を担当します。稼働中データの検査、アーカイブの
 * 作成、項目の復元、要約の生成は担当しません。
 *
 * @packageDocumentation
 */

import { rm } from "node:fs/promises";
import { todayInTimeZone } from "#shared/date";
import type { Repository } from "#infra/repository/repository";
import type { TaskMcpConfig } from "#shared/types";
import {
  archiveRootFor,
  collectArchiveCandidates,
  matchesRelativePathFilter,
  requireArchiveDate,
  targetList,
  validateRelativePathFilters,
} from "#app/cleanup/candidates";
import type {
  CleanupDataRootResult,
  FinalizeCleanupArchiveInput,
  FinalizeCleanupArchiveResult,
} from "#app/cleanup/types";

async function finalizeCleanupArchiveImpl(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone" | "layout">,
  input: FinalizeCleanupArchiveInput,
): Promise<FinalizeCleanupArchiveResult> {
  const archiveDate = requireArchiveDate(input.archive_date ?? todayInTimeZone(config.timezone));
  const target = input.target ?? "outputs";
  const dryRun = input.dry_run ?? true;
  validateRelativePathFilters(input.relative_paths);
  const targets = targetList(target);
  const candidates = (await Promise.all(targets.map((item) => collectArchiveCandidates(repo, archiveDate, item))))
    .flat()
    .filter((candidate) => matchesRelativePathFilter(repo, candidate, input.relative_paths));
  if (!dryRun) {
    for (const candidate of candidates) {
      await rm(candidate.path, { recursive: true, force: true });
      candidate.deleted = true;
    }
  }
  const deleted: CleanupDataRootResult = {
    action: "delete",
    candidates,
    total_count: candidates.length,
    total_size_bytes: candidates.reduce((sum, candidate) => sum + candidate.size_bytes, 0),
    archive_roots: targets.map((item) => archiveRootFor(repo, archiveDate, item)),
  };
  return {
    archive_date: archiveDate,
    target,
    dry_run: dryRun,
    deleted,
    message:
      deleted.total_count === 0
        ? "No archived cleanup candidates matched."
        : dryRun
          ? `Previewed ${deleted.total_count} archived cleanup candidate(s); nothing was deleted.`
          : `Deleted ${deleted.total_count} archived cleanup candidate(s). Unarchived source files were not touched.`,
  };
}

/** Permanently deletes matching archive entries, or previews the deletion. 一致するアーカイブ項目を完全に削除するか、その削除内容をプレビューします。 */
export async function finalizeCleanupArchive(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone" | "layout">,
  input: FinalizeCleanupArchiveInput = {},
): Promise<FinalizeCleanupArchiveResult> {
  return repo.withTransaction(() => finalizeCleanupArchiveImpl(repo, config, input));
}
