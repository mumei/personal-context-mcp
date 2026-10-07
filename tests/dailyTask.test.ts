import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  completeDailyTaskSettings,
  dailyTaskModelOptions,
  dailyTaskSettingsPath,
  inspectDailyTaskClients,
  loadDailyTaskSettings,
  prepareDailyTaskSettings,
  updateDailyTaskSettings,
  type DailyTaskSettings,
} from "#infra/config/dailyTask";

const codexAutomation = `version = 1
id = "automation"
name = "デイリーブリーフィング"
prompt = "Generate with Personal Context MCP"
status = "ACTIVE"
rrule = "RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=30"
model = "gpt-5.6-terra"
reasoning_effort = "medium"
execution_environment = "local"
target = { type = "project", project_id = "project-1" }
updated_at = 1
`;

function settings(overrides: Partial<DailyTaskSettings> = {}): DailyTaskSettings {
  return {
    version: 1,
    name: "Daily briefing",
    enabled: true,
    runner: "codex",
    schedule: "RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=30",
    timezone: "Asia/Tokyo",
    model: "gpt-5.6-terra",
    reasoning_effort: "medium",
    workspace: "/tmp/project",
    claude_loop_interval: "24h",
    prompt: "Use briefing_generate_daily.",
    ...overrides,
  };
}

