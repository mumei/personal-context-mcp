/**
 * Cleanup preview and archive workflows.
 *
 * This module owns live-candidate archive moves and the atomic archive-summary
 * workflow. It does not restore or permanently delete archived entries.
 *
 * クリーンアップのプレビューとアーカイブのワークフローを提供します。
 *
 * このモジュールは稼働中候補のアーカイブ移動と、アーカイブおよび要約を
 * 一体で扱うワークフローを担当します。アーカイブ済み項目の復元や完全削除は
 * 担当しません。
 *
 * @packageDocumentation
 */

import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { todayInTimeZone } from "#shared/date";
import type { Repository } from "#infra/repository/repository";
import type { SaveResult, TaskMcpConfig } from "#shared/types";
import {
  archiveRelativePath,
  archiveRootFor,
  collectArchiveCandidates,
  collectTargetCandidates,
  defaultKeepOutputDirs,
  expandArchiveManifestCandidates,
  requireArchiveDate,
  rollbackArchivedCandidates,
  targetList,
  uniqueDestination,
} from "#app/cleanup/candidates";
import { buildCleanupSummary, summarizeCleanupCandidates } from "#app/cleanup/summarization";
import type {
  ArchiveCleanupInput,
  ArchiveCleanupResult,
  CleanupCandidate,
  CleanupDataRootInput,
  CleanupDataRootResult,
} from "#app/cleanup/types";

/** Previews, archives, or deletes top-level cleanup candidates for a data root. データルートの最上位クリーンアップ候補をプレビュー、アーカイブ、または削除します。 */
export async function cleanupDataRoot(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone" | "layout">,
  input: CleanupDataRootInput = {},
): Promise<CleanupDataRootResult> {
  const action = input.action ?? "preview";
  const target = input.target ?? "outputs";
  const archiveDate = requireArchiveDate(input.archive_date ?? todayInTimeZone(config.timezone));
  const targets = targetList(target);
  const keepOutputDirs = new Set(input.keep_output_dirs ?? defaultKeepOutputDirs);
  const candidates = (
    await Promise.all(
      targets.map((item) =>
        action === "delete"
          ? collectArchiveCandidates(repo, archiveDate, item)
          : collectTargetCandidates(repo, item, keepOutputDirs),
      ),
    )
  ).flat();
  const archiveRoots = targets.map((item) => archiveRootFor(repo, archiveDate, item));

  if (action === "archive") {
    for (const candidate of candidates) {
      const destination = await uniqueDestination(
        join(archiveRootFor(repo, archiveDate, candidate.target), archiveRelativePath(candidate)),
      );
      await mkdir(dirname(destination), { recursive: true });
      await rename(candidate.path, destination);
      candidate.archived_to = destination;
    }
  } else if (action === "delete") {
    for (const candidate of candidates) {
      await rm(candidate.path, { recursive: true, force: true });
      candidate.deleted = true;
    }
  }
  return {
    action,
    candidates,
    total_count: candidates.length,
    total_size_bytes: candidates.reduce((sum, candidate) => sum + candidate.size_bytes, 0),
    archive_roots: action === "archive" || action === "delete" ? archiveRoots : undefined,
  };
}

async function archiveCleanupImpl(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone" | "layout">,
  input: ArchiveCleanupInput,
): Promise<ArchiveCleanupResult> {
  const summaryDate = todayInTimeZone(config.timezone);
  const archiveDate = requireArchiveDate(input.archive_date ?? summaryDate);
  const target = input.target ?? "outputs";
  const dryRun = input.dry_run ?? true;
  if (dryRun) {
    const archive = await cleanupDataRoot(repo, config, {
      action: "preview",
      target,
      archive_date: archiveDate,
      keep_output_dirs: input.keep_output_dirs,
    });
    const summarized = await summarizeCleanupCandidates(repo, config, {
      target,
      source: "current",
      archive_date: archiveDate,
      write: false,
      keep_output_dirs: input.keep_output_dirs,
    });
    return {
      archive_date: archiveDate,
      summary_date: summarized.date,
      target,
      dry_run: true,
      archive,
      summary: summarized.summary,
      message: `Previewed ${archive.total_count} cleanup candidate(s); no files were moved or written.`,
    };
  }

  const archive = await cleanupDataRoot(repo, config, {
    action: "archive",
    target,
    archive_date: archiveDate,
    keep_output_dirs: input.keep_output_dirs,
  });
  const archivedCandidates: CleanupCandidate[] = archive.candidates
    .filter((candidate) => candidate.archived_to)
    .map((candidate) => {
      const archivedPath = candidate.archived_to as string;
      return {
        ...candidate,
        path: archivedPath,
        relative_path: relative(repo.root, archivedPath),
        kind:
          candidate.kind === "noncanonical_output_dir" ||
          candidate.kind === "backup_dir" ||
          candidate.kind === "agent_update_asset_dir"
            ? "archived_dir"
            : "archived_file",
      };
    });
  const manifestCandidates = await expandArchiveManifestCandidates(repo, archivedCandidates);
  const summary = await buildCleanupSummary(repo, {
    date: summaryDate,
    source: "archive",
    target,
    archive_date: archiveDate,
    candidates: archivedCandidates,
    file_candidates: manifestCandidates,
    notes: [
      "Summary was generated for candidates moved by this archive_cleanup call.",
      "Use restore_cleanup_archive with relative_paths to restore only specific archived files.",
    ],
  });
  let save: SaveResult;
  try {
    const doc = await repo.loadCleanupSummaries(summaryDate);
    doc.summaries.push(summary);
    save = await repo.saveCleanupSummaries(summaryDate, doc, "archive-cleanup");
  } catch (error) {
    try {
      await rollbackArchivedCandidates(archive.candidates);
    } catch (rollbackError) {
      throw new AggregateError(
        [error as Error, rollbackError as Error],
        "Archive summary persistence failed; some archived files could not be rolled back. Inspect cleanup_archive before retrying.",
      );
    }
    throw new Error("Archive summary persistence failed; all moved candidates were rolled back.", { cause: error });
  }
  return {
    archive_date: archiveDate,
    summary_date: summaryDate,
    target,
    dry_run: false,
    archive,
    summary,
    save,
    message:
      archive.total_count === 0
        ? "No cleanup candidates were archived. The archive summary still records current archive state."
        : `Archived ${archive.total_count} cleanup candidate(s) and recorded a restorable archive summary.`,
  };
}

/** Atomically archives live candidates and records a restorable summary. 稼働中の候補を原子的にアーカイブし、復元可能な要約を記録します。 */
export async function archiveCleanup(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone" | "layout">,
  input: ArchiveCleanupInput = {},
): Promise<ArchiveCleanupResult> {
  return repo.withTransaction(() => archiveCleanupImpl(repo, config, input));
}
