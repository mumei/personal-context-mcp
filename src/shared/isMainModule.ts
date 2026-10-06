/**
 * Detects direct CLI execution, resolving npm bin symlinks without starting any server.
 * npm binのシンボリックリンクを解決してCLIの直接実行を判定し、サーバーは起動しません。
 * @packageDocumentation
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Compares the module URL with the canonical executable path; missing paths are not entrypoints.
 * モジュールURLと正規化した実行パスを比較します。存在しないパスは入口として扱いません。
 */
export function isMainModule(moduleUrl: string, executable = process.argv[1]): boolean {
  if (!executable) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(executable)).href;
  } catch {
    return false;
  }
}
