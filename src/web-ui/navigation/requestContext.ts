/**
 * Reads and validates server request context embedded in the Web application shell.
 * Responsibility: This module owns client-side parsing of the diagnostic bootstrap element.
 * Non-responsibility: This module does not change routes or render diagnostic UI.
 *
 * Webアプリケーションシェルへ埋め込まれたサーバリクエスト情報を読み取り検証します。
 * 責務: このモジュールは、診断用ブートストラップ要素のクライアント側解析を担当します。
 * 非責務: このモジュールは、ルート変更や診断UI描画を担当しません。
 *
 * @packageDocumentation
 */

import type { WebRequestContext } from "#shared/types/webRequestContext";

const requestContextElementId = "task-mcp-request-context";

/**
 * Returns a validated request context, or null when the application shell has no usable context.
 * アプリケーションシェルに利用可能な情報がない場合はnull、それ以外は検証済み情報を返します。
 */
export function readWebRequestContext(documentValue: Document = document): WebRequestContext | null {
  const text = documentValue.getElementById(requestContextElementId)?.textContent;
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<WebRequestContext>;
    if (
      typeof value.requested_path !== "string" ||
      typeof value.requested_search !== "string" ||
      typeof value.requested_route !== "string" ||
      typeof value.route_debug !== "boolean"
    )
      return null;
    return value as WebRequestContext;
  } catch {
    return null;
  }
}

function isRestorablePath(path: string): boolean {
  return (
    ["/summary", "/report", "/report/text", "/report/markdown", "/global", "/settings"].includes(path) ||
    /^\/tasks\/[^/]+(?:\/(?:current|overview|context|memory))?$/.test(path)
  );
}

/**
 * Returns an allowlisted server-requested route when it differs from the browser-derived initial route.
 * ブラウザ由来の初期ルートと異なる場合に、許可済みのサーバ受信ルートを返します。
 */
export function initialRouteToRestore(context: WebRequestContext | null, browserRoute: string): string | null {
  if (!context || !isRestorablePath(context.requested_path) || context.requested_route === browserRoute) return null;
  return context.requested_route;
}
