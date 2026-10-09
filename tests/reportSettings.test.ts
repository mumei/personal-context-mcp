import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultBackupCleanup, defaultLayout } from "#infra/config/config";
import {
  loadReportSettings,
  reportSettingsPath,
  updateReportSettings,
  validateWeekStartDay,
} from "#infra/config/reportSettings";
import { Repository } from "#infra/repository/repository";
import type { TaskMcpConfig } from "#shared/types";

async function setup() {
  const dataRoot = await mkdtemp(join(tmpdir(), "task-mcp-report-settings-"));
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
  return { dataRoot, repo: new Repository(config) };
}

describe("report settings", () => {
  it("defaults to Monday without creating or changing other settings", async () => {
    const { dataRoot, repo } = await setup();
    expect(loadReportSettings(dataRoot)).toEqual({ week_start_day: 1 });
    await expect(readFile(reportSettingsPath(dataRoot), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(dataRoot, "config", "profile.yaml"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(repo.root).toBe(dataRoot);
  });

  it("persists each supported weekday independently", async () => {
    const { dataRoot, repo } = await setup();
    const result = await updateReportSettings(repo, { week_start_day: 0 });

    expect(result).toEqual({ week_start_day: 0, path: reportSettingsPath(dataRoot) });
    expect(loadReportSettings(dataRoot)).toEqual({ week_start_day: 0 });
    await expect(readFile(reportSettingsPath(dataRoot), "utf8")).resolves.toContain("week_start_day: 0");
  });

  it("defaults a missing key but rejects malformed stored documents", async () => {
    const { dataRoot } = await setup();
    const path = reportSettingsPath(dataRoot);
    await mkdir(join(dataRoot, "config"), { recursive: true });
    await writeFile(path, "other: true\n");
    expect(loadReportSettings(dataRoot)).toEqual({ week_start_day: 1 });
    await writeFile(path, "week_start_day: 7\n");
    expect(() => loadReportSettings(dataRoot)).toThrow("0 to 6");
    await writeFile(path, "- invalid\n");
    expect(() => loadReportSettings(dataRoot)).toThrow("YAML object");
  });

  it("strictly validates updates", async () => {
    const { repo } = await setup();
    for (const value of [-1, 7, 1.5, "1", null]) {
      expect(() => validateWeekStartDay(value)).toThrow("0 to 6");
      await expect(updateReportSettings(repo, { week_start_day: value as number })).rejects.toThrow("0 to 6");
    }
    await expect(updateReportSettings(repo, { week_start_day: 1, extra: true } as never)).rejects.toThrow(
      "only week_start_day",
    );
  });
});
