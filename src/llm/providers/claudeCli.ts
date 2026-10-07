/**
 * Provides claude cli capabilities for the LLM integration layer.
 * Responsibility: This module owns the claude cli behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * LLM統合層のclaude cli機能を提供します。
 * 責務: このモジュールは、ここで宣言するclaude cliの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { spawn } from "node:child_process";

export const CLAUDE_CLI_DEFAULT_MODEL = "claude-sonnet-5-5";

/**
 * Defines the public `ClaudeCliRequest` data contract exposed by this module.
 *
 * このモジュールが公開する`ClaudeCliRequest`データ契約を定義します。
 */
export interface ClaudeCliRequest {
  command: string;
  args: string[];
  prompt: string;
  cwd: string;
  model: string;
  timeoutMs: number;
  outputSchema: Record<string, unknown>;
}

/**
 * Defines the public `ClaudeCliResult` data contract exposed by this module.
 *
 * このモジュールが公開する`ClaudeCliResult`データ契約を定義します。
 */
export interface ClaudeCliResult {
  text: string;
  sessionId?: string;
  durationMs?: number;
  totalCostUsd?: number;
}

interface ClaudeJsonEnvelope {
  type?: unknown;
  subtype?: unknown;
  is_error?: unknown;
  result?: unknown;
  structured_output?: unknown;
  session_id?: unknown;
  duration_ms?: unknown;
  total_cost_usd?: unknown;
}

/**
 * Performs the public `claudeCliArguments` operation provided by this module.
 *
 * このモジュールが提供する公開操作`claudeCliArguments`を実行します。
 */
export function claudeCliArguments(request: ClaudeCliRequest): string[] {
  return [
    ...request.args,
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(request.outputSchema),
    "--model",
    request.model,
    "--max-turns",
    "1",
    "--permission-mode",
    "dontAsk",
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: {} }),
    "--tools",
    "",
    "--disable-slash-commands",
    "--no-chrome",
  ];
}

/**
 * Performs the public `parseClaudeCliOutput` operation provided by this module.
 *
 * このモジュールが提供する公開操作`parseClaudeCliOutput`を実行します。
 */
export function parseClaudeCliOutput(stdout: string): ClaudeCliResult {
  let envelope: ClaudeJsonEnvelope;
  try {
    envelope = JSON.parse(stdout) as ClaudeJsonEnvelope;
  } catch {
    throw new Error("Claude CLI returned invalid JSON output.");
  }
  if (
    envelope.is_error === true ||
    envelope.subtype === "error_during_execution" ||
    envelope.subtype === "error_max_turns"
  ) {
    throw new Error(
      `Claude CLI generation failed: ${typeof envelope.result === "string" ? envelope.result : String(envelope.subtype ?? "unknown error")}`,
    );
  }
  const generated = envelope.structured_output ?? envelope.result;
  if (generated === undefined || generated === null)
    throw new Error("Claude CLI result did not contain generated output.");
  const text = typeof generated === "string" ? generated : JSON.stringify(generated);
  return {
    text,
    ...(typeof envelope.session_id === "string" ? { sessionId: envelope.session_id } : {}),
    ...(typeof envelope.duration_ms === "number" ? { durationMs: envelope.duration_ms } : {}),
    ...(typeof envelope.total_cost_usd === "number" ? { totalCostUsd: envelope.total_cost_usd } : {}),
  };
}

/**
 * Performs the public `generateTextWithClaudeCli` operation provided by this module.
 *
 * このモジュールが提供する公開操作`generateTextWithClaudeCli`を実行します。
 */
export async function generateTextWithClaudeCli(request: ClaudeCliRequest): Promise<ClaudeCliResult> {
  return new Promise<ClaudeCliResult>((resolve, reject) => {
    const child = spawn(request.command, claudeCliArguments(request), {
      cwd: request.cwd,
      env: { ...process.env, TASK_MCP_WEB_ENABLED: "false" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, result?: ClaudeCliResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`Claude CLI timed out after ${request.timeoutMs}ms.`));
    }, request.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 10 * 1024 * 1024) {
        child.kill("SIGTERM");
        finish(new Error("Claude CLI output exceeded 10 MiB."));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 1024 * 1024) stderr = stderr.slice(-1024 * 1024);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        finish(
          new Error(
            `Claude CLI exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}: ${stderr.trim() || "no stderr"}`,
          ),
        );
        return;
      }
      try {
        finish(undefined, parseClaudeCliOutput(stdout));
      } catch (error) {
        finish(error as Error);
      }
    });
    child.stdin.once("error", (error) => finish(error));
    child.stdin.end(request.prompt, "utf8");
  });
}
