/**
 * Defines shared search-result contracts.
 * Responsibility: This module owns the normalized shape of a ranked search match.
 * Non-responsibility: This module does not own indexing, query parsing, ranking, or result presentation.
 *
 * 共通の検索結果契約を定義します。
 * 責務: このモジュールは、順位付けされた検索一致結果の正規化形式を担当します。
 * 非責務: このモジュールは、索引作成、クエリ解析、順位付け、結果表示を担当しません。
 *
 * @packageDocumentation
 */

/**
 * Defines one ranked match returned by shared search operations.
 *
 * 共通検索処理が返す順位付けされた1件の一致結果を定義します。
 */
export interface SearchMatch {
  task_id?: string;
  title?: string;
  project?: string;
  path: string;
  date?: string;
  section: string;
  excerpt: string;
  score: number;
}
