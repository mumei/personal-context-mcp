import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultBackupCleanup, defaultLayout } from "#infra/config/config";
import {
  loadStoredProfileSettings,
  parseActivityRolloverHour,
  profileSettingsView,
  updateProfileSettings,
  validateActivityRolloverHour,
  validateTimezone,
} from "#infra/config/profileSettings";
import { Repository } from "#infra/repository/repository";
import type { TaskMcpConfig } from "#shared/types";

async function setup() {
  const dataRoot = await mkdtemp(join(tmpdir(), "task-mcp-profile-"));
  const config: TaskMcpConfig = {
    dataRoot,
    timezone: "UTC",
    activityRolloverHour: 0,
    defaultLookbackDays: 7,
    defaultRenderer: "markdown",
    reportLlmProvider: "codex_app_server",
    codexAppServerCommand: "codex",
    codexAppServerArgs: [],
    codexAppServerTimeoutMs: 120000,
    claudeCliCommand: "claude",
    claudeCliArgs: [],
    claudeCliModel: "claude-sonnet-4-6",
    claudeCliTimeoutMs: 120000,
    copilotCliCommand: "copilot",
    copilotCliArgs: [],
    copilotCliModel: "gpt-5.3-codex",
    copilotCliTimeoutMs: 120000,
    cursorCliCommand: "cursor-agent",
    cursorCliArgs: [],
    cursorCliModel: "gpt-5",
    cursorCliTimeoutMs: 120000,
    geminiCliCommand: "gemini",
    geminiCliArgs: [],
    geminiCliModel: "gemini-2.5-pro",
    geminiCliTimeoutMs: 120000,
    lmStudioBaseUrl: "http://127.0.0.1:1234/v1",
    lmStudioModel: "openai/gpt-oss-20b",
    lmStudioTimeoutMs: 120000,
    backupCleanup: { ...defaultBackupCleanup },
    layout: defaultLayout,
  };
  return { dataRoot, config, repo: new Repository(config) };
}

describe("profile settings", () => {
  it("persists timezone and rollover hour and updates the live config", async () => {
    const { dataRoot, config, repo } = await setup();
    await repo.saveActivity(
      "2026-07-15",
      {
        date: "2026-07-15",
        entries: [{ activity_id: "before-rollover", task_id: "task-1", occurred_at: "2026-07-15T03:00:00+09:00" }],
      },
      "seed",
    );

    const result = await updateProfileSettings(
      repo,
      config,
      {
        timezone: "Asia/Tokyo",
        activity_rollover_hour: 4,
      },
      {},
    );

    expect(result).toMatchObject({ timezone: "Asia/Tokyo", activity_rollover_hour: 4 });
    expect(result.activity_repartition).toMatchObject({ moved_entries: 1, unresolved_legacy_entries: 0 });
    await expect(repo.loadActivity("2026-07-14")).resolves.toMatchObject({
      entries: [expect.objectContaining({ activity_id: "before-rollover" })],
    });
    expect(config).toMatchObject({ timezone: "Asia/Tokyo", activityRolloverHour: 4 });
    expect(loadStoredProfileSettings(dataRoot)).toEqual({ timezone: "Asia/Tokyo", activity_rollover_hour: 4 });
    await expect(readFile(join(dataRoot, "config", "profile.yaml"), "utf8")).resolves.toContain(
      "activity_rollover_hour: 4",
    );
  });

  it("reports and preserves environment overrides", async () => {
    const { config, repo } = await setup();
    const env = { TASK_MCP_TIMEZONE: "UTC", TASK_MCP_ACTIVITY_ROLLOVER_HOUR: "2" };

    await updateProfileSettings(repo, config, { timezone: "Asia/Tokyo", activity_rollover_hour: 4 }, env);

    expect(config).toMatchObject({ timezone: "UTC", activityRolloverHour: 0 });
    expect(profileSettingsView(config, env)).toMatchObject({
      timezone_overridden_by_environment: true,
      activity_rollover_hour_overridden_by_environment: true,
    });
  });

  it("validates timezone and rollover values", () => {
    expect(validateTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(() => validateTimezone("Not/AZone")).toThrow("Unsupported timezone");
    expect(validateActivityRolloverHour(23)).toBe(23);
    expect(() => validateActivityRolloverHour(24)).toThrow("0 to 23");
    expect(parseActivityRolloverHour("２３")).toBe(23);
    expect(parseActivityRolloverHour(" ４ ")).toBe(4);
    expect(() => parseActivityRolloverHour("2.5")).toThrow("0 to 23");
    expect(() => parseActivityRolloverHour("２４")).toThrow("0 to 23");
  });
});
