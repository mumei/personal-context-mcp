/**
 * Public data contracts for cleanup application operations.
 *
 * This module defines inputs and results only. It does not inspect, move,
 * restore, summarize, or delete files.
 *
 * クリーンアップアプリケーション操作の公開データ契約を定義します。
 *
 * このモジュールは入力と結果のみを定義します。ファイルの検査、移動、復元、
 * 要約、削除は行いません。
 *
 * @packageDocumentation
 */

import type { CleanupSummary, SaveResult } from "#shared/types";

/** A filesystem effect supported by the low-level cleanup operation. 低レベルのクリーンアップ操作が対応するファイルシステムへの作用です。 */
export type CleanupAction = "preview" | "archive" | "delete";

/** A cleanup data category, or all supported categories. クリーンアップ対象のデータ分類、または対応する全分類です。 */
export type CleanupTarget = "outputs" | "backups" | "request_logs" | "agent_update_assets" | "system_junk" | "all";

/** Options for previewing, archiving, or deleting cleanup candidates. クリーンアップ候補のプレビュー、アーカイブ、削除に使用するオプションです。 */
export interface CleanupDataRootInput {
  /** Effect to perform; defaults to `preview`. 実行する作用で、既定値は `preview` です。 */
  action?: CleanupAction;
  /** Data category to process; defaults to `outputs`. 処理するデータ分類で、既定値は `outputs` です。 */
  target?: CleanupTarget;
  /** Output directory names excluded from candidate collection. 候補収集から除外する出力ディレクトリ名です。 */
  keep_output_dirs?: string[];
  /** Archive partition date in `YYYY-MM-DD` format. `YYYY-MM-DD` 形式のアーカイブパーティション日です。 */
  archive_date?: string;
}

/** A file or directory selected by cleanup candidate discovery. クリーンアップ候補の検出によって選択されたファイルまたはディレクトリです。 */
export interface CleanupCandidate {
  /** Absolute filesystem path. ファイルシステム上の絶対パスです。 */
  path: string;
  /** Path relative to the repository data root. リポジトリのデータルートを基準とした相対パスです。 */
  relative_path: string;
  /** Concrete cleanup data category. 具体的なクリーンアップ対象データの分類です。 */
  target: Exclude<CleanupTarget, "all">;
  /** Discovery classification used in summaries and manifests. 要約とマニフェストで使用する検出時の分類です。 */
  kind:
    | "root_file"
    | "noncanonical_output_dir"
    | "backup_dir"
    | "backup_file"
    | "request_log"
    | "agent_update_asset_dir"
    | "agent_update_asset_file"
    | "system_junk"
    | "archived_file"
    | "archived_dir";
  /** Recursive byte size at discovery time. 検出時点で再帰的に計算したバイトサイズです。 */
  size_bytes: number;
  /** Absolute destination populated after an archive move. アーカイブ移動後に設定される移動先の絶対パスです。 */
  archived_to?: string;
  /** Whether the candidate was deleted by the operation. 操作によって候補が削除されたかを示します。 */
  deleted?: boolean;
}

/** Result of a low-level cleanup operation. 低レベルのクリーンアップ操作の結果です。 */
export interface CleanupDataRootResult {
  /** Effect requested by the caller. 呼び出し側が要求した作用です。 */
  action: CleanupAction;
  /** Candidates discovered and optionally processed. 検出され、必要に応じて処理された候補です。 */
  candidates: CleanupCandidate[];
  /** Number of top-level candidates. 最上位候補の件数です。 */
  total_count: number;
  /** Recursive bytes represented by all top-level candidates. すべての最上位候補が表す再帰的な合計バイト数です。 */
  total_size_bytes: number;
  /** Archive roots involved in archive and delete operations. アーカイブ操作と削除操作に関係するアーカイブルートです。 */
  archive_roots?: string[];
}

/** Options for restoring files from a dated cleanup archive. 日付で区切られたクリーンアップアーカイブからファイルを復元するためのオプションです。 */
export interface RestoreCleanupArchiveInput {
  /** Archive partition date in `YYYY-MM-DD` format. `YYYY-MM-DD` 形式のアーカイブパーティション日です。 */
  archive_date?: string;
  /** Archived data category to restore. 復元するアーカイブ済みデータの分類です。 */
  target?: CleanupTarget;
  /** Whether to report intended restores without moving files; defaults to `true`. ファイルを移動せず復元予定だけを報告するかを示し、既定値は `true` です。 */
  dry_run?: boolean;
  /** Optional safe relative paths that limit the restore. 復元対象を限定する、省略可能で安全な相対パスです。 */
  relative_paths?: string[];
}

/** Result of restoring or previewing a cleanup archive. クリーンアップアーカイブを復元またはプレビューした結果です。 */
export interface RestoreCleanupArchiveResult {
  /** Archive partition date used by the operation. 操作で使用したアーカイブパーティション日です。 */
  archive_date: string;
  /** Requested cleanup category. 要求されたクリーンアップ分類です。 */
  target: CleanupTarget;
  /** Whether no files were moved. ファイルが移動されなかったかを示します。 */
  dry_run: boolean;
  /** Matching candidates with their restore destinations. 一致した候補とそれぞれの復元先です。 */
  candidates: Array<CleanupCandidate & { restore_to: string; restored?: boolean }>;
  /** Number of matching top-level archive entries. 一致した最上位アーカイブ項目の件数です。 */
  total_count: number;
  /** Recursive bytes represented by matching entries. 一致した項目が表す再帰的な合計バイト数です。 */
  total_size_bytes: number;
}

