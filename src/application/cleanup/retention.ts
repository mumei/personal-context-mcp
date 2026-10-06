/**
 * Applies deterministic backup retention and archive expiry.
 * Responsibility: This module selects backup generations, moves removable data into the existing restorable cleanup
 * archive, records a manifest summary, and removes archived backup data whose grace period expired.
 * Non-responsibility: It does not generate backups, use an LLM, or delete live task data.
 *
 * 決定的なバックアップ保持とアーカイブ期限切れ処理を適用します。
 * 責務: 保持するバックアップ世代を選択し、削減対象を既存の復元可能なcleanup archiveへ移動し、
 * manifest要約を記録して、猶予期間を過ぎたアーカイブ済みバックアップだけを削除します。
 * 非責務: バックアップ生成、LLM利用、稼働中タスクデータの削除は行いません。
 *
 * @packageDocumentation
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import YAML from "yaml";
import { automaticBackupContentDetailLimit, buildCleanupSummary } from "#app/cleanup/summarization";
import {
  archiveRelativePath,
  archiveRootFor,
  exists,
  expandArchiveManifestCandidates,
  pathSize,
  rollbackArchivedCandidates,
  uniqueDestination,
} from "#app/cleanup/candidates";
import type { CleanupCandidate } from "#app/cleanup/types";
import { operationalDateInTimeZone } from "#shared/date";
import type { Repository } from "#infra/repository/repository";
import {
  loadMaintenanceRunState,
  maintenanceStatePath,
  type MaintenanceRunState,
} from "#infra/config/maintenanceSettings";
import type { BackupCleanupConfig, TaskMcpConfig } from "#shared/types";

export interface BackupRetentionInput {
  dry_run?: boolean;
  force?: boolean;
  now?: Date;
}

export interface BackupRetentionResult {
  operational_date: string;
  dry_run: boolean;
  skipped: boolean;
  skip_reason?: "disabled" | "before_schedule" | "already_ran";
  archived_count: number;
  archived_size_bytes: number;
  deleted_archive_count: number;
  deleted_archive_size_bytes: number;
  kept_backup_dates: string[];
  archived_backup_dates: string[];
  compacted_backup_file_count: number;
  compacted_backup_files_sample: string[];
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const backupNamePattern = /^(.*)\.(\d{14,17})(?:\.[0-9a-f-]{36})?\.([^.]+)\.bak$/i;
const automaticBackupRetentionNote = "Created by automatic backup retention.";
const expiredArchiveManifestPrunedNote = "The per-file manifest was pruned after archive expiry.";

function daysBetween(current: string, candidate: string): number {
  return Math.floor((Date.parse(`${current}T00:00:00Z`) - Date.parse(`${candidate}T00:00:00Z`)) / 86_400_000);
}

function isoWeekKey(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function localTime(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

function selectBackupDates(dates: string[], current: string, policy: BackupCleanupConfig) {
  const descending = [...dates].sort().reverse();
  const keep = new Set<string>();
  const weekly = new Set<string>();
  const monthly = new Set<string>();
  for (const date of descending) {
    const age = daysBetween(current, date);
    if (age < 0 || age <= policy.keepDailyDays) {
      keep.add(date);
      continue;
    }
    if (age <= policy.keepWeeklyDays) {
      const key = isoWeekKey(date);
      if (!weekly.has(key)) {
        weekly.add(key);
        keep.add(date);
      }
      continue;
    }
    if (age <= policy.keepMonthlyDays) {
      const key = date.slice(0, 7);
      if (!monthly.has(key)) {
        monthly.add(key);
        keep.add(date);
      }
    }
  }
  return { keep, archive: descending.filter((date) => !keep.has(date)) };
}

async function backupFilesToCompact(
  repo: Repository,
  dates: string[],
  current: string,
  policy: BackupCleanupConfig,
): Promise<CleanupCandidate[]> {
  const candidates: CleanupCandidate[] = [];
  for (const date of dates) {
    if (daysBetween(current, date) <= policy.keepAllDays) continue;
    const root = repo.layoutPath("backups", date);
    const names = (await readdir(root)).sort().reverse();
    const groups = new Map<string, string[]>();
    for (const name of names) {
      const path = join(root, name);
      if (!(await stat(path)).isFile()) continue;
      const match = name.match(backupNamePattern);
      const logical = match ? `${match[1]}|${match[3]}` : name;
      const group = groups.get(logical) ?? [];
      group.push(path);
      groups.set(logical, group);
    }
    for (const paths of groups.values()) {
      const retainedHashes = new Set<string>();
      let retained = 0;
      for (const path of paths) {
        const hash = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
        const shouldKeep = retained < policy.maxVersionsPerFilePerDay && !retainedHashes.has(hash);
        if (shouldKeep) {
          retained += 1;
          retainedHashes.add(hash);
          continue;
        }
        candidates.push({
          path,
          relative_path: relative(repo.root, path),
          target: "backups",
          kind: "backup_file",
          size_bytes: await pathSize(path),
        });
      }
    }
  }
  return candidates;
}

async function archiveCandidates(repo: Repository, date: string, candidates: CleanupCandidate[]): Promise<void> {
  for (const candidate of candidates) {
    const destination = await uniqueDestination(
      join(archiveRootFor(repo, date, "backups"), archiveRelativePath(candidate)),
    );
    await mkdir(dirname(destination), { recursive: true });
    await rename(candidate.path, destination);
    candidate.archived_to = destination;
  }
}

async function compactExpiredAutomaticBackupSummaries(repo: Repository, archiveDate: string): Promise<void> {
  const document = await repo.loadCleanupSummaries(archiveDate);
  let changed = false;
  for (const summary of document.summaries) {
    if (summary.target !== "backups" || !summary.notes?.includes(automaticBackupRetentionNote)) {
      continue;
    }
    if (summary.files.length > 0) {
      summary.files = [];
      changed = true;
    }
    if (!summary.notes.includes(expiredArchiveManifestPrunedNote)) {
      summary.notes = [...summary.notes, expiredArchiveManifestPrunedNote];
      changed = true;
    }
  }
  if (changed) await repo.saveCleanupSummaries(archiveDate, document, "backup-retention-expiry");
}

async function deleteExpiredArchives(
  repo: Repository,
  current: string,
  graceDays: number,
  dryRun: boolean,
): Promise<{ count: number; size: number }> {
  const root = repo.pathFor("cleanup_archive");
  if (!(await exists(root))) return { count: 0, size: 0 };
  let count = 0;
  let size = 0;
  for (const name of await readdir(root)) {
    if (!datePattern.test(name) || daysBetween(current, name) <= graceDays) continue;
    const partition = join(root, name);
    const path = join(partition, "backups");
    if (!(await exists(path))) continue;
    const candidateSize = await pathSize(path);
    count += 1;
    size += candidateSize;
    if (!dryRun) {
      await rm(path, { recursive: true, force: true });
      await compactExpiredAutomaticBackupSummaries(repo, name);
      await rmdir(partition).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
      });
    }
  }
  return { count, size };
}

async function saveRunState(repo: Repository, state: MaintenanceRunState): Promise<void> {
  await repo.replaceTextAtomic(maintenanceStatePath(repo.root), YAML.stringify({ last_run: state }));
}

export async function runBackupRetention(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone" | "activityRolloverHour" | "backupCleanup" | "layout">,
  input: BackupRetentionInput = {},
): Promise<BackupRetentionResult> {
  const now = input.now ?? new Date();
  const operationalDate = operationalDateInTimeZone(config.timezone, config.activityRolloverHour, now);
  const base = {
    operational_date: operationalDate,
    dry_run: input.dry_run ?? false,
    archived_count: 0,
    archived_size_bytes: 0,
    deleted_archive_count: 0,
    deleted_archive_size_bytes: 0,
    kept_backup_dates: [] as string[],
    archived_backup_dates: [] as string[],
    compacted_backup_file_count: 0,
    compacted_backup_files_sample: [] as string[],
  };
  if (!config.backupCleanup.enabled && !input.force) return { ...base, skipped: true, skip_reason: "disabled" };
  if (localTime(config.timezone, now) < config.backupCleanup.runAt && !input.force) {
    return { ...base, skipped: true, skip_reason: "before_schedule" };
  }

  return repo.withTransaction(async () => {
    const previous = await loadMaintenanceRunState(repo);
    if (previous?.operational_date === operationalDate && !input.force) {
      return { ...base, skipped: true, skip_reason: "already_ran" };
    }
    const backupRoot = repo.layoutPath("backups");
    const backupDates = (await exists(backupRoot))
      ? (await readdir(backupRoot)).filter((name) => datePattern.test(name) && name <= operationalDate)
      : [];
    const selected = selectBackupDates(backupDates, operationalDate, config.backupCleanup);
    const wholeDateCandidates = await Promise.all(
      selected.archive.map(async (date): Promise<CleanupCandidate> => {
        const path = repo.layoutPath("backups", date);
        return {
          path,
          relative_path: relative(repo.root, path),
          target: "backups",
          kind: "backup_dir",
          size_bytes: await pathSize(path),
        };
      }),
    );
    const compactCandidates = await backupFilesToCompact(
      repo,
      [...selected.keep],
      operationalDate,
      config.backupCleanup,
    );
    const candidates = [...wholeDateCandidates, ...compactCandidates];
    if (!base.dry_run && candidates.length > 0) {
      await archiveCandidates(repo, operationalDate, candidates);
      try {
        const archived = candidates.map((candidate) => ({
          ...candidate,
          path: candidate.archived_to as string,
          relative_path: relative(repo.root, candidate.archived_to as string),
          kind: candidate.kind === "backup_dir" ? ("archived_dir" as const) : ("archived_file" as const),
        }));
        const summary = await buildCleanupSummary(repo, {
          date: operationalDate,
          source: "archive",
          target: "backups",
          archive_date: operationalDate,
          candidates: archived,
          file_candidates: await expandArchiveManifestCandidates(repo, archived),
          max_content_details: automaticBackupContentDetailLimit,
          notes: [automaticBackupRetentionNote, "Use cleanup_restore_archive to restore archived backups."],
        });
        const document = await repo.loadCleanupSummaries(operationalDate);
        document.summaries.push(summary);
        await repo.saveCleanupSummaries(operationalDate, document, "backup-retention");
      } catch (error) {
        await rollbackArchivedCandidates(candidates);
        throw error;
      }
    }
    const expired = await deleteExpiredArchives(
      repo,
      operationalDate,
      config.backupCleanup.archiveGraceDays,
      base.dry_run,
    );
    const result: BackupRetentionResult = {
      ...base,
      skipped: false,
      archived_count: candidates.length,
      archived_size_bytes: candidates.reduce((sum, candidate) => sum + candidate.size_bytes, 0),
      deleted_archive_count: expired.count,
      deleted_archive_size_bytes: expired.size,
      kept_backup_dates: [...selected.keep].sort(),
      archived_backup_dates: selected.archive.sort(),
      compacted_backup_file_count: compactCandidates.length,
      compacted_backup_files_sample: compactCandidates.slice(0, 20).map((candidate) => candidate.relative_path),
    };
    if (!base.dry_run) {
      await saveRunState(repo, {
        operational_date: operationalDate,
        started_at: now.toISOString(),
        completed_at: new Date().toISOString(),
        archived_count: result.archived_count,
        archived_size_bytes: result.archived_size_bytes,
        deleted_archive_count: result.deleted_archive_count,
        deleted_archive_size_bytes: result.deleted_archive_size_bytes,
      });
    }
    return result;
  });
}

export function startBackupRetentionScheduler(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone" | "activityRolloverHour" | "backupCleanup" | "layout">,
  intervalMs = 15 * 60 * 1000,
): () => void {
  const run = () => {
    void runBackupRetention(repo, config).catch((error: unknown) => {
      console.error(`personal-context-mcp backup retention failed: ${(error as Error).message}`);
    });
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
