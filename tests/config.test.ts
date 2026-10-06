import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expandHome, loadConfig } from "#infra/config/config";
import { CLAUDE_CLI_DEFAULT_MODEL } from "#llm/providers/claudeCli";
import { CODEX_APP_SERVER_DEFAULT_MODEL } from "#llm/providers/codexAppServer";
import { COPILOT_CLI_DEFAULT_MODEL } from "#llm/providers/copilotCli";
import { CURSOR_CLI_DEFAULT_MODEL } from "#llm/providers/cursorCli";
import { GEMINI_CLI_DEFAULT_MODEL } from "#llm/providers/geminiCli";
import { LM_STUDIO_DEFAULT_BASE_URL, LM_STUDIO_DEFAULT_MODEL } from "#llm/providers/lmStudio";

describe("config", () => {
  it("defaults the data root to ~/.tasks", () => {
    const config = loadConfig(["node", "task-mcp"], {});

    expect(config.dataRoot).toBe(resolve(homedir(), ".tasks"));
    expect(config.layout.tasks).toBe("tasks.yaml");
    expect(config.layout.agentUpdates).toBe("agent_updates");
    expect(config.layout.taskMemory).toBe("task_memory");
    expect(config.layout.reportSummaries).toBe("report_summaries");
    expect(config.layout.memorySummaries).toBe("memory_summaries");
    expect(config.layout.globalMemory).toBe("global_memory.yaml");
    expect(config.layout.knowledge).toBe("knowledge");
    expect(config.codexAppServerModel).toBe(CODEX_APP_SERVER_DEFAULT_MODEL);
    expect(config.reportLlmProvider).toBe("auto");
    expect(config.claudeCliModel).toBe(CLAUDE_CLI_DEFAULT_MODEL);
    expect(config.copilotCliModel).toBe(COPILOT_CLI_DEFAULT_MODEL);
    expect(config.cursorCliModel).toBe(CURSOR_CLI_DEFAULT_MODEL);
    expect(config.geminiCliModel).toBe(GEMINI_CLI_DEFAULT_MODEL);
    expect(config.lmStudioBaseUrl).toBe(LM_STUDIO_DEFAULT_BASE_URL);
    expect(config.lmStudioModel).toBe(LM_STUDIO_DEFAULT_MODEL);
    expect(config.backupCleanup).toMatchObject({
      enabled: true,
      runAt: "03:00",
      keepAllDays: 7,
      keepDailyDays: 30,
      keepWeeklyDays: 180,
      keepMonthlyDays: 365,
      archiveGraceDays: 30,
    });
  });

  it("allows env and CLI overrides without project-specific paths", () => {
    expect(expandHome("~/custom-tasks")).toBe(resolve(homedir(), "custom-tasks"));

    const envConfig = loadConfig(["node", "task-mcp"], {
      TASK_MCP_DATA_ROOT: "~/generic-tasks",
      TASK_MCP_TIMEZONE: "Asia/Tokyo",
      TASK_MCP_CODEX_APP_SERVER_MODEL: "custom-model",
      CODEX_CLI_PATH: "/Applications/ChatGPT.app/Contents/Resources/codex",
      TASK_MCP_LLM_PROVIDER: "claude_cli",
      TASK_MCP_CLAUDE_MODEL: "custom-claude",
      TASK_MCP_COPILOT_MODEL: "custom-copilot",
      TASK_MCP_CURSOR_MODEL: "custom-cursor",
      TASK_MCP_GEMINI_MODEL: "custom-gemini",
      TASK_MCP_LM_STUDIO_BASE_URL: "http://localhost:12345/v1",
      TASK_MCP_LM_STUDIO_API_TOKEN: "local-token",
      TASK_MCP_LM_STUDIO_MODEL: "custom-local-model",
    });
    expect(envConfig.dataRoot).toBe(resolve(homedir(), "generic-tasks"));
    expect(envConfig.timezone).toBe("Asia/Tokyo");
    expect(envConfig.codexAppServerModel).toBe("custom-model");
    expect(envConfig.codexAppServerCommand).toBe("/Applications/ChatGPT.app/Contents/Resources/codex");
    expect(envConfig.reportLlmProvider).toBe("claude_cli");
    expect(envConfig.claudeCliModel).toBe("custom-claude");
    expect(envConfig.copilotCliModel).toBe("custom-copilot");
    expect(envConfig.cursorCliModel).toBe("custom-cursor");
    expect(envConfig.geminiCliModel).toBe("custom-gemini");
    expect(envConfig.lmStudioBaseUrl).toBe("http://localhost:12345/v1");
    expect(envConfig.lmStudioApiToken).toBe("local-token");
    expect(envConfig.lmStudioModel).toBe("custom-local-model");

    const cliConfig = loadConfig(["node", "task-mcp", "--data-root", "/tmp/task-mcp-data"], {
      TASK_MCP_DATA_ROOT: "~/ignored",
    });
    expect(cliConfig.dataRoot).toBe("/tmp/task-mcp-data");
  });

  it("allows layout overrides for existing task directories", () => {
    const config = loadConfig(["node", "task-mcp"], {
      TASK_MCP_DATA_ROOT: "/tmp/existing-tasks",
      TASK_MCP_LAYOUT_CONTEXTS: "task_contexts",
      TASK_MCP_LAYOUT_INPUTS: "inbox",
      TASK_MCP_LAYOUT_ACTIVITIES: "journal",
      TASK_MCP_LAYOUT_REPORTS: "report",
      TASK_MCP_LAYOUT_OUTPUTS: "reports",
      TASK_MCP_LAYOUT_AGENT_UPDATES: "agent_updates",
      TASK_MCP_LAYOUT_KNOWLEDGE: "knowledge_base",
    });

    expect(config.layout).toMatchObject({
      contexts: "task_contexts",
      inputs: "inbox",
      activities: "journal",
      reports: "report",
      outputs: "reports",
      agentUpdates: "agent_updates",
      knowledge: "knowledge_base",
    });
  });

  it("loads profile date settings and lets environment variables override them", () => {
    const dataRoot = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "task-mcp-config-"));
    mkdirSync(join(dataRoot, "config"));
    writeFileSync(
      join(dataRoot, "config", "profile.yaml"),
      "timezone: Asia/Tokyo\nactivity_rollover_hour: 4\n",
      "utf8",
    );

    const profileConfig = loadConfig(["node", "task-mcp", "--data-root", dataRoot], {});
    expect(profileConfig).toMatchObject({ timezone: "Asia/Tokyo", activityRolloverHour: 4 });

    const envConfig = loadConfig(["node", "task-mcp", "--data-root", dataRoot], {
      TASK_MCP_TIMEZONE: "UTC",
      TASK_MCP_ACTIVITY_ROLLOVER_HOUR: "2",
    });
    expect(envConfig).toMatchObject({ timezone: "UTC", activityRolloverHour: 2 });
  });

  it("loads backup retention settings and rejects invalid period ordering", () => {
    const dataRoot = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "task-mcp-maintenance-config-"));
    mkdirSync(join(dataRoot, "config"));
    writeFileSync(
      join(dataRoot, "config", "maintenance.yaml"),
      [
        "backup_cleanup:",
        "  enabled: false",
        '  run_at: "04:30"',
        "  keep_all_days: 3",
        "  keep_daily_days: 14",
        "  keep_weekly_days: 90",
        "  keep_monthly_days: 730",
        "  archive_grace_days: 45",
        "  max_versions_per_file_per_day: 2",
        "",
      ].join("\n"),
      "utf8",
    );

    expect(loadConfig(["node", "task-mcp", "--data-root", dataRoot], {}).backupCleanup).toEqual({
      enabled: false,
      runAt: "04:30",
      keepAllDays: 3,
      keepDailyDays: 14,
      keepWeeklyDays: 90,
      keepMonthlyDays: 730,
      archiveGraceDays: 45,
      maxVersionsPerFilePerDay: 2,
    });

    expect(() =>
      loadConfig(["node", "task-mcp", "--data-root", dataRoot], {
        TASK_MCP_BACKUP_KEEP_ALL_DAYS: "31",
        TASK_MCP_BACKUP_KEEP_DAILY_DAYS: "30",
      }),
    ).toThrow("Retention periods");
  });
});
