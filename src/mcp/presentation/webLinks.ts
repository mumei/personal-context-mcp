/**
 * Builds browser-facing Personal Context MCP links and removes persistence-only filesystem metadata from MCP responses.
 * Responsibility: This module owns public Web URL construction and MCP response sanitization for UI-facing tools.
 * Non-responsibility: This module does not start the Web server, authorize HTTP requests, or alter persisted data.
 *
 * ブラウザ向けPersonal Context MCPリンクを構築し、MCP応答から永続化専用のファイルシステム情報を除去します。
 * 責務: このモジュールは、公開Web URLの構築とUI向けMCPツールの応答サニタイズを担当します。
 * 非責務: このモジュールは、Webサーバの起動、HTTP認可、永続化データの変更を担当しません。
 *
 * @packageDocumentation
 */

export type ReportWebFormat = "text" | "markdown" | "html";

/** Browser links returned by situation and report MCP tools. 状況取得・レポートMCPツールが返すブラウザリンクです。 */
export interface TaskMcpWebLinks {
  summary: string;
  report_text: string;
  report_markdown: string;
}

function validatedPort(value: string | undefined): number {
  const port = Number(value ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`TASK_MCP_WEB_PORT must be an integer between 1 and 65535: ${value ?? ""}`);
  }
  return port;
}

function displayHost(value: string | undefined): string {
  const host = value?.trim() || "127.0.0.1";
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/**
 * Resolves the browser-visible base URL from Web server environment settings.
 * Webサーバの環境設定からブラウザ表示用のベースURLを解決します。
 */
export function resolveTaskMcpWebBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.TASK_MCP_WEB_BASE_URL?.trim();
  if (!explicit) return `http://${displayHost(env.TASK_MCP_WEB_HOST)}:${validatedPort(env.TASK_MCP_WEB_PORT)}`;

  let url: URL;
  try {
    url = new URL(explicit);
  } catch {
    throw new Error("TASK_MCP_WEB_BASE_URL must be an absolute HTTP or HTTPS URL.");
  }
  if (
    !(["http:", "https:"] as string[]).includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("TASK_MCP_WEB_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment.");
  }
  return url.toString().replace(/\/$/, "");
}

function pageUrl(baseUrl: string, pathname: string, date: string): string {
  const base = new URL(`${baseUrl.replace(/\/$/, "")}/`);
  const prefix = base.pathname.replace(/\/$/, "");
  base.pathname = `${prefix}${pathname}`;
  base.searchParams.set("date", date);
  return base.toString();
}

/**
 * Builds all primary Web links for one operational date.
 * 1つの運用日について主要なWebリンクをすべて構築します。
 */
export function taskMcpWebLinks(date: string, env: NodeJS.ProcessEnv = process.env): TaskMcpWebLinks {
  const baseUrl = resolveTaskMcpWebBaseUrl(env);
  return {
    summary: pageUrl(baseUrl, "/summary", date),
    report_text: pageUrl(baseUrl, "/report/text", date),
    report_markdown: pageUrl(baseUrl, "/report/markdown", date),
  };
}

/**
 * Selects the browser report page corresponding to a rendered report format.
 * レンダリング形式に対応するブラウザのレポート画面を選択します。
 */
export function reportWebUrl(date: string, format: ReportWebFormat, env: NodeJS.ProcessEnv = process.env): string {
  const links = taskMcpWebLinks(date, env);
  return format === "text" ? links.report_text : links.report_markdown;
}

/**
 * Recursively removes absolute persistence paths before a value crosses the MCP boundary.
 * 値がMCP境界を越える前に、永続化処理の絶対パスを再帰的に除去します。
 */
export function withoutPersistencePaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPersistencePaths);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "path" && key !== "backupPath")
      .map(([key, item]) => [key, withoutPersistencePaths(item)]),
  );
}
