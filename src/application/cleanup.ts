/**
 * Cleanup application API compatibility facade.
 *
 * This module preserves the original cleanup import path. It owns no cleanup
 * behavior; implementations live in the single-responsibility modules under
 * `application/cleanup`.
 *
 * クリーンアップアプリケーション API の互換ファサードです。
 *
 * このモジュールは従来のクリーンアップ用インポートパスを維持します。
 * クリーンアップ処理自体は持たず、実装は `application/cleanup` 配下の
 * 単一責務モジュールに配置します。
 *
 * @packageDocumentation
 */

export { archiveCleanup, cleanupDataRoot } from "#app/cleanup/archive";
export { finalizeCleanupArchive } from "#app/cleanup/finalize";
export { restoreCleanupArchive } from "#app/cleanup/restore";
export { runBackupRetention, startBackupRetentionScheduler } from "#app/cleanup/retention";
export { summarizeCleanupCandidates } from "#app/cleanup/summarization";
export type {
  ArchiveCleanupInput,
  ArchiveCleanupResult,
  CleanupAction,
  CleanupCandidate,
  CleanupDataRootInput,
  CleanupDataRootResult,
  CleanupTarget,
  FinalizeCleanupArchiveInput,
  FinalizeCleanupArchiveResult,
  RestoreCleanupArchiveInput,
  RestoreCleanupArchiveResult,
  SummarizeCleanupCandidatesInput,
  SummarizeCleanupCandidatesResult,
} from "#app/cleanup/types";
export type { BackupRetentionInput, BackupRetentionResult } from "#app/cleanup/retention";
