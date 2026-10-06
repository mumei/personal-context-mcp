/**
 * @packageDocumentation
 * Validates and resolves environment variables and CLI arguments for the web server.
 * It does not start the server, authenticate requests, or route HTTP traffic.
 * Web サーバーの環境変数と CLI 引数を検証し、設定値を解決する。
 * サーバーの起動、リクエスト認証、HTTP ルーティングは担当しない。
 */
import { isIP } from "node:net";
import type { WebServerOptions } from "#web/types";

function argumentValue(argv: string[], name: string): string | undefined {
  const indexes = argv.reduce<number[]>((values, value, index) => {
    if (value === name) values.push(index);
    return values;
  }, []);
  if (indexes.length > 1) throw new Error(`${name} may only be specified once.`);
  const index = indexes[0];
  if (index === undefined) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function hasFlag(argv: string[], name: string): boolean {
  const count = argv.filter((value) => value === name).length;
  if (count > 1) throw new Error(`${name} may only be specified once.`);
  return count === 1;
}

function parseBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value === "" || value === "0" || value.toLowerCase() === "false") return false;
  if (value === "1" || value.toLowerCase() === "true") return true;
  throw new Error(`${name} must be true, false, 1, or 0.`);
}

function validHost(host: string): boolean {
  if (isIP(host) !== 0) return true;
  if (host.length > 253 || host.toLowerCase() === "localhost") return host.toLowerCase() === "localhost";
  return host.split(".").every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function validToken(token: string): boolean {
  return token.length >= 16 && token.length <= 512 && /^[A-Za-z0-9\-._~+/]+={0,2}$/.test(token);
}

/**
 * Returns whether the web server feature is enabled by the environment configuration.
 * Web サーバー機能が環境設定上有効かを返す。
 */
export function isWebServerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.TASK_MCP_WEB_ENABLED;
  return value === undefined ? true : parseBoolean(value, "TASK_MCP_WEB_ENABLED");
}

/**
 * Creates validated web server options from CLI arguments and environment variables.
 * CLI 引数と環境変数から検証済み Web サーバー設定を生成する。
 */
export function parseWebServerOptions(argv = process.argv, env = process.env): WebServerOptions {
  const host = argumentValue(argv, "--host") ?? env.TASK_MCP_WEB_HOST ?? "127.0.0.1";
  const portValue = argumentValue(argv, "--port") ?? env.TASK_MCP_WEB_PORT ?? "8787";
  const token = argumentValue(argv, "--token") ?? env.TASK_MCP_WEB_TOKEN;
  const allowRemote =
    hasFlag(argv, "--allow-remote") || parseBoolean(env.TASK_MCP_WEB_ALLOW_REMOTE, "TASK_MCP_WEB_ALLOW_REMOTE");
  const port = Number(portValue);

  if (!validHost(host)) throw new Error(`Invalid host: ${host}`);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${portValue}`);
  if (token !== undefined && !validToken(token)) {
    throw new Error("TASK_MCP_WEB_TOKEN or --token must be a 16-512 character Bearer-compatible token.");
  }
  if (!isLoopbackHost(host)) {
    if (!allowRemote)
      throw new Error("Refusing non-loopback host without --allow-remote or TASK_MCP_WEB_ALLOW_REMOTE=true.");
    if (!token) throw new Error("A Bearer token is required for remote access. Set --token or TASK_MCP_WEB_TOKEN.");
  }
  return { host, port, allowRemote, token };
}
