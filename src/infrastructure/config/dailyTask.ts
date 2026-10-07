/**
 * Stores client-neutral daily task settings and coordinates supported client automation adapters.
 * Responsibility: This module owns the canonical daily task configuration, validation, adapter guidance, and Codex
 * synchronization. Non-responsibility: It does not invoke a client UI or claim direct synchronization for clients
 * without a documented configuration API.
 *
 * クライアント非依存の日次タスク設定を保存し、対応するクライアント自動化アダプターを調整します。
 * 責務: 日次タスク設定の正本、検証、アダプター案内、Codex同期を担当します。
 * 非責務: クライアントUIの操作や、公開設定APIがないクライアントへの直接同期を行ったとは扱いません。
 *
 * @packageDocumentation
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { CODEX_APP_SERVER_DEFAULT_MODEL } from "#llm/providers/codexAppServer";
import { CLAUDE_CLI_DEFAULT_MODEL } from "#llm/providers/claudeCli";
import { COPILOT_CLI_DEFAULT_MODEL } from "#llm/providers/copilotCli";
import { GEMINI_CLI_DEFAULT_MODEL } from "#llm/providers/geminiCli";
import { CURSOR_CLI_DEFAULT_MODEL } from "#llm/providers/cursorCli";
import {
  dailyAutomationPath,
  loadDailyAutomationSettings,
  updateDailyAutomationSettings,
  upsertDailyAutomationSettings,
} from "#infra/config/dailyAutomation";

/** Supported execution clients for one daily task. 日次タスクで選択できる実行クライアントです。 */
export type DailyTaskRunner = "codex" | "cursor" | "claude_code_loop" | "claude_desktop" | "copilot_cli" | "gemini_cli";

/** Canonical client-neutral settings persisted under the Personal Context MCP data root. Personal Context MCPデータルートへ保存する共通設定です。 */
export interface DailyTaskSettings {
  version: 1;
  name: string;
  enabled: boolean;
  runner: DailyTaskRunner;
  schedule: string;
  timezone: string;
  model: string;
  reasoning_effort: "low" | "medium" | "high";
  workspace: string;
  claude_loop_interval: string;
  prompt: string;
}

/** Adapter state and setup material presented by the Web UI. Web UIへ提示するアダプター状態と設定情報です。 */
export interface DailyTaskIntegration {
  mode: "managed" | "assisted";
  status: "synchronized" | "setup_required";
  setup_url?: string;
  setup_command?: string;
  notes: string[];
}

/** Daily task settings with derived adapter presentation. アダプター表示情報を含む日次タスク設定です。 */
export type DailyTaskSettingsView = DailyTaskSettings & {
  integration: DailyTaskIntegration;
  model_options: Record<DailyTaskRunner, Array<{ value: string; recommended: boolean }>>;
};

/** Automation configuration state detectable by Personal Context MCP. Personal Context MCPから検出できる自動化設定状態です。 */
export interface DailyTaskClientStatus {
  runner: DailyTaskRunner;
  state: "configured" | "not_configured";
  selected: boolean;
  detection: "local" | "external";
  name?: string;
  schedule?: string;
  model?: string;
  enabled?: boolean;
}

/**
 * Setup material returned before an automation change is committed.
 *
 * 自動化設定の変更を確定する前に返すセットアップ情報です。
 */
export type DailyTaskPreparation = DailyTaskSettingsView & {
  source_runner?: DailyTaskRunner;
  source_stop_note?: string;
};

const runners = new Set<DailyTaskRunner>([
  "codex",
  "cursor",
  "claude_code_loop",
  "claude_desktop",
  "copilot_cli",
  "gemini_cli",
]);

