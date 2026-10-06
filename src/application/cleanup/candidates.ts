/**
 * Cleanup candidate discovery and shared filesystem path rules.
 *
 * This module owns deterministic candidate collection and path translation. It
 * does not define public workflows, transaction boundaries, or summary storage.
 *
 * クリーンアップ候補の検出と、共有ファイルシステムパス規則を提供します。
 *
 * このモジュールは決定的な候補収集とパス変換を担当します。公開ワークフロー、
 * トランザクション境界、要約の保存は担当しません。
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import type { Repository } from "#infra/repository/repository";
import type { CleanupCandidate, CleanupTarget } from "#app/cleanup/types";

/** Canonical output directories retained unless a caller supplies overrides. 呼び出し側が上書きしない限り保持される標準出力ディレクトリです。 */
export const defaultKeepOutputDirs = ["text", "markdown", "html", "morning"];

/** Validates and returns an archive partition date. アーカイブのパーティション日を検証して返します。 */
export function requireArchiveDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error("archive_date must be a valid YYYY-MM-DD date.");
  }
  return value;
}

/** Rejects path filters that could escape or ambiguously address the data root. データルート外を指す可能性や参照先が曖昧になる可能性のあるパスフィルターを拒否します。 */
export function validateRelativePathFilters(filters?: string[]): void {
  for (const path of filters ?? []) {
    if (
      !path ||
      path.includes("\0") ||
      path.includes("\\") ||
      isAbsolute(path) ||
      path.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new Error(`Unsafe relative path filter: ${path}`);
    }
  }
}

/** Returns whether a filesystem path exists, propagating non-missing errors. ファイルシステムパスが存在するかを返し、未存在以外のエラーはそのまま送出します。 */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function pathSize(path: string): Promise<number> {
  const info = await stat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of await readdir(path)) total += await pathSize(join(path, name));
  return total;
}

async function collectFilesByName(root: string, fileName: string): Promise<string[]> {
  const matches: string[] = [];
  if (!(await exists(root))) return matches;
  for (const name of await readdir(root)) {
    const path = join(root, name);
    const info = await stat(path);
    if (info.isDirectory()) {
      if (name !== "cleanup_archive") matches.push(...(await collectFilesByName(path, fileName)));
    } else if (name === fileName) {
      matches.push(path);
    }
  }
  return matches;
}

async function collectDirectoryEntries(
  repo: Repository,
  root: string,
  target: Exclude<CleanupTarget, "all">,
  fileKind: CleanupCandidate["kind"],
  dirKind: CleanupCandidate["kind"],
): Promise<CleanupCandidate[]> {
  if (!(await exists(root))) return [];
  return Promise.all(
    (await readdir(root)).map(async (name) => {
      const path = join(root, name);
      const info = await stat(path);
      return {
        path,
        relative_path: relative(repo.root, path),
        target,
        kind: info.isDirectory() ? dirKind : fileKind,
        size_bytes: await pathSize(path),
      };
    }),
  );
}

async function collectOutputCandidates(repo: Repository, keepOutputDirs: Set<string>): Promise<CleanupCandidate[]> {
  const root = repo.layoutPath("outputs");
  if (!(await exists(root))) return [];
  const candidates: CleanupCandidate[] = [];
  for (const name of await readdir(root)) {
    const path = join(root, name);
    const info = await stat(path);
    if (info.isDirectory() && keepOutputDirs.has(name)) continue;
    candidates.push({
      path,
      relative_path: relative(repo.root, path),
      target: "outputs",
      kind: info.isDirectory() ? "noncanonical_output_dir" : "root_file",
      size_bytes: await pathSize(path),
    });
  }
  return candidates;
}

async function collectSystemJunkCandidates(repo: Repository): Promise<CleanupCandidate[]> {
  return Promise.all(
    (await collectFilesByName(repo.root, ".DS_Store")).map(async (path) => ({
      path,
      relative_path: relative(repo.root, path),
      target: "system_junk" as const,
      kind: "system_junk" as const,
      size_bytes: await pathSize(path),
    })),
  );
}

/** Expands `all` into the concrete cleanup target order. `all` を具体的なクリーンアップ対象の順序へ展開します。 */
export function targetList(target: CleanupTarget): Array<Exclude<CleanupTarget, "all">> {
  return target === "all" ? ["outputs", "backups", "request_logs", "agent_update_assets", "system_junk"] : [target];
}

/** Resolves the archive root for a date and concrete target. 日付と具体的な対象に対応するアーカイブルートを解決します。 */
export function archiveRootFor(repo: Repository, archiveDate: string, target: Exclude<CleanupTarget, "all">): string {
  return repo.pathFor("cleanup_archive", archiveDate, target);
}

/** Collects current top-level candidates for one concrete target. 1つの具体的な対象について、現在の最上位候補を収集します。 */
export async function collectTargetCandidates(
  repo: Repository,
  target: Exclude<CleanupTarget, "all">,
  keepOutputDirs: Set<string>,
): Promise<CleanupCandidate[]> {
  if (target === "outputs") return collectOutputCandidates(repo, keepOutputDirs);
  if (target === "backups")
    return collectDirectoryEntries(repo, repo.layoutPath("backups"), target, "backup_file", "backup_dir");
  if (target === "request_logs")
    return collectDirectoryEntries(repo, repo.layoutPath("requestLogs"), target, "request_log", "request_log");
  if (target === "agent_update_assets") {
    return collectDirectoryEntries(
      repo,
      repo.layoutPath("agentUpdates", "pdf"),
      target,
      "agent_update_asset_file",
      "agent_update_asset_dir",
    );
  }
  return collectSystemJunkCandidates(repo);
}

