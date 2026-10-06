/**
 * Provides import directory capabilities for the application layer.
 * Responsibility: This module owns the import directory behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * application層のimport directory機能を提供します。
 * 責務: このモジュールは、ここで宣言するimport directoryの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import type { Repository } from "#infra/repository/repository";
import type { LayoutConfig, Task, TasksDocument } from "#shared/types";

/**
 * Defines the public `ImportTaskDirectoryInput` data contract exposed by this module.
 *
 * このモジュールが公開する`ImportTaskDirectoryInput`データ契約を定義します。
 */
export interface ImportTaskDirectoryInput {
  source_root: string;
  source_layout: Partial<LayoutConfig>;
  extra_paths?: string[];
  overwrite?: boolean;
  dry_run?: boolean;
}

/**
 * Defines the public `ImportTaskDirectoryResult` data contract exposed by this module.
 *
 * このモジュールが公開する`ImportTaskDirectoryResult`データ契約を定義します。
 */
export interface ImportTaskDirectoryResult {
  dry_run: boolean;
  source_root: string;
  target_root: string;
  copied: Array<{ from: string; to: string; kind: "file" | "directory" }>;
  skipped: Array<{ from: string; to: string; reason: string }>;
  transformed: string[];
  warnings: string[];
}

const importKeys: Array<keyof LayoutConfig> = [
  "tasks",
  "contexts",
  "inputs",
  "activities",
  "reports",
  "outputs",
  "agentUpdates",
  "taskMemory",
  "reportSummaries",
  "memorySummaries",
  "cleanupSummaries",
  "globalMemory",
  "requestLogs",
  "backups",
];

function safeSourcePath(root: string, path: string): string {
  const fullPath = resolve(root, path);
  const rel = relative(root, fullPath);
  if ((rel === "" && path.length === 0) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`Unsafe import source path: ${path}`);
  }
  return fullPath;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function copyPath(
  source: string,
  target: string,
  overwrite: boolean,
  dryRun: boolean,
): Promise<"file" | "directory" | "skipped"> {
  const sourceStat = await stat(source);
  if (!overwrite && (await exists(target))) {
    return "skipped";
  }
  if (dryRun) return sourceStat.isDirectory() ? "directory" : "file";
  await mkdir(dirname(target), { recursive: true });
  if (sourceStat.isDirectory()) {
    await cp(source, target, { recursive: true, force: overwrite, errorOnExist: !overwrite });
    return "directory";
  }
  await cp(source, target, { force: overwrite, errorOnExist: !overwrite });
  return "file";
}

async function rewriteTaskContexts(
  repo: Repository,
  tasksPath: string,
  sourceContexts: string,
  targetContexts: string,
): Promise<boolean> {
  if (sourceContexts === targetContexts || !(await exists(tasksPath))) {
    return false;
  }
  const text = await readFile(tasksPath, "utf8");
  const doc = YAML.parse(text) as TasksDocument | null;
  if (!doc?.tasks) {
    return false;
  }
  let changed = false;
  const prefix = `${sourceContexts.replace(/\/$/, "")}/`;
  const targetPrefix = `${targetContexts.replace(/\/$/, "")}/`;
  const tasks = doc.tasks.map((task): Task => {
    if (typeof task.context !== "string" || !task.context.startsWith(prefix)) {
      return task;
    }
    changed = true;
    return {
      ...task,
      context: `${targetPrefix}${task.context.slice(prefix.length)}`,
    };
  });
  if (!changed) {
    return false;
  }
  await repo.replaceTextAtomic(tasksPath, YAML.stringify({ ...doc, tasks }));
  return true;
}

/**
 * Performs the public `importTaskDirectory` operation provided by this module.
 *
 * このモジュールが提供する公開操作`importTaskDirectory`を実行します。
 */
export async function importTaskDirectory(
  repo: Repository,
  input: ImportTaskDirectoryInput,
): Promise<ImportTaskDirectoryResult> {
  return repo.withTransaction(async () => {
    const sourceRoot = resolve(input.source_root);
    const overwrite = input.overwrite ?? false;
    const dryRun = input.dry_run ?? true;
    const copied: ImportTaskDirectoryResult["copied"] = [];
    const skipped: ImportTaskDirectoryResult["skipped"] = [];
    const transformed: string[] = [];
    const warnings: string[] = [];
    const rollbackRoot = dryRun ? undefined : await mkdtemp(join(tmpdir(), "task-mcp-import-rollback-"));
    const snapshots: Array<{ target: string; backup?: string }> = [];
    const snapshotTarget = async (target: string) => {
      if (!rollbackRoot || snapshots.some((item) => item.target === target)) return;
      if (await exists(target)) {
        const backup = join(rollbackRoot, String(snapshots.length));
        await cp(target, backup, { recursive: true });
        snapshots.push({ target, backup });
      } else {
        snapshots.push({ target });
      }
    };

    try {
      for (const key of importKeys) {
        const sourceLayoutPath = input.source_layout[key];
        if (!sourceLayoutPath) {
          continue;
        }
        const sourcePath = safeSourcePath(sourceRoot, sourceLayoutPath);
        if (!(await exists(sourcePath))) {
          skipped.push({ from: sourcePath, to: repo.layoutPath(key), reason: "source_not_found" });
          continue;
        }
        const targetPath = repo.layoutPath(key);
        await snapshotTarget(targetPath);
        const kind = await copyPath(sourcePath, targetPath, overwrite, dryRun);
        if (kind === "skipped") {
          skipped.push({ from: sourcePath, to: targetPath, reason: "target_exists" });
          continue;
        }
        copied.push({ from: sourcePath, to: targetPath, kind });
      }

      for (const extraPath of input.extra_paths ?? []) {
        const sourcePath = safeSourcePath(sourceRoot, extraPath);
        if (!(await exists(sourcePath))) {
          skipped.push({ from: sourcePath, to: repo.pathFor(extraPath), reason: "source_not_found" });
          continue;
        }
        const targetPath = repo.pathFor(extraPath);
        await snapshotTarget(targetPath);
        const kind = await copyPath(sourcePath, targetPath, overwrite, dryRun);
        if (kind === "skipped") {
          skipped.push({ from: sourcePath, to: targetPath, reason: "target_exists" });
          continue;
        }
        copied.push({ from: sourcePath, to: targetPath, kind });
      }

      const tasksPath = repo.layoutPath("tasks");
      const sourceContexts = input.source_layout.contexts;
      if (
        !dryRun &&
        sourceContexts &&
        (await rewriteTaskContexts(repo, tasksPath, sourceContexts, repo.layoutName("contexts")))
      ) {
        transformed.push(`${basename(tasksPath)} context paths: ${sourceContexts} -> ${repo.layoutName("contexts")}`);
      }

      const targetEntries = await readdir(repo.root).catch(() => []);
      if (targetEntries.length === 0) {
        warnings.push("No files were imported into the target data root.");
      }

      const result = {
        dry_run: dryRun,
        source_root: sourceRoot,
        target_root: repo.root,
        copied,
        skipped,
        transformed,
        warnings,
      };
      if (rollbackRoot) await rm(rollbackRoot, { recursive: true, force: true });
      return result;
    } catch (error) {
      for (const snapshot of [...snapshots].reverse()) {
        await rm(snapshot.target, { recursive: true, force: true });
        if (snapshot.backup) {
          await mkdir(dirname(snapshot.target), { recursive: true });
          await cp(snapshot.backup, snapshot.target, { recursive: true });
        }
      }
      if (rollbackRoot) await rm(rollbackRoot, { recursive: true, force: true });
      throw error;
    }
  });
}
