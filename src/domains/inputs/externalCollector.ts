/**
 * Provides external collector capabilities for the domain layer.
 * Responsibility: This module owns the external collector behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * domain層のexternal collector機能を提供します。
 * 責務: このモジュールは、ここで宣言するexternal collectorの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import YAML from "yaml";
import type { Repository } from "#infra/repository/repository";
import type { InputsDocument } from "#shared/types";
import { mergeCollectorInputs, renderMergedSchedule } from "#domain/inputs/collectorMerge";

/**
 * Defines the public `ExternalInputCollectorConfig` data contract exposed by this module.
 *
 * このモジュールが公開する`ExternalInputCollectorConfig`データ契約を定義します。
 */
export interface ExternalInputCollectorConfig {
  enabled: boolean;
  command: string;
  args: string[];
  cwd?: string;
  timeout_ms: number;
  locale: string;
}

/**
 * Defines the public `ExternalInputCollectorResult` data contract exposed by this module.
 *
 * このモジュールが公開する`ExternalInputCollectorResult`データ契約を定義します。
 */
export interface ExternalInputCollectorResult {
  configured: boolean;
  executed: boolean;
  duration_ms: number;
}

/**
 * Defines the public `ExternalInputCollectorRunner` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`ExternalInputCollectorRunner`を定義します。
 */
export type ExternalInputCollectorRunner = (input: {
  command: string;
  args: string[];
  cwd?: string;
  dataRoot: string;
  stageRoot: string;
  timeoutMs: number;
  locale: string;
}) => Promise<void>;

/**
 * Performs the public `externalInputCollectorPath` operation provided by this module.
 *
 * このモジュールが提供する公開操作`externalInputCollectorPath`を実行します。
 */
export function externalInputCollectorPath(dataRoot: string): string {
  return join(dataRoot, "config", "external_input.yaml");
}

function validateCollectorConfig(value: unknown): ExternalInputCollectorConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("External input collector settings must be a YAML object.");
  }
  const source = value as Record<string, unknown>;
  const enabled = source.enabled === true;
  const command = typeof source.command === "string" ? source.command.trim() : "";
  const args = Array.isArray(source.args) && source.args.every((item) => typeof item === "string") ? source.args : [];
  const cwd = typeof source.cwd === "string" && source.cwd.trim() ? source.cwd.trim() : undefined;
  const timeoutMs = source.timeout_ms === undefined ? 120_000 : Number(source.timeout_ms);
  const locale = typeof source.locale === "string" && source.locale.trim() ? source.locale.trim() : "en_US.UTF-8";
  if (enabled && !command) throw new Error("External input collector command is required when enabled.");
  if (command.length > 1_000 || args.length > 100 || args.some((arg) => arg.length > 4_000)) {
    throw new Error("External input collector command or arguments are too long.");
  }
  if (cwd && !isAbsolute(cwd)) throw new Error("External input collector cwd must be an absolute path.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new Error("External input collector timeout_ms must be between 1000 and 300000.");
  }
  if (!/^[A-Za-z0-9_.@-]{1,50}$/.test(locale)) throw new Error("External input collector locale is invalid.");
  return { enabled, command, args, ...(cwd ? { cwd } : {}), timeout_ms: timeoutMs, locale };
}

/**
 * Performs the public `loadExternalInputCollectorConfig` operation provided by this module.
 *
 * このモジュールが提供する公開操作`loadExternalInputCollectorConfig`を実行します。
 */
export async function loadExternalInputCollectorConfig(dataRoot: string): Promise<ExternalInputCollectorConfig | null> {
  let text: string;
  try {
    text = await readFile(externalInputCollectorPath(dataRoot), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return validateCollectorConfig(YAML.parse(text));
}

function expandArgument(value: string, date: string, dataRoot: string): string {
  return value.replaceAll("{date}", date).replaceAll("{data_root}", dataRoot);
}

const runCommand: ExternalInputCollectorRunner = async ({
  command,
  args,
  cwd,
  dataRoot,
  stageRoot,
  timeoutMs,
  locale,
}) => {
  await new Promise<void>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        env: {
          ...process.env,
          LANG: locale,
          LC_ALL: locale,
          TASK_MCP_DATA_ROOT: dataRoot,
          TASK_MCP_COLLECTOR_STAGE_ROOT: stageRoot,
        },
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const detail = stderr.trim();
        const timedOut = error.killed || error.signal === "SIGTERM";
        const reason = timedOut ? `timed out after ${timeoutMs}ms` : `failed with exit code ${error.code ?? "unknown"}`;
        reject(new Error(`External input collector ${reason}.${detail ? ` stderr: ${detail}` : ""}`, { cause: error }));
      },
    );
  });
};

/**
 * Performs the public `runExternalInputCollector` operation provided by this module.
 *
 * このモジュールが提供する公開操作`runExternalInputCollector`を実行します。
 */
export async function runExternalInputCollector(
  repo: Repository,
  date: string,
  runner: ExternalInputCollectorRunner = runCommand,
): Promise<ExternalInputCollectorResult> {
  const config = await loadExternalInputCollectorConfig(repo.root);
  if (!config || !config.enabled) return { configured: config !== null, executed: false, duration_ms: 0 };

  const startedAt = Date.now();
  const stageRoot = join(repo.root, ".collector-staging", randomUUID());
  try {
    await runner({
      command: config.command,
      args: config.args.map((arg) => expandArgument(arg, date, repo.root)),
      cwd: config.cwd,
      dataRoot: repo.root,
      stageRoot,
      timeoutMs: config.timeout_ms,
      locale: config.locale,
    });

    const [inputText, morningBrief] = await Promise.all([
      readFile(join(stageRoot, `${date}.yaml`), "utf8").catch(() => null),
      readFile(join(stageRoot, `${date}.md`), "utf8").catch(() => null),
    ]);
    const inputs = inputText ? (YAML.parse(inputText) as InputsDocument) : null;
    const generatedAt = typeof inputs?.generated_at === "string" ? Date.parse(inputs.generated_at) : Number.NaN;
    if (
      !inputs ||
      inputs.date !== date ||
      !Array.isArray(inputs.items) ||
      !Number.isFinite(generatedAt) ||
      generatedAt < startedAt - 5_000
    ) {
      throw new Error(`External input collector did not refresh staged inputs for ${date}.`);
    }
    if (
      !morningBrief?.trim() ||
      !/^1\.\s+/m.test(morningBrief) ||
      !/^2\.\s+/m.test(morningBrief) ||
      !/^3\.\s+/m.test(morningBrief)
    ) {
      throw new Error(`External input collector did not generate staged briefing sections 1-3 for ${date}.`);
    }
    await repo.withTransaction(async () => {
      const merged = mergeCollectorInputs(await repo.loadInputs(date), inputs);
      await repo.saveInputs(date, merged, "external-input-collector");
      await repo.saveOutput(
        "morning",
        date,
        renderMergedSchedule(morningBrief, merged),
        "external-input-collector",
        "md",
      );
    });
    return { configured: true, executed: true, duration_ms: Date.now() - startedAt };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}
