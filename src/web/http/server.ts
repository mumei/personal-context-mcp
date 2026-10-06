/**
 * @packageDocumentation
 * Creates the web HTTP server, applies the common request gate, and manages its lifecycle.
 * It does not implement API business routes, authentication algorithms, or response body handling.
 * Web HTTP サーバーを生成し、共通リクエストゲートを適用して、そのライフサイクルを管理する。
 * API の業務ルート、認証アルゴリズム、レスポンス本文処理の実装は担当しない。
 */
import { createServer, type Server } from "node:http";
import { extname } from "node:path";
import { loadConfig } from "#infra/config/config";
import { Repository } from "#infra/repository/repository";
import { syncDataRootReadme } from "#infra/startup/syncReadme";
import type { TaskMcpConfig } from "#shared/types";
import { loadWebUiAsset } from "#web/ui/staticAssets";
import { injectWebRequestContext } from "#web/ui/requestContext";
import { BriefingGenerationConflictError } from "#web/briefing/generation";
import { parseWebServerOptions, type WebServerOptions } from "#web/application";
import { isAuthorized, unauthorized } from "#web/http/authentication";
import { handleApi, isAllowedMutation } from "#web/http/routes";
import { json, routeUrl, text } from "#web/http/response";
import { startBackupRetentionScheduler } from "#app/cleanup";

function loginHtml(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Personal Context MCP</title></head>
<body>
  <form id="login"><label>Access token <input id="token" type="password" autocomplete="current-password" required></label><button>Open monitor</button></form>
  <p id="error" role="alert"></p>
  <script>
    document.getElementById("login").addEventListener("submit", async (event) => {
      event.preventDefault();
      const token = document.getElementById("token").value;
      const response = await fetch("/", { headers: { Authorization: "Bearer " + token } });
      if (!response.ok) { document.getElementById("error").textContent = "Authentication failed."; return; }
      sessionStorage.setItem("task-mcp-web-token", token);
      document.open(); document.write(await response.text()); document.close();
    });
  </script>
</body>
</html>`;
}

/**
 * Creates an unstarted web HTTP server bound to a Repository and configuration.
 * Repository と設定に結び付いた未起動の Web HTTP サーバーを生成する。
 */
export function createTaskMcpWebServer(
  repo: Repository,
  config: TaskMcpConfig,
  options: Pick<WebServerOptions, "token"> = {},
) {
  return createServer((req, res) => {
    void (async () => {
      const url = routeUrl(req);
      if (options.token && url.pathname === "/login") {
        if (req.method !== "GET") {
          json(res, { error: "Method not allowed. This monitor is read-only." }, 405);
          return;
        }
        text(res, loginHtml(), "text/html; charset=utf-8");
        return;
      }
      if (!isAuthorized(req, options.token)) {
        unauthorized(res);
        return;
      }
      if (!isAllowedMutation(req.method, url.pathname)) {
        json(res, { error: "Method not allowed. This monitor is read-only." }, 405);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await handleApi(url, req, repo, config, res);
        return;
      }
      if (url.pathname === "/" || extname(url.pathname) === "" || url.pathname.startsWith("/assets/")) {
        const asset = await loadWebUiAsset(url.pathname);
        const body = asset.contentType.startsWith("text/html") ? injectWebRequestContext(asset.body, url) : asset.body;
        res.writeHead(200, { "content-type": asset.contentType, "content-length": body.byteLength });
        res.end(body);
        return;
      }
      json(res, { error: "Not found" }, 404);
    })().catch((error: unknown) => {
      json(res, { error: (error as Error).message }, error instanceof BriefingGenerationConflictError ? 409 : 500);
    });
  });
}

/**
 * Starts the web HTTP server on the specified host and port.
 * Web HTTP サーバーを指定されたホストとポートで起動する。
 */
export async function startTaskMcpWebServer(
  repo: Repository,
  config: TaskMcpConfig,
  options: WebServerOptions,
): Promise<Server> {
  const server = createTaskMcpWebServer(repo, config, { token: options.token });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(options.port, options.host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  return server;
}

/**
 * Stops a running web HTTP server and its existing connections.
 * 起動中の Web HTTP サーバーと既存接続を停止する。
 */
export async function stopTaskMcpWebServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

/**
 * Initializes configuration and the Repository and starts the CLI web server.
 * 設定と Repository を初期化し、CLI 用 Web サーバーを起動する。
 */
export async function runWebServer(): Promise<void> {
  const config = loadConfig();
  const options = parseWebServerOptions();
  const repo = new Repository(config);
  await syncDataRootReadme(repo);
  startBackupRetentionScheduler(repo, config);
  await startTaskMcpWebServer(repo, config, options);
  console.error(`personal-context-mcp monitor running at http://${options.host}:${options.port}`);
  console.error(`data root: ${repo.root}`);
}