/** Collects top-level candidates from one dated archive target. 日付で区切られた1つのアーカイブ対象から最上位候補を収集します。 */
export function collectArchiveCandidates(
  repo: Repository,
  archiveDate: string,
  target: Exclude<CleanupTarget, "all">,
): Promise<CleanupCandidate[]> {
  return collectDirectoryEntries(
    repo,
    archiveRootFor(repo, archiveDate, target),
    target,
    "archived_file",
    "archived_dir",
  );
}

/** Resolves the relative location used inside a target archive. 対象アーカイブ内で使用する相対位置を解決します。 */
export function archiveRelativePath(candidate: CleanupCandidate): string {
  const parts = candidate.relative_path.split("/");
  if (parts[0] === "outputs" || parts[0] === "backups" || parts[0] === "request_logs") return parts.slice(1).join("/");
  if (parts[0] === "agent_updates" && parts[1] === "pdf") return parts.slice(1).join("/");
  return candidate.relative_path;
}

/** Returns a collision-free destination without modifying the filesystem. ファイルシステムを変更せず、衝突しない移動先を返します。 */
export async function uniqueDestination(path: string): Promise<string> {
  if (!(await exists(path))) return path;
  return join(dirname(path), `${basename(path)}.${randomUUID()}`);
}

/** Maps an archived path back to its live data destination. アーカイブ済みパスを稼働中データの復元先へ対応付けます。 */
export function restoreDestinationFor(
  repo: Repository,
  target: Exclude<CleanupTarget, "all">,
  archivedPath: string,
): string {
  const filePath = archivedPath.split("/").slice(3).join("/");
  if (target === "outputs") return repo.layoutPath("outputs", filePath);
  if (target === "backups") return repo.layoutPath("backups", filePath);
  if (target === "request_logs") return repo.layoutPath("requestLogs", filePath);
  if (target === "agent_update_assets") return repo.layoutPath("agentUpdates", filePath);
  return repo.pathFor(filePath);
}

function targetRelativePath(repo: Repository, candidate: CleanupCandidate): string {
  const filePath = candidate.relative_path.split("/").slice(3).join("/");
  if (candidate.target === "outputs") return `${repo.layoutName("outputs")}/${filePath}`;
  if (candidate.target === "backups") return `${repo.layoutName("backups")}/${filePath}`;
  if (candidate.target === "request_logs") return `${repo.layoutName("requestLogs")}/${filePath}`;
  if (candidate.target === "agent_update_assets") return `${repo.layoutName("agentUpdates")}/${filePath}`;
  return filePath;
}

/** Tests an archive candidate against accepted archive, content, or live paths. アーカイブ候補が許可されたアーカイブパス、内容パス、または稼働中パスに一致するかを判定します。 */
export function matchesRelativePathFilter(repo: Repository, candidate: CleanupCandidate, filters?: string[]): boolean {
  if (!filters?.length) return true;
  const accepted = new Set(filters);
  const contentRelative = candidate.relative_path.split("/").slice(3).join("/");
  return (
    accepted.has(candidate.relative_path) ||
    accepted.has(contentRelative) ||
    accepted.has(targetRelativePath(repo, candidate))
  );
}

/** Expands top-level archived directories into a complete recursive manifest. 最上位のアーカイブ済みディレクトリを完全な再帰マニフェストへ展開します。 */
export async function expandArchiveManifestCandidates(
  repo: Repository,
  candidates: CleanupCandidate[],
): Promise<CleanupCandidate[]> {
  const manifest: CleanupCandidate[] = [];
  const visit = async (candidate: CleanupCandidate): Promise<void> => {
    manifest.push(candidate);
    const info = await stat(candidate.path);
    if (!info.isDirectory()) return;
    for (const name of (await readdir(candidate.path)).sort()) {
      const path = join(candidate.path, name);
      const childInfo = await stat(path);
      await visit({
        path,
        relative_path: relative(repo.root, path),
        target: candidate.target,
        kind: childInfo.isDirectory() ? "archived_dir" : "archived_file",
        size_bytes: childInfo.isDirectory() ? await pathSize(path) : childInfo.size,
      });
    }
  };
  for (const candidate of candidates) await visit(candidate);
  return manifest;
}

/** Moves archived candidates back to their original paths after a failed save. 保存失敗後にアーカイブ済み候補を元のパスへ戻します。 */
export async function rollbackArchivedCandidates(candidates: CleanupCandidate[]): Promise<void> {
  const errors: Error[] = [];
  for (const candidate of [...candidates].reverse()) {
    if (!candidate.archived_to) continue;
    try {
      if (await exists(candidate.path))
        throw new Error(`Cannot roll back because the original path now exists: ${candidate.path}`);
      await mkdir(dirname(candidate.path), { recursive: true });
      await rename(candidate.archived_to, candidate.path);
    } catch (error) {
      errors.push(error as Error);
    }
  }
  if (errors.length > 0)
    throw new AggregateError(errors, "Archive summary persistence failed and rollback was incomplete.");
}
