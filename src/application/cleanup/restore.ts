/**
 * Cleanup archive restoration workflow.
 *
 * This module owns restore destination selection and archive-to-live moves. It
 * does not discover live cleanup candidates, summarize content, or delete files.
 *
 * クリーンアップアーカイブの復元ワークフローを提供します。
 *
 * このモジュールは復元先の選択と、アーカイブから稼働中領域への移動を
 * 担当します。稼働中のクリーンアップ候補の検出、内容の要約、ファイル削除は
 * 担当しません。
 *
 * @packageDocumentation
 */

import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { todayInTimeZone } from "#shared/date";
import type { Repository } from "#infra/repository/repository";
import type { TaskMcpConfig } from "#shared/types";
import {
  collectArchiveCandidates,
  matchesRelativePathFilter,
  requireArchiveDate,
  restoreDestinationFor,
  targetList,
  uniqueDestination,
  validateRelativePathFilters,
} from "#app/cleanup/candidates";
import type { CleanupCandidate, RestoreCleanupArchiveInput, RestoreCleanupArchiveResult } from "#app/cleanup/types";

async function restoreCleanupArchiveImpl(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone" | "layout">,
  input: RestoreCleanupArchiveInput,
): Promise<RestoreCleanupArchiveResult> {
  const archiveDate = requireArchiveDate(input.archive_date ?? todayInTimeZone(config.timezone));
  const target = input.target ?? "outputs";
  const dryRun = input.dry_run ?? true;
  validateRelativePathFilters(input.relative_paths);
  const archived = (
    await Promise.all(targetList(target).map((item) => collectArchiveCandidates(repo, archiveDate, item)))
  ).flat();
  const candidates: Array<CleanupCandidate & { restore_to: string; restored?: boolean }> = archived
    .map((candidate) => ({
      ...candidate,
      restore_to: restoreDestinationFor(repo, candidate.target, candidate.relative_path),
    }))
    .filter((candidate) => matchesRelativePathFilter(repo, candidate, input.relative_paths));

  if (!dryRun) {
    for (const candidate of candidates) {
      const destination = await uniqueDestination(candidate.restore_to);
      await mkdir(dirname(destination), { recursive: true });
      await rename(candidate.path, destination);
      candidate.restore_to = destination;
      candidate.restored = true;
    }
  }
  return {
    archive_date: archiveDate,
    target,
    dry_run: dryRun,
    candidates,
    total_count: candidates.length,
    total_size_bytes: candidates.reduce((sum, candidate) => sum + candidate.size_bytes, 0),
  };
}

/** Restores matching archived candidates, or previews their destinations. 一致するアーカイブ済み候補を復元するか、その復元先をプレビューします。 */
export async function restoreCleanupArchive(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone" | "layout">,
  input: RestoreCleanupArchiveInput = {},
): Promise<RestoreCleanupArchiveResult> {
  if (input.dry_run ?? true) return restoreCleanupArchiveImpl(repo, config, input);
  return repo.withTransaction(() => restoreCleanupArchiveImpl(repo, config, input));
}
