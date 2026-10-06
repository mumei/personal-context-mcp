import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dailyAutomationPath,
  loadDailyAutomationSettings,
  updateDailyAutomationSettings,
} from "#infra/config/dailyAutomation";

const sample = `version = 1
id = "automation"
name = "モーニングブリーフ"
prompt = "first\\nsecond"
status = "ACTIVE"
rrule = "RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=30"
model = "gpt-5.6-terra"
reasoning_effort = "medium"
execution_environment = "local"
target = { type = "project", project_id = "/tmp/project" }
updated_at = 1
`;

const heartbeatSample = `version = 1
id = "automation"
kind = "heartbeat"
name = "ブリーフィング"
prompt = "Use briefing_generate_daily"
status = "ACTIVE"
rrule = "RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=30"
target_thread_id = "thread-1"
updated_at = 1
`;

describe("daily automation settings", () => {
  it("uses only the Codex-specific override path", () => {
    expect(dailyAutomationPath({ TASK_MCP_CODEX_DAILY_AUTOMATION_PATH: "/tmp/codex.toml" })).toBe("/tmp/codex.toml");
  });

  it("loads and updates known fields while preserving unrelated TOML", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-automation-"));
    const path = join(root, "automation.toml");
    await writeFile(path, sample, "utf8");

    expect(await loadDailyAutomationSettings(path)).toMatchObject({
      name: "モーニングブリーフ",
      prompt: "first\nsecond",
      status: "ACTIVE",
    });
    const updated = await updateDailyAutomationSettings(
      {
        name: "Daily brief",
        prompt: "updated\nprompt",
        status: "PAUSED",
        rrule: "RRULE:FREQ=DAILY;BYHOUR=8;BYMINUTE=0",
        model: "gpt-5.6-sol",
        reasoning_effort: "high",
        workspace: "/tmp/updated-project",
      },
      path,
    );

    expect(updated).toMatchObject({
      name: "Daily brief",
      prompt: "updated\nprompt",
      status: "PAUSED",
      model: "gpt-5.6-sol",
    });
    expect(await readFile(path, "utf8")).toContain(
      'target = { type = "project", project_id = "/tmp/updated-project" }',
    );
  });

  it("rejects invalid schedules without changing the file", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-automation-"));
    const path = join(root, "automation.toml");
    await writeFile(path, sample, "utf8");

    await expect(
      updateDailyAutomationSettings(
        {
          name: "Daily brief",
          prompt: "prompt",
          status: "ACTIVE",
          rrule: "every day",
          model: "gpt-5.6-sol",
          reasoning_effort: "medium",
        },
        path,
      ),
    ).rejects.toThrow("RRULE");
    expect(await readFile(path, "utf8")).toBe(sample);
  });

  it("loads and updates heartbeat automations without unsupported model fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-automation-"));
    const path = join(root, "automation.toml");
    await writeFile(path, heartbeatSample, "utf8");

    expect(await loadDailyAutomationSettings(path)).toMatchObject({
      name: "ブリーフィング",
      model: "",
      reasoning_effort: "medium",
      execution_environment: "thread",
    });
    await updateDailyAutomationSettings(
      {
        name: "Daily briefing",
        prompt: "Use briefing_generate_daily once",
        status: "ACTIVE",
        rrule: "RRULE:FREQ=DAILY;BYHOUR=8;BYMINUTE=0",
        model: "gpt-5.6-sol",
        reasoning_effort: "high",
        workspace: "/tmp/project",
      },
      path,
    );

    const text = await readFile(path, "utf8");
    expect(text).toContain('name = "Daily briefing"');
    expect(text).toContain('target_thread_id = "thread-1"');
    expect(text).not.toContain("reasoning_effort");
    expect(text).not.toContain('model = "gpt-5.6-sol"');
  });
});
