/**
 * Defines the server request context embedded in the Web application shell for route diagnostics.
 * Responsibility: This module owns the transport-neutral shape shared by the HTTP server and Vue client.
 * Non-responsibility: This module does not capture requests, inject HTML, or render diagnostics.
 *
 * ルート診断のためWebアプリケーションシェルへ埋め込むサーバリクエスト情報を定義します。
 * 責務: このモジュールは、HTTPサーバとVueクライアントで共有する転送方式非依存の形式を担当します。
 * 非責務: このモジュールは、リクエスト取得、HTML埋込、診断表示を担当しません。
 *
 * @packageDocumentation
 */

/** Server-observed navigation data embedded in index.html. index.htmlへ埋め込むサーバ観測済みナビゲーション情報です。 */
export interface WebRequestContext {
  requested_path: string;
  requested_search: string;
  requested_route: string;
  route_debug: boolean;
}