describe("client-neutral daily task settings", () => {
  it("keeps model identifiers scoped to their provider", () => {
    const options = dailyTaskModelOptions();
    expect(options.claude_code_loop).toContainEqual({ value: "claude-sonnet-5-5", recommended: true });
    expect(options.claude_code_loop).toContainEqual({ value: "claude-sonnet-4-6", recommended: false });
    expect(options.copilot_cli).toContainEqual({ value: "claude-opus-5.5", recommended: false });
    expect(options.copilot_cli).toContainEqual({ value: "gpt-6-sol", recommended: false });
    expect(options.copilot_cli.some(({ value }) => value === "claude-opus-5-5")).toBe(false);
    expect(options.cursor).toEqual([
      { value: "auto", recommended: true },
      { value: "gpt-5", recommended: false },
    ]);
    expect(options.gemini_cli).toContainEqual({ value: "gemini-3-pro-preview", recommended: false });
    for (const choices of Object.values(options)) {
      expect(choices.filter(({ recommended }) => recommended)).toHaveLength(1);
      expect(new Set(choices.map(({ value }) => value)).size).toBe(choices.length);
    }
  });

  it("does not migrate an explicitly saved legacy Claude model", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-daily-task-"));
    const codexPath = join(root, "automation.toml");
    await completeDailyTaskSettings(
      root,
      settings({ runner: "claude_code_loop", model: "claude-sonnet-4-6" }),
      undefined,
      codexPath,
    );
    await expect(loadDailyTaskSettings(root, codexPath)).resolves.toMatchObject({ model: "claude-sonnet-4-6" });
  });

  it("keeps the persisted model when a heartbeat automation has no model field", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-daily-task-"));
    const codexPath = join(root, "automation.toml");
    await updateDailyTaskSettings(root, settings({ model: "gpt-6.1-sol" }), codexPath);
    const text = await readFile(codexPath, "utf8");
    await writeFile(codexPath, text.replace(/^model = .*\n/m, ""), "utf8");

    await expect(loadDailyTaskSettings(root, codexPath)).resolves.toMatchObject({ model: "gpt-6.1-sol" });
  });

  it("detects only a Personal Context MCP-specific Codex automation as configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-daily-task-"));
    const codexPath = join(root, "automation.toml");
    await writeFile(codexPath, codexAutomation, "utf8");

    let clients = await inspectDailyTaskClients(root, codexPath);
    expect(clients.find(({ runner }) => runner === "codex")).toMatchObject({ state: "not_configured" });
    expect(clients.find(({ runner }) => runner === "cursor")).toMatchObject({
      state: "not_configured",
      detection: "external",
    });

    await writeFile(
      codexPath,
      codexAutomation.replace("Generate with Personal Context MCP", "Use briefing_generate_daily"),
      "utf8",
    );
    clients = await inspectDailyTaskClients(root, codexPath);
    expect(clients.find(({ runner }) => runner === "codex")).toMatchObject({
      state: "configured",
      detection: "local",
      enabled: true,
    });
  });

  it("derives the initial settings from the existing Codex automation", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-daily-task-"));
    const codexPath = join(root, "automation.toml");
    await writeFile(codexPath, codexAutomation, "utf8");

    await expect(loadDailyTaskSettings(root, codexPath)).resolves.toMatchObject({
      runner: "codex",
      enabled: true,
      name: "デイリーブリーフィング",
      integration: { mode: "managed", status: "synchronized" },
      model_options: {
        codex: expect.arrayContaining([{ value: "gpt-6.1-sol", recommended: true }]),
        claude_code_loop: expect.arrayContaining([{ value: "claude-sonnet-5-5", recommended: true }]),
        copilot_cli: expect.arrayContaining([{ value: "gpt-5.3-codex", recommended: true }]),
        gemini_cli: expect.arrayContaining([{ value: "gemini-2.5-pro", recommended: true }]),
      },
    });
  });

  it.each([
    {
      runner: "copilot_cli" as const,
      model: "gpt-5.3-codex",
      command: "copilot --model 'gpt-5.3-codex' --no-ask-user -p",
      note: "integrationNoteCopilotCliSetup",
    },
    {
      runner: "gemini_cli" as const,
      model: "gemini-2.5-pro",
      command: "gemini --model 'gemini-2.5-pro' --prompt",
      note: "integrationNoteGeminiCliSetup",
    },
  ])("prepares an externally scheduled $runner command", async ({ runner, model, command, note }) => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-daily-task-"));
    const result = await prepareDailyTaskSettings(
      root,
      settings({ runner, model, workspace: "/tmp/user's project", prompt: "Use user's Personal Context MCP." }),
      join(root, "missing-automation.toml"),
    );

    expect(result.integration).toMatchObject({
      mode: "assisted",
      status: "setup_required",
      notes: expect.arrayContaining([note, "integrationNoteExternalScheduler", "integrationNoteLocalMcp"]),
    });
    expect(result.integration.setup_command).toContain(command);
    expect(result.integration.setup_command).toContain(`'/tmp/user'"'"'s project'`);
    expect(result.integration.setup_command).toContain(`'Use user'"'"'s Personal Context MCP.'`);
  });

  it("prepares Cursor setup without changing persisted settings or the existing Codex automation", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-daily-task-"));
    const codexPath = join(root, "automation.toml");
    await writeFile(codexPath, codexAutomation, "utf8");

    const result = await updateDailyTaskSettings(root, settings({ runner: "cursor" }), codexPath);

    expect(result).toMatchObject({
      runner: "cursor",
      integration: {
        mode: "assisted",
        status: "setup_required",
        setup_url: "https://cursor.com/automations/new",
      },
    });
    expect(result.integration.setup_command).toContain("/automate");
    expect(await readFile(codexPath, "utf8")).toContain('status = "ACTIVE"');
    await expect(readFile(dailyTaskSettingsPath(root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates a managed Codex automation when it is not configured yet", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-daily-task-"));
    const codexPath = join(root, "automations", "automation.toml");

    await updateDailyTaskSettings(root, settings(), codexPath);

    expect(await readFile(codexPath, "utf8")).toContain('prompt = "Use briefing_generate_daily."');
    expect(await readFile(codexPath, "utf8")).toContain('project_id = "/tmp/project"');
    expect(await inspectDailyTaskClients(root, codexPath)).toEqual(
      expect.arrayContaining([expect.objectContaining({ runner: "codex", state: "configured" })]),
    );
  });

  it("synchronizes shared settings back to Codex when Codex is selected", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-daily-task-"));
    const codexPath = join(root, "automation.toml");
    await writeFile(codexPath, codexAutomation, "utf8");

    await updateDailyTaskSettings(
      root,
      settings({
        name: "Updated briefing",
        enabled: false,
        prompt: "Updated prompt",
        model: "gpt-6.1-sol",
        schedule: "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=15;BYDAY=MO,WE,FR",
      }),
      codexPath,
    );

    const text = await readFile(codexPath, "utf8");
    expect(text).toContain('name = "Updated briefing"');
    expect(text).toContain('status = "PAUSED"');
    expect(text).toContain('prompt = "Updated prompt"');
    expect(text).toContain('model = "gpt-6.1-sol"');
    expect(text).toContain('rrule = "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=15;BYDAY=MO,WE,FR"');
    expect(text).toContain('target = { type = "project", project_id = "/tmp/project" }');
  });

  it("loads current Codex values instead of stale persisted editable fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-daily-task-"));
    const codexPath = join(root, "automation.toml");
    await writeFile(
      codexPath,
      codexAutomation.replace("Generate with Personal Context MCP", "Use briefing_generate_daily"),
      "utf8",
    );
    await updateDailyTaskSettings(root, settings(), codexPath);
    await writeFile(
      codexPath,
      (await readFile(codexPath, "utf8"))
        .replace('model = "gpt-5.6-terra"', 'model = "gpt-6.1-sol"')
        .replace("BYHOUR=7", "BYHOUR=9"),
      "utf8",
    );

    await expect(loadDailyTaskSettings(root, codexPath)).resolves.toMatchObject({
      model: "gpt-6.1-sol",
      schedule: expect.stringContaining("BYHOUR=9"),
    });
  });

  it("prepares a client switch without stopping the active Codex automation", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-daily-task-"));
    const codexPath = join(root, "automation.toml");
    await writeFile(
      codexPath,
      codexAutomation.replace("Generate with Personal Context MCP", "Use briefing_generate_daily"),
      "utf8",
    );

    const prepared = await prepareDailyTaskSettings(root, settings({ runner: "cursor", model: "auto" }), codexPath);

    expect(prepared).toMatchObject({
      source_runner: "codex",
      source_stop_note: "switchStopCodexAutomatic",
      integration: { mode: "assisted", status: "setup_required" },
    });
    expect(await readFile(codexPath, "utf8")).toContain('status = "ACTIVE"');
    await expect(readFile(dailyTaskSettingsPath(root), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("commits an exclusive switch and can switch back to managed Codex", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-daily-task-"));
    const codexPath = join(root, "automation.toml");
    await writeFile(
      codexPath,
      codexAutomation.replace("Generate with Personal Context MCP", "Use briefing_generate_daily"),
      "utf8",
    );
    const cursor = settings({ runner: "cursor", model: "auto" });

    await completeDailyTaskSettings(root, cursor, "codex", codexPath);

    expect(await readFile(codexPath, "utf8")).toContain('status = "PAUSED"');
    expect(await inspectDailyTaskClients(root, codexPath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runner: "codex", state: "not_configured" }),
        expect.objectContaining({ runner: "cursor", state: "configured" }),
      ]),
    );

    await completeDailyTaskSettings(root, settings({ model: "gpt-6.1-sol" }), "cursor", codexPath);

    expect(await readFile(codexPath, "utf8")).toContain('status = "ACTIVE"');
    expect(await inspectDailyTaskClients(root, codexPath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runner: "codex", state: "configured" }),
        expect.objectContaining({ runner: "cursor", state: "not_configured" }),
      ]),
    );
  });

  it("rejects switch completion when the active source changed after preparation", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-daily-task-"));
    const codexPath = join(root, "automation.toml");
    await writeFile(
      codexPath,
      codexAutomation.replace("Generate with Personal Context MCP", "Use briefing_generate_daily"),
      "utf8",
    );

    await expect(
      completeDailyTaskSettings(root, settings({ runner: "cursor", model: "auto" }), "claude_desktop", codexPath),
    ).rejects.toThrow("Active automation changed");
    expect(await readFile(codexPath, "utf8")).toContain('status = "ACTIVE"');
  });
});
