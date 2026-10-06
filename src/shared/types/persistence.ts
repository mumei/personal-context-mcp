/**
 * Defines shared persistence and audit contracts.
 * Responsibility: This module owns parsed frontmatter, save results, and request log entry shapes.
 * Non-responsibility: This module does not parse files, perform writes, create backups, or emit audit logs.
 *
 * 共通の永続化および監査契約を定義します。
 * 責務: このモジュールは、解析済みfrontmatter、保存結果、リクエストログ項目の形式を担当します。
 * 非責務: このモジュールは、ファイル解析、書き込み、バックアップ作成、監査ログ出力を担当しません。
 *
 * @packageDocumentation
 */

/**
 * Defines parsed frontmatter data and its associated document body.
 *
 * 解析済みfrontmatterデータと対応する文書本文を定義します。
 */
export interface FrontmatterDocument {
  data: Record<string, unknown>;
  body: string;
}

/**
 * Defines the observable result of a persistence operation.
 *
 * 永続化処理で観測可能な結果を定義します。
 */
export interface SaveResult {
  changed: boolean;
  path: string;
  backupPath?: string;
}

/**
 * Defines one structured request audit log entry.
 *
 * 構造化された1件のリクエスト監査ログ項目を定義します。
 */
export interface RequestLogEntry {
  timestamp: string;
  tool: string;
  status: "ok" | "error";
  duration_ms: number;
  request_id?: string | number;
  client_session_id?: string;
  arguments_summary: Record<string, unknown>;
  result_summary?: Record<string, unknown>;
  error?: {
    name?: string;
    message: string;
    fallback_reason_codes?: unknown[];
  };
}
