import { describe, expect, it, vi } from "vitest";
import { finishTaskSession } from "#domain/sessions/finishTask";
import { createTempRepo } from "./helpers.ts";

describe("finalize safety", () => {
  it("keeps finish_task_session dry-run completely read-only", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Task", status: "inProgress" }],
      },
      "seed",
    );
    const reportGenerator = vi.fn();

    const result = await finishTaskSession(repo, "2026-07-10", {
      session_id: "session-preview",
      source: "codex",
      task_id: "task-1",
      summary: "Preview only",
      done: ["Would be recorded"],
      confidence: "high",
      dry_run: true,
      report_entry_generator: reportGenerator,
    });

    expect(result.dry_run).toBe(true);
    expect(result.finalize.apply.entries).toMatchObject([{ task_id: "task-1", done: ["Would be recorded"] }]);
    expect(reportGenerator).not.toHaveBeenCalled();
    await expect(repo.loadAgentUpdates("2026-07-10")).resolves.toEqual({
      date: "2026-07-10",
      updates: [],
    });
    await expect(repo.loadActivity("2026-07-10")).resolves.toEqual({
      date: "2026-07-10",
      entries: [],
    });
  });

  it("resumes the same session without duplicating queue or activity records", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Task", status: "inProgress" }],
      },
      "seed",
    );
    const input = {
      session_id: "session-resume",
      source: "codex",
      task_id: "task-1",
      summary: "Resume-safe session",
      done: ["Saved once"],
      confidence: "high" as const,
      dry_run: false,
      formats: ["text" as const],
    };

    const first = await finishTaskSession(repo, "2026-07-10", input);
    const second = await finishTaskSession(repo, "2026-07-10", input);
    const queue = await repo.loadAgentUpdates("2026-07-10");
    const activity = await repo.loadActivity("2026-07-10");

    expect(second.submitted.update.update_id).toBe(first.submitted.update.update_id);
    expect(queue.updates).toHaveLength(1);
    expect(activity.entries).toHaveLength(1);
  });

  it("finalizes a high-confidence completion without a review queue", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Task", status: "inProgress" }],
      },
      "seed",
    );

    const result = await finishTaskSession(repo, "2026-07-10", {
      session_id: "session-complete",
      source: "codex",
      task_id: "task-1",
      summary: "Completed the task",
      done: ["Completion verified"],
      status_suggestion: "done",
      confidence: "high",
      dry_run: false,
      formats: ["text"],
    });

    expect(result.submitted.update.status).toBe("applied");
    expect(result.message).not.toContain("review is required");
    await expect(repo.loadActivity("2026-07-10")).resolves.toMatchObject({
      entries: [{ task_id: "task-1", status: "done", done: ["Completion verified"] }],
    });
  });
});
