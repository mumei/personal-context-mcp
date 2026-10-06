import { describe, expect, it } from "vitest";
import { applyAgentUpdates, applyAgentUpdatesDryRun, submitAgentUpdate } from "#domain/agent-updates/workflow";
import { finishTaskSession } from "#domain/sessions/finishTask";
import { generateReportEntriesFromActivities } from "#domain/reports/actions";
import { renderTextReport } from "#domain/reports/render";
import { addTask } from "#domain/tasks/actions";
import { createTempRepo } from "./helpers.ts";

describe("AI usage workflow", () => {
  it("shows a newly added task in the Tier list but not in today's diff until an update is applied", async () => {
    const { repo } = await createTempRepo();

    await addTask(repo, {
      id: "rhoco-101",
      project: "rhoco",
      title: "#101 引用表示修正",
      status: "inProgress",
      tier: 1,
      compact_summary: ["引用表示を修正する"],
    });

    const reportBeforeUpdate = await renderTextReport(repo, "2026-07-04");
    expect(reportBeforeUpdate).toContain("▶ [ rhoco ] #101 引用表示修正");
    expect(reportBeforeUpdate).not.toContain("本日差分・状況報告");
    expect(reportBeforeUpdate).not.toContain("- 大きな状況更新なし");
    expect(reportBeforeUpdate).not.toContain("  - やったこと:");

    await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "session-1",
      source: "codex",
      task_id: "rhoco-101",
      summary: "#101の修正状況を反映",
      done: ["引用表示を確認した"],
      next: ["再回答時の引用元選択を修正する"],
      confidence: "high",
    });

    await applyAgentUpdates(repo, "2026-07-04");
    await generateReportEntriesFromActivities(repo, "2026-07-04");
    const reportAfterUpdate = await renderTextReport(repo, "2026-07-04");

    expect(reportAfterUpdate).toContain("[ in progress ]");
    expect(reportAfterUpdate).toContain("▶ [ rhoco ] #101 引用表示修正");
    expect(reportAfterUpdate).toContain("  - やったこと:");
    expect(reportAfterUpdate).toContain("      - 引用表示を確認した");
    expect(reportAfterUpdate).toContain("  - これからやること:");
    expect(reportAfterUpdate).toContain("      - 再回答時の引用元選択を修正する");
    expect(reportAfterUpdate).not.toContain("  - 確認:");
  });

  it("keeps dry-run previews out of activities and reports", async () => {
    const { repo } = await createTempRepo();
    await addTask(repo, {
      id: "task-1",
      project: "Project",
      title: "Dry-run task",
      status: "inProgress",
      tier: 1,
    });
    await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "session-1",
      source: "codex",
      task_id: "task-1",
      summary: "Preview only",
      done: ["This should not be persisted by dry-run"],
      confidence: "high",
    });

    const preview = await applyAgentUpdatesDryRun(repo, "2026-07-04");

    expect(preview.entries).toHaveLength(1);
    await expect(repo.loadActivity("2026-07-04")).resolves.toEqual({ date: "2026-07-04", entries: [] });
    await expect(repo.loadReport("2026-07-04")).resolves.toEqual({ date: "2026-07-04", entries: [] });
  });

  it("finishes a task session by submitting, applying, and generating selected reports", async () => {
    const { repo } = await createTempRepo();
    await addTask(repo, {
      id: "task-1",
      project: "Project",
      title: "Finish session task",
      status: "inProgress",
      tier: 1,
    });

    const result = await finishTaskSession(repo, "2026-07-04", {
      session_id: "session-finish",
      source: "codex",
      task_id: "task-1",
      summary: "Finished session update",
      done: ["Implemented finish flow"],
      next: ["Use one MCP tool at session end"],
      confidence: "high",
      formats: ["text", "markdown", "html"],
    });

    expect(result.submitted.update.status).toBe("applied");
    expect(result.finalize.apply.entries).toHaveLength(1);
    expect(result.finalize.reports).toHaveLength(3);
    await expect(repo.loadActivity("2026-07-04")).resolves.toMatchObject({
      entries: [{ task_id: "task-1", done: ["Implemented finish flow"] }],
    });
    await expect(repo.loadReport("2026-07-04")).resolves.toMatchObject({
      entries: [{ task_id: "task-1", next: ["Use one MCP tool at session end"] }],
    });
    await expect(repo.loadOutput("text", "2026-07-04", "txt")).resolves.toContain("Implemented finish flow");
    await expect(repo.loadOutput("markdown", "2026-07-04", "md")).resolves.toContain("Implemented finish flow");
    await expect(repo.loadOutput("html", "2026-07-04", "html")).resolves.toContain("Implemented finish flow");
  });
});