/** Options for generating a cleanup candidate summary. クリーンアップ候補の要約を生成するためのオプションです。 */
export interface SummarizeCleanupCandidatesInput {
  /** Data category to summarize. 要約するデータ分類です。 */
  target?: CleanupTarget;
  /** Whether candidates come from live data or a dated archive. 候補が稼働中データと日付付きアーカイブのどちらに由来するかを示します。 */
  source?: "current" | "archive";
  /** Archive partition date used when `source` is `archive`. `source` が `archive` の場合に使用するアーカイブパーティション日です。 */
  archive_date?: string;
  /** Whether to persist the summary; defaults to `true`. 要約を保存するかを示し、既定値は `true` です。 */
  write?: boolean;
  /** Maximum candidate bodies included in the summary. 要約に含める候補内容の最大件数です。 */
  max_files?: number;
  /** Output directory names excluded from current candidate collection. 現在の候補収集から除外する出力ディレクトリ名です。 */
  keep_output_dirs?: string[];
}

/** Generated cleanup summary and optional persistence metadata. 生成されたクリーンアップ要約と、省略可能な保存メタデータです。 */
export interface SummarizeCleanupCandidatesResult {
  /** Date partition containing the summary. 要約を格納する日付パーティションです。 */
  date: string;
  /** Generated cleanup summary. 生成されたクリーンアップ要約です。 */
  summary: CleanupSummary;
  /** Persistence result when writing was requested. 保存が要求された場合の保存結果です。 */
  save?: SaveResult;
}

/** Options for the archive-and-summarize workflow. アーカイブと要約を行うワークフローのオプションです。 */
export interface ArchiveCleanupInput {
  /** Data category to archive. アーカイブするデータ分類です。 */
  target?: CleanupTarget;
  /** Archive partition date in `YYYY-MM-DD` format. `YYYY-MM-DD` 形式のアーカイブパーティション日です。 */
  archive_date?: string;
  /** Output directory names excluded from candidate collection. 候補収集から除外する出力ディレクトリ名です。 */
  keep_output_dirs?: string[];
  /** Whether to preview without moving or writing; defaults to `true`. 移動や書き込みを行わずプレビューするかを示し、既定値は `true` です。 */
  dry_run?: boolean;
}

/** Result of the archive-and-summarize workflow. アーカイブと要約を行うワークフローの結果です。 */
export interface ArchiveCleanupResult {
  /** Archive partition date used by the operation. 操作で使用したアーカイブパーティション日です。 */
  archive_date: string;
  /** Date partition containing the summary. 要約を格納する日付パーティションです。 */
  summary_date: string;
  /** Requested cleanup category. 要求されたクリーンアップ分類です。 */
  target: CleanupTarget;
  /** Whether no files or summaries were written. ファイルも要約も書き込まれなかったかを示します。 */
  dry_run: boolean;
  /** Candidate discovery and move result. 候補の検出と移動の結果です。 */
  archive: CleanupDataRootResult;
  /** Preview or persisted cleanup summary. プレビュー用または保存済みのクリーンアップ要約です。 */
  summary: CleanupSummary;
  /** Summary persistence result for a non-dry-run archive. ドライランではないアーカイブ処理における要約の保存結果です。 */
  save?: SaveResult;
  /** Human-readable operation outcome. 人が読める形式の操作結果です。 */
  message: string;
}

/** Options for permanently deleting entries from a cleanup archive. クリーンアップアーカイブから項目を完全に削除するためのオプションです。 */
export interface FinalizeCleanupArchiveInput {
  /** Archived data category to delete. 削除するアーカイブ済みデータの分類です。 */
  target?: CleanupTarget;
  /** Archive partition date in `YYYY-MM-DD` format. `YYYY-MM-DD` 形式のアーカイブパーティション日です。 */
  archive_date?: string;
  /** Optional safe relative paths that limit deletion. 削除対象を限定する、省略可能で安全な相対パスです。 */
  relative_paths?: string[];
  /** Whether to preview without deleting; defaults to `true`. 削除せずプレビューするかを示し、既定値は `true` です。 */
  dry_run?: boolean;
}

/** Result of permanently deleting or previewing archived entries. アーカイブ項目を完全に削除またはプレビューした結果です。 */
export interface FinalizeCleanupArchiveResult {
  /** Archive partition date used by the operation. 操作で使用したアーカイブパーティション日です。 */
  archive_date: string;
  /** Requested cleanup category. 要求されたクリーンアップ分類です。 */
  target: CleanupTarget;
  /** Whether no files were deleted. ファイルが削除されなかったかを示します。 */
  dry_run: boolean;
  /** Matching archived entries and deletion status. 一致したアーカイブ項目と削除状態です。 */
  deleted: CleanupDataRootResult;
  /** Human-readable operation outcome. 人が読める形式の操作結果です。 */
  message: string;
}