/** Returns provider-owned model choices for each execution client. 実行クライアントごとのProvider管理モデル候補を返します。 */
export function dailyTaskModelOptions(): DailyTaskSettingsView["model_options"] {
  const claude = [
    { value: CLAUDE_CLI_DEFAULT_MODEL, recommended: true },
    { value: "claude-opus-5-5", recommended: false },
    { value: "claude-sonnet-4-6", recommended: false },
    { value: "claude-opus-4-6", recommended: false },
  ];
  return {
    codex: [
      { value: CODEX_APP_SERVER_DEFAULT_MODEL, recommended: true },
      { value: "gpt-6-astra", recommended: false },
      { value: "gpt-6-sol", recommended: false },
      { value: "gpt-6-luna", recommended: false },
    ],
    cursor: [
      { value: "auto", recommended: true },
      { value: CURSOR_CLI_DEFAULT_MODEL, recommended: false },
    ],
    claude_code_loop: claude,
    claude_desktop: claude,
    copilot_cli: [
      { value: COPILOT_CLI_DEFAULT_MODEL, recommended: true },
      { value: "gpt-6-sol", recommended: false },
      { value: "gpt-6-luna", recommended: false },
      { value: "gpt-6-astra", recommended: false },
      { value: "claude-opus-5.5", recommended: false },
      { value: "claude-haiku-4.5", recommended: false },
      { value: "gemini-3.7-flash", recommended: false },
      { value: "gpt-5.4", recommended: false },
    ],
    gemini_cli: [
      { value: GEMINI_CLI_DEFAULT_MODEL, recommended: true },
      { value: "gemini-3-pro-preview", recommended: false },
      { value: "gemini-3.1-pro-preview", recommended: false },
      { value: "gemini-3-flash-preview", recommended: false },
    ],
  };
}

/** Returns the canonical daily task configuration path. 日次タスク設定の正本パスを返します。 */
export function dailyTaskSettingsPath(dataRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.TASK_MCP_DAILY_TASK_CONFIG_PATH ?? join(dataRoot, "config", "daily_task.yaml");
}

