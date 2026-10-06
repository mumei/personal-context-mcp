/**
 * Embeds the server-observed navigation request into the Web application shell.
 * Responsibility: This module owns safe JSON serialization and index.html request-context injection.
 * Non-responsibility: This module does not serve assets, restore Vue routes, or render diagnostics.
 *
 * サーバが観測したナビゲーション要求をWebアプリケーションシェルへ埋め込みます。
 * 責務: このモジュールは、安全なJSON直列化とindex.htmlへのリクエスト情報埋込を担当します。
 * 非責務: このモジュールは、アセット配信、Vueルート復元、診断表示を担当しません。
 *
 * @packageDocumentation
 */

import type { WebRequestContext } from "#shared/types/webRequestContext";

export const WEB_REQUEST_CONTEXT_ELEMENT_ID = "task-mcp-request-context";

function serializedContext(context: WebRequestContext): string {
  return JSON.stringify(context).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

/**
 * Inserts a non-executable JSON request-context element before the closing head tag.
 * 実行されないJSONリクエスト情報要素をhead終了タグの直前へ挿入します。
 */
export function injectWebRequestContext(html: Buffer, url: URL): Buffer {
  const source = html.toString("utf8");
  const context: WebRequestContext = {
    requested_path: url.pathname,
    requested_search: url.search,
    requested_route: `${url.pathname}${url.search}`,
    route_debug: url.searchParams.get("route_debug") === "1",
  };
  const element = `<script id="${WEB_REQUEST_CONTEXT_ELEMENT_ID}" type="application/json">${serializedContext(context)}</script>`;
  if (!source.includes("</head>")) throw new Error("Personal Context MCP Web index.html has no closing head tag.");
  return Buffer.from(source.replace("</head>", `${element}</head>`), "utf8");
}
