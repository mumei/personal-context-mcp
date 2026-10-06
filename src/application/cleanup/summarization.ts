/**
 * Cleanup candidate content summarization and summary persistence.
 *
 * This module owns summary construction for both previews and archives. It does
 * not move, restore, or permanently delete cleanup candidates.
 *
 * クリーンアップ候補の内容要約と、要約の保存を提供します。
 *
 * このモジュールはプレビューとアーカイブの両方に対する要約構築を担当します。
 * クリーンアップ候補の移動、復元、完全削除は担当しません。
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { nowIso, todayInTimeZone } from "#shared/date";
import type { Repository } from "#infra/repository/repository";
import type { CleanupSummary, Task, TaskMcpConfig } from "#shared/types";
import {
  collectArchiveCandidates,
  collectTargetCandidates,
  defaultKeepOutputDirs,
  requireArchiveDate,
  restoreDestinationFor,
  targetList,
} from "#app/cleanup/candidates";
import type {
  CleanupCandidate,
  CleanupTarget,
  SummarizeCleanupCandidatesInput,
  SummarizeCleanupCandidatesResult,
} from "#app/cleanup/types";

const maxSummaryBytes = 256 * 1024;
const maxPreviewChars = 1200;
/** Full paths remain restorable, but automatic backup retention only retains content detail for this many entries. */
export const automaticBackupContentDetailLimit = 200;

