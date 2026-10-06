/**
 * Provides daily automation capabilities for the infrastructure layer.
 * Responsibility: This module owns the daily automation behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * インフラストラクチャ層のdaily automation機能を提供します。
 * 責務: このモジュールは、ここで宣言するdaily automationの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Defines the public `DailyAutomationSettings` data contract exposed by this module.
 *
 * このモジュールが公開する`DailyAutomationSettings`データ契約を定義します。
 */
export interface DailyAutomationSettings {
  name: string;
  prompt: string;
  status: "ACTIVE" | "PAUSED";
  rrule: string;
  model: string;
  reasoning_effort: "low" | "medium" | "high";
  execution_environment: string;
  path: string;
}

/**
 * Defines the public `DailyAutomationUpdate` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`DailyAutomationUpdate`を定義します。
 */
export type DailyAutomationUpdate = Omit<DailyAutomationSettings, "path" | "execution_environment"> & {
  workspace?: string;
};

/**
 * Performs the public `dailyAutomationPath` operation provided by this module.
 *
 * このモジュールが提供する公開操作`dailyAutomationPath`を実行します。
 */
export function dailyAutomationPath(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.TASK_MCP_CODEX_DAILY_AUTOMATION_PATH ??
    join(homedir(), ".codex", "automations", "automation", "automation.toml")
  );
}

function stringValue(text: string, key: string): string {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")\\s*$`, "m"));
  if (!match?.[1]) throw new Error(`Missing or invalid automation setting: ${key}`);
  return JSON.parse(match[1]) as string;
}

function optionalStringValue(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")\\s*$`, "m"));
  return match?.[1] ? (JSON.parse(match[1]) as string) : undefined;
}

/**
 * Performs the public `loadDailyAutomationSettings` operation provided by this module.
 *
 * このモジュールが提供する公開操作`loadDailyAutomationSettings`を実行します。
 */
export async function loadDailyAutomationSettings(path = dailyAutomationPath()): Promise<DailyAutomationSettings> {
  const text = await readFile(path, "utf8");
  const status = stringValue(text, "status");
  const reasoning = optionalStringValue(text, "reasoning_effort") ?? "medium";
  if (status !== "ACTIVE" && status !== "PAUSED") throw new Error(`Unsupported automation status: ${status}`);
  if (reasoning !== "low" && reasoning !== "medium" && reasoning !== "high")
    throw new Error(`Unsupported reasoning effort: ${reasoning}`);
  return {
    name: stringValue(text, "name"),
    prompt: stringValue(text, "prompt"),
    status,
    rrule: stringValue(text, "rrule"),
    model: optionalStringValue(text, "model") ?? "",
    reasoning_effort: reasoning,
    execution_environment: optionalStringValue(text, "execution_environment") ?? "thread",
    path,
  };
}

function validateUpdate(update: DailyAutomationUpdate): void {
  if (!update.name.trim() || update.name.length > 100)
    throw new Error("Automation name must be between 1 and 100 characters.");
  if (!update.prompt.trim() || update.prompt.length > 50_000)
    throw new Error("Automation prompt must be between 1 and 50000 characters.");
  if (update.status !== "ACTIVE" && update.status !== "PAUSED")
    throw new Error("Automation status must be ACTIVE or PAUSED.");
  if (!update.rrule.startsWith("RRULE:") || update.rrule.length > 500)
    throw new Error("Automation schedule must be a valid RRULE value.");
  if (!update.model.trim() || update.model.length > 100)
    throw new Error("Automation model must be between 1 and 100 characters.");
  if (!["low", "medium", "high"].includes(update.reasoning_effort))
    throw new Error("Reasoning effort must be low, medium, or high.");
}

function replaceStringValue(text: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}\\s*=.*$`, "m");
  if (!pattern.test(text)) throw new Error(`Missing automation setting: ${key}`);
  return text.replace(pattern, `${key} = ${JSON.stringify(value)}`);
}

/**
 * Performs the public `updateDailyAutomationSettings` operation provided by this module.
 *
 * このモジュールが提供する公開操作`updateDailyAutomationSettings`を実行します。
 */
export async function updateDailyAutomationSettings(
  update: DailyAutomationUpdate,
  path = dailyAutomationPath(),
): Promise<DailyAutomationSettings> {
  validateUpdate(update);
  let text = await readFile(path, "utf8");
  text = replaceStringValue(text, "name", update.name.trim());
  text = replaceStringValue(text, "prompt", update.prompt);
  text = replaceStringValue(text, "status", update.status);
  text = replaceStringValue(text, "rrule", update.rrule);
  if (/^model\s*=/m.test(text)) text = replaceStringValue(text, "model", update.model.trim());
  if (/^reasoning_effort\s*=/m.test(text)) text = replaceStringValue(text, "reasoning_effort", update.reasoning_effort);
  if (update.workspace?.trim()) {
    const target = /^target\s*=.*$/m;
    if (target.test(text)) {
      text = text.replace(
        target,
        `target = { type = "project", project_id = ${JSON.stringify(update.workspace.trim())} }`,
      );
    } else if (!/^target_thread_id\s*=/m.test(text)) {
      throw new Error("Missing automation target setting.");
    }
  }
  text = text.replace(/^updated_at\s*=.*$/m, `updated_at = ${Date.now()}`);
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, text, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
  return loadDailyAutomationSettings(path);
}

/**
 * Creates a Codex automation when none exists, or updates the existing automation in place.
 * Existing files preserve fields that Personal Context MCP does not own.
 *
 * Codex Automationが存在しない場合は新規作成し、存在する場合は既存ファイルを更新します。
 * 既存ファイルでは、Personal Context MCPが管理しないフィールドを維持します。
 */
export async function upsertDailyAutomationSettings(
  update: DailyAutomationUpdate,
  path = dailyAutomationPath(),
): Promise<DailyAutomationSettings> {
  try {
    return await updateDailyAutomationSettings(update, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  validateUpdate(update);
  if (!update.workspace?.trim()) throw new Error("Automation workspace is required when creating an automation.");
  const text = `version = 1
id = "automation"
name = ${JSON.stringify(update.name.trim())}
prompt = ${JSON.stringify(update.prompt)}
status = ${JSON.stringify(update.status)}
rrule = ${JSON.stringify(update.rrule)}
model = ${JSON.stringify(update.model.trim())}
reasoning_effort = ${JSON.stringify(update.reasoning_effort)}
execution_environment = "local"
target = { type = "project", project_id = ${JSON.stringify(update.workspace.trim())} }
updated_at = ${Date.now()}
`;
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, text, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
  return loadDailyAutomationSettings(path);
}