async function persistedSettings(dataRoot: string): Promise<DailyTaskSettings | null> {
  try {
    const settings = YAML.parse(await readFile(dailyTaskSettingsPath(dataRoot), "utf8")) as DailyTaskSettings;
    validate(settings);
    return settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Inspects automation state without importing or editing existing client settings. 既存クライアント設定を取り込み・編集せずに自動化状態を検査します。 */
export async function inspectDailyTaskClients(
  dataRoot: string,
  codexPath = dailyAutomationPath(),
): Promise<DailyTaskClientStatus[]> {
  const selected = await persistedSettings(dataRoot);
  let codex: DailyTaskClientStatus = {
    runner: "codex",
    state: "not_configured",
    selected: selected?.runner === "codex",
    detection: "local",
  };
  try {
    const current = await loadDailyAutomationSettings(codexPath);
    if (current.prompt.includes("briefing_generate_daily") && (!selected || selected.runner === "codex")) {
      codex = {
        ...codex,
        state: "configured",
        name: current.name,
        schedule: current.rrule,
        model: selected?.model || current.model || undefined,
        enabled: current.status === "ACTIVE",
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return [
    codex,
    ...(["cursor", "claude_code_loop", "claude_desktop", "copilot_cli", "gemini_cli"] as const).map((runner) => ({
      runner,
      state: selected?.runner === runner ? ("configured" as const) : ("not_configured" as const),
      selected: selected?.runner === runner,
      detection: "external" as const,
      ...(selected?.runner === runner
        ? {
            name: selected.name,
            schedule: selected.schedule,
            model: selected.model,
            enabled: selected.enabled,
          }
        : {}),
    })),
  ];
}

function validate(settings: DailyTaskSettings): void {
  if (settings.version !== 1) throw new Error("Daily task settings version must be 1.");
  if (!settings.name.trim() || settings.name.length > 100) throw new Error("Daily task name is invalid.");
  if (!runners.has(settings.runner)) throw new Error("Unsupported daily task runner.");
  if (!settings.schedule.startsWith("RRULE:") || settings.schedule.length > 500)
    throw new Error("Daily task schedule must be an RRULE value.");
  if (!settings.timezone.trim() || settings.timezone.length > 100) throw new Error("Daily task timezone is invalid.");
  if (!settings.model.trim() || settings.model.length > 100) throw new Error("Daily task model is invalid.");
  if (!["low", "medium", "high"].includes(settings.reasoning_effort))
    throw new Error("Daily task reasoning effort is invalid.");
  if (!settings.workspace.trim() || settings.workspace.length > 2_000)
    throw new Error("Daily task workspace is invalid.");
  if (!/^\d+[mhd]$/.test(settings.claude_loop_interval))
    throw new Error("Claude Code loop interval must use m, h, or d, such as 24h.");
  if (!settings.prompt.trim() || settings.prompt.length > 50_000) throw new Error("Daily task prompt is invalid.");
}

function integration(settings: DailyTaskSettings): DailyTaskIntegration {
  if (settings.runner === "codex") {
    return {
      mode: "managed",
      status: "synchronized",
      notes: ["integrationNoteCodexManaged"],
    };
  }
  if (settings.runner === "cursor") {
    return {
      mode: "assisted",
      status: "setup_required",
      setup_url: "https://cursor.com/automations/new",
      setup_command: `/automate モデル=${settings.model}、${settings.schedule} (${settings.timezone}) で次の処理を実行してください。\n\n${settings.prompt}`,
      notes: ["integrationNoteCursorSetup", "integrationNoteCursorMcp"],
    };
  }
  if (settings.runner === "claude_code_loop") {
    return {
      mode: "assisted",
      status: "setup_required",
      setup_command: `Claude Codeをモデル ${settings.model} で起動し、セッション内で次を実行してください。\n\n/loop ${settings.claude_loop_interval} ${settings.prompt}`,
      notes: ["integrationNoteClaudeLoopSetup", "integrationNoteClaudeLoopExpiry"],
    };
  }
  if (settings.runner === "copilot_cli") {
    return {
      mode: "assisted",
      status: "setup_required",
      setup_command: `cd ${shellQuote(settings.workspace)} && copilot --model ${shellQuote(settings.model)} --no-ask-user -p ${shellQuote(settings.prompt)}`,
      notes: ["integrationNoteCopilotCliSetup", "integrationNoteExternalScheduler", "integrationNoteLocalMcp"],
    };
  }
  if (settings.runner === "gemini_cli") {
    return {
      mode: "assisted",
      status: "setup_required",
      setup_command: `cd ${shellQuote(settings.workspace)} && gemini --model ${shellQuote(settings.model)} --prompt ${shellQuote(settings.prompt)}`,
      notes: ["integrationNoteGeminiCliSetup", "integrationNoteExternalScheduler", "integrationNoteLocalMcp"],
    };
  }
  return {
    mode: "assisted",
    status: "setup_required",
    setup_url: "https://claude.ai",
    setup_command: `Claude DesktopのScheduled Tasksで、モデル=${settings.model}、${settings.schedule} (${settings.timezone}) を指定し、次のプロンプトを登録してください。\n\n${settings.prompt}`,
    notes: ["integrationNoteClaudeDesktopSetup"],
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function sourceStopNote(runner?: DailyTaskRunner): string | undefined {
  if (runner === "codex") return "switchStopCodexAutomatic";
  if (runner === "cursor") return "switchStopCursor";
  if (runner === "claude_code_loop") return "switchStopClaudeLoop";
  if (runner === "claude_desktop") return "switchStopClaudeDesktop";
  if (runner === "copilot_cli") return "switchStopCopilotCli";
  if (runner === "gemini_cli") return "switchStopGeminiCli";
  return undefined;
}

async function fromCodex(path: string): Promise<DailyTaskSettings> {
  const current = await loadDailyAutomationSettings(path);
  return {
    version: 1,
    name: current.name,
    enabled: current.status === "ACTIVE",
    runner: "codex",
    schedule: current.rrule,
    timezone: "Asia/Tokyo",
    model: current.model || CODEX_APP_SERVER_DEFAULT_MODEL,
    reasoning_effort: current.reasoning_effort,
    workspace: process.cwd(),
    claude_loop_interval: "24h",
    prompt: current.prompt,
  };
}

/** Loads the common settings, deriving an initial view from Codex when migration has not been saved yet. 共通設定を読み込み、未移行時はCodex設定から初期表示を作ります。 */
export async function loadDailyTaskSettings(
  dataRoot: string,
  codexPath = dailyAutomationPath(),
): Promise<DailyTaskSettingsView> {
  const persisted = await persistedSettings(dataRoot);
  let settings = persisted ?? (await fromCodex(codexPath));
  if (persisted?.runner === "codex") {
    try {
      const current = await fromCodex(codexPath);
      settings = {
        ...persisted,
        name: current.name,
        enabled: current.enabled,
        schedule: current.schedule,
        model: current.model || persisted.model,
        reasoning_effort: current.reasoning_effort,
        prompt: current.prompt,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  validate(settings);
  return { ...settings, integration: integration(settings), model_options: dailyTaskModelOptions() };
}

async function persistDailyTaskSettings(dataRoot: string, settings: DailyTaskSettings): Promise<void> {
  const path = dailyTaskSettingsPath(dataRoot);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = path + ".tmp-" + process.pid;
  await writeFile(temporaryPath, YAML.stringify(settings), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

/**
 * Prepares setup instructions without changing the currently active automation.
 *
 * 現在有効な自動化を変更せず、切り替え先のセットアップ手順を準備します。
 */
export async function prepareDailyTaskSettings(
  dataRoot: string,
  update: DailyTaskSettings,
  codexPath = dailyAutomationPath(),
): Promise<DailyTaskPreparation> {
  const settings: DailyTaskSettings = { ...update, version: 1 };
  validate(settings);
  const sourceRunner = (await inspectDailyTaskClients(dataRoot, codexPath)).find(
    ({ state }) => state === "configured",
  )?.runner;
  const preparedIntegration =
    settings.runner === "codex"
      ? {
          mode: "managed" as const,
          status: "setup_required" as const,
          notes: ["integrationNoteCodexPrepared"],
        }
      : integration(settings);
  return {
    ...settings,
    integration: preparedIntegration,
    model_options: dailyTaskModelOptions(),
    ...(sourceRunner ? { source_runner: sourceRunner } : {}),
    ...(sourceRunner && sourceRunner !== settings.runner ? { source_stop_note: sourceStopNote(sourceRunner) } : {}),
  };
}

/**
 * Commits a prepared automation change and deactivates the previous managed Codex automation when necessary.
 *
 * 準備済みの自動化変更を確定し、必要に応じて以前の管理対象Codex Automationを停止します。
 */
export async function completeDailyTaskSettings(
  dataRoot: string,
  update: DailyTaskSettings,
  expectedSourceRunner?: DailyTaskRunner,
  codexPath = dailyAutomationPath(),
): Promise<DailyTaskSettingsView> {
  const settings: DailyTaskSettings = { ...update, version: 1 };
  validate(settings);
  const currentRunner = (await inspectDailyTaskClients(dataRoot, codexPath)).find(
    ({ state }) => state === "configured",
  )?.runner;
  if (currentRunner !== expectedSourceRunner) {
    throw new Error(
      "Active automation changed during setup: expected " +
        (expectedSourceRunner ?? "none") +
        ", found " +
        (currentRunner ?? "none") +
        ".",
    );
  }
  if (settings.runner === "codex") {
    await upsertDailyAutomationSettings(
      {
        name: settings.name,
        prompt: settings.prompt,
        status: settings.enabled ? "ACTIVE" : "PAUSED",
        rrule: settings.schedule,
        model: settings.model,
        reasoning_effort: settings.reasoning_effort,
        workspace: settings.workspace,
      },
      codexPath,
    );
  } else if (currentRunner === "codex") {
    const current = await loadDailyAutomationSettings(codexPath);
    await updateDailyAutomationSettings({ ...current, status: "PAUSED" }, codexPath);
  }
  await persistDailyTaskSettings(dataRoot, settings);
  return { ...settings, integration: integration(settings), model_options: dailyTaskModelOptions() };
}

/**
 * Sets up a managed Codex automation or returns setup material for an externally managed client.
 * Assisted setup does not persist a selection or disable an existing automation before external setup is verified.
 *
 * 管理可能なCodex Automationを設定するか、外部管理クライアント向けの設定情報を返します。
 * 設定支援では、外部設定を確認する前に選択状態を保存したり既存自動化を停止したりしません。
 */
export async function updateDailyTaskSettings(
  dataRoot: string,
  update: DailyTaskSettings,
  codexPath = dailyAutomationPath(),
): Promise<DailyTaskSettingsView> {
  const settings: DailyTaskSettings = { ...update, version: 1 };
  validate(settings);
  if (settings.runner !== "codex") {
    return { ...settings, integration: integration(settings), model_options: dailyTaskModelOptions() };
  }
  await upsertDailyAutomationSettings(
    {
      name: settings.name,
      prompt: settings.prompt,
      status: settings.enabled ? "ACTIVE" : "PAUSED",
      rrule: settings.schedule,
      model: settings.model,
      reasoning_effort: settings.reasoning_effort,
      workspace: settings.workspace,
    },
    codexPath,
  );
  await persistDailyTaskSettings(dataRoot, settings);
  return { ...settings, integration: integration(settings), model_options: dailyTaskModelOptions() };
}