function compactText(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeText(text: string, path: string): string[] {
  const compact = compactText(text);
  if (!compact) return ["Text file has no readable content after normalization."];
  const chunks = compact
    .split(/(?<=[。.!?])\s+|[\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return (chunks.length > 0 ? chunks : [compact]).slice(0, 3).map((item, index) => {
    const body = item.length > 180 ? `${item.slice(0, 177)}...` : item;
    return index === 0 ? `${path}: ${body}` : body;
  });
}

async function summarizeCandidateContent(
  candidate: CleanupCandidate,
): Promise<Pick<CleanupSummary["files"][number], "content_kind" | "summary" | "content_preview">> {
  try {
    const info = await stat(candidate.path);
    if (info.isDirectory()) {
      const names = await readdir(candidate.path);
      return {
        content_kind: "directory",
        summary: [
          names.length > 0
            ? `Directory containing ${names.length} immediate item(s); descendant files are listed separately in the archive manifest.`
            : "Empty directory.",
        ],
      };
    }
    if (info.size > maxSummaryBytes) {
      return {
        content_kind: "binary_or_large",
        summary: [`Skipped body summary because file is large (${info.size} bytes).`],
      };
    }
    const buffer = await readFile(candidate.path);
    if (buffer.includes(0)) {
      return { content_kind: "binary_or_large", summary: ["Skipped body summary because file appears to be binary."] };
    }
    const text = buffer.toString("utf8");
    return {
      content_kind: "text",
      summary: summarizeText(text, candidate.relative_path),
      content_preview: compactText(text).slice(0, maxPreviewChars),
    };
  } catch (error) {
    return { content_kind: "unreadable", summary: [`Could not summarize content: ${(error as Error).message}`] };
  }
}

function inferTaskIds(candidate: CleanupCandidate, tasks: Task[]): string[] | undefined {
  const text = candidate.relative_path.toLowerCase();
  const matches = tasks.map((task) => task.id).filter((taskId) => text.includes(taskId.toLowerCase()));
  return matches.length > 0 ? matches : undefined;
}

function groupCandidates(candidates: CleanupCandidate[]): CleanupSummary["groups"] {
  const groups = new Map<string, { target: string; kind: string; count: number; size_bytes: number }>();
  for (const candidate of candidates) {
    const key = `${candidate.target}\n${candidate.kind}`;
    const group = groups.get(key) ?? { target: candidate.target, kind: candidate.kind, count: 0, size_bytes: 0 };
    group.count += 1;
    group.size_bytes += candidate.size_bytes;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.size_bytes - left.size_bytes);
}

/** Parameters for constructing a summary from already discovered candidates. 検出済み候補から要約を構築するためのパラメーターです。 */
export interface BuildCleanupSummaryInput {
  /** Summary date and identifier prefix. 要約の日付と識別子の接頭辞です。 */
  date: string;
  /** Whether files represent live or archived data. ファイルが稼働中データとアーカイブ済みデータのどちらを表すかを示します。 */
  source: "current" | "archive";
  /** Requested target represented by the summary. 要約が表す要求対象です。 */
  target: CleanupTarget;
  /** Archive partition date for archived summaries. アーカイブ要約に使用するアーカイブのパーティション日です。 */
  archive_date?: string;
  /** Top-level candidates used for counts, sizes, and groups. 件数、サイズ、グループの算出に使用する最上位候補です。 */
  candidates: CleanupCandidate[];
  /** Candidates represented in the file manifest; defaults to `candidates`. ファイルマニフェストに掲載する候補で、既定値は `candidates` です。 */
  file_candidates?: CleanupCandidate[];
  /** Maximum manifest entries; omitted for an untruncated manifest. マニフェストの最大項目数で、省略すると切り詰めません。 */
  max_files?: number;
  /** Maximum entries that retain a content preview and prose summary; every manifest path remains listed. */
  max_content_details?: number;
  /** Explanatory notes attached to the summary. 要約に付加する説明注記です。 */
  notes: string[];
}

/** Builds one cleanup summary without moving files or persisting the result. ファイルを移動せず、結果も保存せずに1件のクリーンアップ要約を構築します。 */
export async function buildCleanupSummary(repo: Repository, input: BuildCleanupSummaryInput): Promise<CleanupSummary> {
  const tasks = (await repo.loadTasks()).tasks;
  const sourceCandidates = input.file_candidates ?? input.candidates;
  const fileCandidates = input.max_files === undefined ? sourceCandidates : sourceCandidates.slice(0, input.max_files);
  const contentDetailLimit = Math.max(
    0,
    Math.min(input.max_content_details ?? fileCandidates.length, fileCandidates.length),
  );
  const contentDetails = await Promise.all(
    fileCandidates.slice(0, contentDetailLimit).map((candidate) => summarizeCandidateContent(candidate)),
  );
  const files = fileCandidates.map((candidate, index) => ({
    relative_path: candidate.relative_path,
    target: candidate.target,
    kind: candidate.kind,
    size_bytes: candidate.size_bytes,
    archived_to: candidate.archived_to,
    restore_to:
      input.source === "archive" ? restoreDestinationFor(repo, candidate.target, candidate.relative_path) : undefined,
    inferred_task_ids: inferTaskIds(candidate, tasks),
    ...(contentDetails[index] ?? {}),
  }));
  const inferredTaskIds = [...new Set(files.flatMap((file) => file.inferred_task_ids ?? []))].sort();
  return {
    summary_id: `${input.date}-${randomUUID()}`,
    created_at: nowIso(),
    source: input.source,
    target: input.target,
    archive_date: input.source === "archive" ? input.archive_date : undefined,
    candidate_count: input.candidates.length,
    total_size_bytes: input.candidates.reduce((sum, candidate) => sum + candidate.size_bytes, 0),
    groups: groupCandidates(input.candidates),
    inferred_task_ids: inferredTaskIds.length > 0 ? inferredTaskIds : undefined,
    files,
    notes:
      contentDetailLimit < fileCandidates.length
        ? [
            ...input.notes,
            `Content previews and summaries were retained for the first ${contentDetailLimit} of ${fileCandidates.length} manifest entries; every archived path remains listed and restorable.`,
          ]
        : input.notes,
  };
}

async function summarizeCleanupCandidatesImpl(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone" | "layout">,
  input: SummarizeCleanupCandidatesInput,
): Promise<SummarizeCleanupCandidatesResult> {
  const date = todayInTimeZone(config.timezone);
  const target = input.target ?? "all";
  const source = input.source ?? "current";
  const archiveDate = requireArchiveDate(input.archive_date ?? date);
  const keepOutputDirs = new Set(input.keep_output_dirs ?? defaultKeepOutputDirs);
  const candidates = (
    await Promise.all(
      targetList(target).map((item) =>
        source === "archive"
          ? collectArchiveCandidates(repo, archiveDate, item)
          : collectTargetCandidates(repo, item, keepOutputDirs),
      ),
    )
  ).flat();
  const summary = await buildCleanupSummary(repo, {
    date,
    source,
    target,
    archive_date: archiveDate,
    candidates,
    max_files: input.max_files ?? 200,
    notes: [
      source === "archive"
        ? "Summary was generated from cleanup_archive entries."
        : "Summary was generated from current cleanup candidates before archive/delete.",
      "Full file bodies are not embedded; restore archived files when detailed inspection is needed.",
    ],
  });
  if (input.write ?? true) {
    const doc = await repo.loadCleanupSummaries(date);
    doc.summaries.push(summary);
    const save = await repo.saveCleanupSummaries(date, doc, "summarize-cleanup-candidates");
    return { date, summary, save };
  }
  return { date, summary };
}

/** Summarizes current or archived cleanup candidates and optionally persists it. 現在またはアーカイブ済みのクリーンアップ候補を要約し、必要に応じて保存します。 */
export async function summarizeCleanupCandidates(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone" | "layout">,
  input: SummarizeCleanupCandidatesInput = {},
): Promise<SummarizeCleanupCandidatesResult> {
  if (input.write ?? true) return repo.withTransaction(() => summarizeCleanupCandidatesImpl(repo, config, input));
  return summarizeCleanupCandidatesImpl(repo, config, input);
}
