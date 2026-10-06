/**
 * Resolves and loads compiled Web UI assets for the HTTP server.
 * HTTPサーバ向けにビルド済みWeb UIアセットを解決して読み込みます。
 *
 * @remarks
 * This module only serves local static files and does not route API requests or render Vue components.
 * このモジュールはローカル静的ファイルだけを提供し、APIルーティングやVue描画は担当しません。
 *
 * @packageDocumentation
 */
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webUiRoots = [
  fileURLToPath(new URL("../../../dist/web-ui/", import.meta.url)),
  fileURLToPath(new URL("../../web-ui/", import.meta.url)),
];

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

/** Binary Web asset and its response content type. WebアセットのバイナリとレスポンスContent-Typeです。 */
export interface WebUiAsset {
  body: Buffer;
  contentType: string;
}

/** Loads a safe Web UI path from development or distribution assets. 開発用または配布用アセットから安全なWeb UIパスを読み込みます。 */
export async function loadWebUiAsset(pathname: string): Promise<WebUiAsset> {
  const relativePath = pathname.startsWith("/assets/") ? pathname.slice(1) : "index.html";
  if (relativePath.includes("..")) throw new Error("Invalid Web UI asset path.");
  let lastError: unknown;
  for (const root of webUiRoots) {
    try {
      const body = await readFile(join(root, relativePath));
      return { body, contentType: contentTypes[extname(relativePath)] || "application/octet-stream" };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Web UI asset was not found: ${relativePath}`);
}
