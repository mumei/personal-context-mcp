/**
 * Executes schema-oriented text generation through Cursor CLI.
 * Responsibility: This module owns isolated headless Cursor invocation, JSON parsing, output limits, and timeouts.
 * Non-responsibility: This module does not select providers, validate domain JSON, or persist generated data.
 *
 * Cursor CLIを通じてスキーマ指向のテキスト生成を実行します。
 * 責務: このモジュールは、分離されたheadless Cursor呼び出し、JSON解析、出力上限、timeoutを担当します。
 * 非責務: このモジュールは、Provider選択、ドメインJSON検証、生成データの永続化を担当しません。
 *
 * @packageDocumentation
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CURSOR_CLI_DEFAULT_MODEL = "gpt-5";

export interface CursorCliRequest {
  command: string;
  args: string[];
  prompt: string;
  cwd: string;
  model: string;
  timeoutMs: number;
  outputSchema: Record<string, unknown>;
}

export interface CursorCliResult {
  text: string;
  sessionId?: string;
}

function promptWithSchema(request: CursorCliRequest): string {
  const instructions = [
    request.prompt,
    "",
    "Do not use tools or inspect local files. Answer from the supplied text only.",
  ];
  if (Object.keys(request.outputSchema).length > 0) {
    instructions.push("Return only JSON matching this JSON Schema:", JSON.stringify(request.outputSchema));
  }
  return instructions.join("\n");
}

/** Builds a headless Cursor command without enabling automatic file changes. */
export function cursorCliArguments(request: CursorCliRequest): string[] {
  return [...request.args, "-p", promptWithSchema(request), "--output-format", "json", "--model", request.model];
}

/** Parses Cursor's single-result JSON output. */
export function parseCursorCliOutput(stdout: string): CursorCliResult {
  const raw = stdout.trim();
  if (!raw) throw new Error("Cursor CLI returned no generated output.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Cursor CLI returned invalid JSON output.");
  }
  if (!value || typeof value !== "object") throw new Error("Cursor CLI returned an invalid result object.");
  const result = value as Record<string, unknown>;
  if (result.is_error === true || result.subtype === "error") {
    throw new Error(`Cursor CLI generation failed: ${String(result.result ?? "unknown error")}`);
  }
  if (typeof result.result !== "string" || !result.result.trim()) {
    throw new Error("Cursor CLI result did not contain generated text.");
  }
  return {
    text: result.result,
    ...(typeof result.session_id === "string" ? { sessionId: result.session_id } : {}),
  };
}

/** Runs one Cursor generation from an empty temporary workspace. */
export async function generateTextWithCursorCli(request: CursorCliRequest): Promise<CursorCliResult> {
  const isolatedCwd = await mkdtemp(join(tmpdir(), "task-mcp-cursor-"));
  try {
    return await new Promise<CursorCliResult>((resolve, reject) => {
      const child = spawn(request.command, cursorCliArguments(request), {
        cwd: isolatedCwd,
        env: { ...process.env, TASK_MCP_WEB_ENABLED: "false", NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (error?: Error, result?: CursorCliResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else if (result) resolve(result);
      };
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error(`Cursor CLI timed out after ${request.timeoutMs}ms.`));
      }, request.timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (stdout.length > 10 * 1024 * 1024) {
          child.kill("SIGTERM");
          finish(new Error("Cursor CLI output exceeded 10 MiB."));
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
              `Cursor CLI exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}: ${stderr.trim() || "no stderr"}`,
            ),
          );
          return;
        }
        try {
          finish(undefined, parseCursorCliOutput(stdout));
        } catch (error) {
          finish(error as Error);
        }
      });
    });
  } finally {
    await rm(isolatedCwd, { recursive: true, force: true }).catch(() => undefined);
  }
}
