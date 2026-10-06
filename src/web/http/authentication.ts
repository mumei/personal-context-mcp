/**
 * @packageDocumentation
 * Performs constant-time Bearer token comparison and sends unauthenticated responses.
 * It does not validate token configuration, render the login page, or route requests.
 * Bearer トークンを定時間で比較し、未認証レスポンスを送信する。
 * トークン設定の検証、ログイン画面の描画、リクエストのルーティングは担当しない。
 */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Returns whether the request Bearer token matches the configured token.
 * リクエストの Bearer トークンが設定値と一致するかを返す。
 */
export function isAuthorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const authorization = req.headers.authorization;
  const expected = `Bearer ${token}`;
  if (typeof authorization !== "string" || authorization.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
}

/**
 * Sends a 401 response that requires Bearer authentication.
 * Bearer 認証を要求する 401 レスポンスを送信する。
 */
export function unauthorized(res: ServerResponse): void {
  res.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "www-authenticate": 'Bearer realm="personal-context-mcp-monitor"',
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  res.end(JSON.stringify({ error: "Bearer token required." }));
}
