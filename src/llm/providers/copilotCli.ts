/**
 * Executes schema-oriented text generation through GitHub Copilot CLI.
 * Responsibility: This module owns isolated non-interactive Copilot CLI invocation, output limits, and timeouts.
 * Non-responsibility: This module does not select providers, validate domain JSON, or persist generated data.
 *
 * GitHub Copilot CLIを通じてスキーマ指向のテキスト生成を実行します。
 * 責務: このモジュールは、分離された非対話Copilot CLI呼び出し、出力上限、timeoutを担当します。
 * 非責務: このモジュールは、Provider選択、ドメインJSON検証、生成データの永続化を担当しません。
 *
 * @packageDocumentation
 */

import { spawn } from "node:child_process";

export const COPILOT_CLI_DEFAULT_MODEL = "gpt-5.3-codex";

export interface CopilotCliRequest {
  command: string;
  args: string[];
  prompt: string;
  cwd: string;
  model: string;
  timeoutMs: number;
  outputSchema: Record<string, unknown>;
}

export interface CopilotCliResult {
  text: string;
}

function promptWithSchema(request: CopilotCliRequest): string {
  if (Object.keys(request.outputSchema).length === 0) return request.prompt;
  return [request.prompt, "", "Return only JSON matching this JSON Schema:", JSON.stringify(request.outputSchema)].join(
    "\n",
  );
}

/**
 * Builds a non-interactive Copilot command with built-in tools denied and workspace extensions disabled.
 * 組み込みtoolを拒否し、workspace extensionを無効化した非対話Copilotコマンドを構築します。
 */
export function copilotCliArguments(request: CopilotCliRequest): string[] {
  return [
    ...request.args,
    "-p",
    promptWithSchema(request),
    "-s",
    "--model",
    request.model,
    "--no-ask-user",
    "--no-custom-instructions",
    "--no-remote",
    "--no-remote-export",
    "--no-color",
    "--deny-tool=view,grep,glob,create,edit,apply_patch,write_bash,write_powershell,web_fetch,task,skill",
  ];
}

/**
 * Parses the silent-mode assistant response returned by Copilot CLI.
 * Copilot CLIがsilent modeで返すassistant応答を解析します。
 */
export function parseCopilotCliOutput(stdout: string): CopilotCliResult {
  const text = stdout.trim();
  if (!text) throw new Error("Copilot CLI returned no generated output.");
  return { text };
}

/**
 * Runs one isolated Copilot CLI generation process.
 * 分離されたCopilot CLI生成processを1回実行します。
 */
export async function generateTextWithCopilotCli(request: CopilotCliRequest): Promise<CopilotCliResult> {
  return new Promise<CopilotCliResult>((resolve, reject) => {
    const child = spawn(request.command, copilotCliArguments(request), {
      cwd: request.cwd,
      env: {
        ...process.env,
        TASK_MCP_WEB_ENABLED: "false",
        GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS: "false",
        GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: "false",
        GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP: "false",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, result?: CopilotCliResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`Copilot CLI timed out after ${request.timeoutMs}ms.`));
    }, request.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 10 * 1024 * 1024) {
        child.kill("SIGTERM");
        finish(new Error("Copilot CLI output exceeded 10 MiB."));
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
            `Copilot CLI exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}: ${stderr.trim() || "no stderr"}`,
          ),
        );
        return;
      }
      try {
        finish(undefined, parseCopilotCliOutput(stdout));
      } catch (error) {
        finish(error as Error);
      }
    });
  });
}
