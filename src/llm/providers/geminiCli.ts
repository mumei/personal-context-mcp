/**
 * Executes schema-oriented text generation through Gemini CLI.
 * Responsibility: This module owns isolated headless Gemini invocation, JSON parsing, output limits, and timeouts.
 * Non-responsibility: This module does not select providers, validate domain JSON, or persist generated data.
 *
 * Gemini CLIを通じてスキーマ指向のテキスト生成を実行します。
 * 責務: このモジュールは、分離されたheadless Gemini呼び出し、JSON解析、出力上限、timeoutを担当します。
 * 非責務: このモジュールは、Provider選択、ドメインJSON検証、生成データの永続化を担当しません。
 *
 * @packageDocumentation
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const GEMINI_CLI_DEFAULT_MODEL = "gemini-2.5-pro";

export interface GeminiCliRequest {
  command: string;
  args: string[];
  prompt: string;
  cwd: string;
  model: string;
  timeoutMs: number;
  outputSchema: Record<string, unknown>;
}

export interface GeminiCliResult {
  text: string;
}

function promptWithSchema(request: GeminiCliRequest): string {
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

/** Builds a headless Gemini command with structured process output. */
export function geminiCliArguments(request: GeminiCliRequest): string[] {
  return [
    ...request.args,
    "--prompt",
    promptWithSchema(request),
    "--output-format",
    "json",
    "--model",
    request.model,
    "--skip-trust",
  ];
}

/** Parses Gemini's headless JSON output. */
export function parseGeminiCliOutput(stdout: string): GeminiCliResult {
  const raw = stdout.trim();
  if (!raw) throw new Error("Gemini CLI returned no generated output.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Gemini CLI returned invalid JSON output.");
  }
  if (!value || typeof value !== "object") throw new Error("Gemini CLI returned an invalid result object.");
  const result = value as Record<string, unknown>;
  if (result.error && typeof result.error === "object") {
    const error = result.error as Record<string, unknown>;
    throw new Error(`Gemini CLI generation failed: ${String(error.message ?? "unknown error")}`);
  }
  if (typeof result.response !== "string" || !result.response.trim()) {
    throw new Error("Gemini CLI result did not contain generated text.");
  }
  return { text: result.response };
}

/** Runs one Gemini generation from an empty temporary workspace. */
export async function generateTextWithGeminiCli(request: GeminiCliRequest): Promise<GeminiCliResult> {
  const isolatedCwd = await mkdtemp(join(tmpdir(), "task-mcp-gemini-"));
  try {
    return await new Promise<GeminiCliResult>((resolve, reject) => {
      const child = spawn(request.command, geminiCliArguments(request), {
        cwd: isolatedCwd,
        env: {
          ...process.env,
          TASK_MCP_WEB_ENABLED: "false",
          GEMINI_CLI_TRUST_WORKSPACE: "true",
          NO_COLOR: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (error?: Error, result?: GeminiCliResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else if (result) resolve(result);
      };
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error(`Gemini CLI timed out after ${request.timeoutMs}ms.`));
      }, request.timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (stdout.length > 10 * 1024 * 1024) {
          child.kill("SIGTERM");
          finish(new Error("Gemini CLI output exceeded 10 MiB."));
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
              `Gemini CLI exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}: ${stderr.trim() || "no stderr"}`,
            ),
          );
          return;
        }
        try {
          finish(undefined, parseGeminiCliOutput(stdout));
        } catch (error) {
          finish(error as Error);
        }
      });
    });
  } finally {
    await rm(isolatedCwd, { recursive: true, force: true }).catch(() => undefined);
  }
}
