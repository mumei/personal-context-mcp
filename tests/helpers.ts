import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultBackupCleanup, defaultLayout } from "#infra/config/config";
import { Repository } from "#infra/repository/repository";
import type { TaskMcpConfig } from "#shared/types";

export async function createTempRepo(): Promise<{ repo: Repository; config: TaskMcpConfig }> {
  const dataRoot = await mkdtemp(join(tmpdir(), "task-mcp-test-"));
  const config: TaskMcpConfig = {
    dataRoot,
    timezone: "UTC",
    defaultLookbackDays: 7,
    activityRolloverHour: 0,
    defaultRenderer: "markdown",
    reportLlmProvider: "auto",
    codexAppServerCommand: "codex",
    codexAppServerArgs: ["app-server", "--listen", "stdio://"],
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
  return { repo: new Repository(config), config };
}
