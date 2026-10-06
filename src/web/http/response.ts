/**
 * @packageDocumentation
 * Applies common web response headers, sends response bodies, and reads JSON request bodies.
 * It does not make authentication decisions, select API routes, or execute business operations.
 * Web レスポンスの共通ヘッダー適用、本文送信、JSON リクエスト本文の読取を担当する。
 * 認証判断、API ルート選択、業務処理の実行は担当しない。
 */
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Sends a JSON response with security headers.
 * JSON レスポンスをセキュリティヘッダー付きで送信する。
 */
export function json(res: ServerResponse, value: unknown, status = 200): void {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  res.end(body);
}

/**
 * Sends a text response with security headers.
 * テキストレスポンスをセキュリティヘッダー付きで送信する。
 */
export function text(
  res: ServerResponse,
  value: string,
  contentType = "text/plain; charset=utf-8",
  status = 200,
): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  res.end(value);
}

/**
 * Parses an IncomingMessage URL against the local application base URL.
 * IncomingMessage の URL をローカルアプリケーションの基準 URL に対して解析する。
 */
export function routeUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://personal-context-mcp.local");
}

/**
 * Reads a JSON object body with size and Content-Type validation.
 * サイズ制限と Content-Type 検証付きで JSON オブジェクト本文を読み取る。
 */
export async function readJsonBody(req: IncomingMessage, maxBytes = 4096): Promise<Record<string, unknown>> {
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new Error("Content-Type must be application/json.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required.");
  return parsed as Record<string, unknown>;
}
