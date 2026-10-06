import { describe, expect, it } from "vitest";
import { submitAgentUpdate } from "#domain/agent-updates/workflow";
import { updateAgentUpdateStatus } from "#domain/agent-updates/actions";
import { appendActivityEntry } from "#domain/activities/actions";
import { listDataDates, listOutputDates } from "#app/catalog";
import { finalizeDaily } from "#domain/sessions/finishTask";
import { upsertInputItem } from "#domain/inputs/actions";
import { updateTask, updateTaskContext } from "#domain/tasks/actions";
import { validateData } from "#app/validation";
import { createTempRepo } from "./helpers.ts";

describe("update tools", () => {
  it("keeps done status and completed_on consistent", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task", status: "inProgress" }] }, "seed");

    await expect(updateTask(repo, { task_id: "task-1", status: "done" })).rejects.toThrow("completed_on is required");
    const done = await updateTask(repo, { task_id: "task-1", status: "done", completed_on: "2026-07-12" });
    expect(done.task).toMatchObject({ status: "done", completed_on: "2026-07-12" });

    const reopened = await updateTask(repo, { task_id: "task-1", status: "inProgress" });
    expect(reopened.task.status).toBe("inProgress");
    expect(reopened.task.completed_on).toBeUndefined();
  });

  it("updates an existing task and its long-lived context", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          {
            id: "task-1",
            title: "Old title",
            status: "todo",
            context: "contexts/task-1.md",
          },
        ],
      },
      "seed",
    );
    await repo.saveTaskContext(
      { id: "task-1", title: "Old title", context: "contexts/task-1.md" },
      { data: { compact_summary: ["old"] }, body: "Body" },
      "seed-context",
    );

    const taskResult = await updateTask(repo, {
      task_id: "task-1",
      title: "New title",
      status: "inProgress",
      tier: 1,
      due: "2026-07-10",
      blocked_by: ["review"],
    });
    const contextResult = await updateTaskContext(repo, {
      task_id: "task-1",
      compact_summary: ["new summary"],
      frontmatter: { owner: "ai" },
      body: "Added note",
      body_mode: "append",
    });

    expect(taskResult.task).toMatchObject({
      id: "task-1",
      title: "New title",
      status: "inProgress",
      tier: 1,
      due: "2026-07-10",
      blocked_by: ["review"],
    });
    expect(contextResult.context.data).toMatchObject({
      compact_summary: ["new summary"],
      owner: "ai",
    });
    expect(contextResult.context.body).toContain("Body\n\nAdded note");
  });

  it("upserts activity and input entries", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1" }] }, "seed-tasks");

    await appendActivityEntry(repo, "2026-07-04", {
      task_id: "task-1",
      done: ["first"],
    });
    await appendActivityEntry(repo, "2026-07-04", {
      task_id: "task-1",
      done: ["second"],
      next: ["next"],
    });
    await upsertInputItem(repo, "2026-07-04", {
      title: "Mail item",
      source: "mail",
      mode: "replace",
      summary: ["initial"],
      action_required: true,
    });
    await upsertInputItem(repo, "2026-07-04", {
      title: "Mail item",
      source: "mail",
      mode: "append",
      summary: ["initial", "follow up"],
      related_task_id: "task-1",
    });

    await expect(repo.loadActivity("2026-07-04")).resolves.toMatchObject({
      entries: [
        { task_id: "task-1", done: ["first"] },
        { task_id: "task-1", done: ["second"], next: ["next"] },
      ],
    });
    await expect(repo.loadInputs("2026-07-04")).resolves.toMatchObject({
      items: [{ title: "Mail item", source: "mail", summary: ["initial", "follow up"], related_task_id: "task-1" }],
    });
  });

  it("uses stable input ids and activity idempotency keys", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1" }] }, "seed-tasks");

    const firstInput = await upsertInputItem(repo, "2026-07-04", {
      input_id: "input-mail-1",
      title: "Mail item",
      source: "mail",
      mode: "replace",
      summary: ["initial"],
    });
    await upsertInputItem(repo, "2026-07-04", {
      input_id: "input-mail-1",
      title: "Renamed mail item",
      source: "mail",
      mode: "append",
      summary: ["follow up"],
    });

    const firstActivity = await appendActivityEntry(repo, "2026-07-04", {
      task_id: "task-1",
      idempotency_key: "session-1:task-1",
      done: ["recorded once"],
    });
    const duplicateActivity = await appendActivityEntry(repo, "2026-07-04", {
      task_id: "task-1",
      idempotency_key: "session-1:task-1",
      done: ["must not replace the journal entry"],
    });

    expect(firstInput.item?.input_id).toBe("input-mail-1");
    await expect(repo.loadInputs("2026-07-04")).resolves.toMatchObject({
      items: [{ input_id: "input-mail-1", title: "Renamed mail item", summary: ["initial", "follow up"] }],
    });
    expect(duplicateActivity.entry).toEqual(firstActivity.entry);
    await expect(repo.loadActivity("2026-07-04")).resolves.toMatchObject({
      entries: [{ idempotency_key: "session-1:task-1", done: ["recorded once"] }],
    });
  });

  it("changes queued agent update status and finalizes reports", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Task", status: "inProgress", tier: 1 }],
      },
      "seed",
    );
    const submitted = await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "session-1",
      source: "codex",
      task_id: "task-1",
      summary: "low confidence",
      done: ["done item"],
      confidence: "low",
    });

    expect(submitted.update.status).toBe("needs_review");
    await updateAgentUpdateStatus(repo, "2026-07-04", {
      update_id: submitted.update.update_id,
      status: "pending",
      note: "approved",
    });
    const preview = await finalizeDaily(repo, "2026-07-04", { dry_run: true });
    const result = await finalizeDaily(repo, "2026-07-04", { dry_run: false, formats: ["text", "markdown"] });

    expect(preview.dry_run).toBe(true);
    expect(result.reports).toHaveLength(2);
    await expect(repo.loadOutput("text", "2026-07-04", "txt")).resolves.toContain("done item");
    await expect(repo.loadOutput("markdown", "2026-07-04", "md")).resolves.toContain("done item");
  });

  it("rejects marking an agent update applied without applying its activity", async () => {
    const { repo } = await createTempRepo();
    const submitted = await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "session-status",
      source: "codex",
      task_id: "task-1",
      summary: "must use apply flow",
      done: ["journal write required"],
    });

    await expect(
      updateAgentUpdateStatus(repo, "2026-07-04", {
        update_id: submitted.update.update_id,
        status: "applied",
      }),
    ).rejects.toThrow("Use apply_agent_updates");
    await expect(repo.loadActivity("2026-07-04")).resolves.toEqual({ date: "2026-07-04", entries: [] });
  });

  it("lists dates and validates data references", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Task", status: "todo" }],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-04",
      { date: "2026-07-04", entries: [{ task_id: "missing", done: ["x"] }] },
      "seed",
    );
    await repo.saveReport("2026-07-04", { date: "2026-07-04", entries: [{ task_id: "task-1", done: ["x"] }] }, "seed");
    await repo.saveOutput("text", "2026-07-04", "output", "seed", "txt");

    const dates = await listDataDates(repo);
    const outputs = await listOutputDates(repo, "text", "txt");
    const validation = await validateData(repo);

    expect(dates.activities).toEqual(["2026-07-04"]);
    expect(dates.reports).toEqual(["2026-07-04"]);
    expect(outputs.dates).toEqual(["2026-07-04"]);
    expect(validation.ok).toBe(true);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        task_id: "missing",
      }),
    );
  });

  it("validates extended sources and continues after a malformed dated file", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task", status: "todo" }] }, "seed");
    await repo.saveInputs(
      "2026-07-04",
      {
        date: "2026-07-03",
        items: [{ title: "Input", related_task_id: "missing" }],
      },
      "seed",
    );
    await repo.saveAgentUpdates(
      "2026-07-04",
      {
        date: "2026-07-04",
        updates: [
          {
            update_id: "update-1",
            session_id: "session-1",
            source: "codex",
            status: "pending",
            received_at: "2026-07-04T00:00:00Z",
            summary: "unknown task",
            task_id: "missing",
          },
        ],
      },
      "seed",
    );
    await repo.saveMemorySummaries(
      "2026-07-04",
      {
        date: "2026-07-04",
        summaries: [
          {
            summary_id: "summary-1",
            status: "pending",
            target_type: "task",
            task_id: "missing",
            created_at: "2026-07-04T00:00:00Z",
          },
        ],
      },
      "seed",
    );
    await repo.writeText(repo.layoutPath("reports", "2026-07-04.yaml"), "date: [broken", "seed");
    await repo.writeText(repo.layoutPath("contexts", "orphan.md"), "orphan", "seed");
    await repo.writeText(repo.layoutPath("taskMemory", "orphan.yaml"), "task_id: orphan", "seed");

    const validation = await validateData(repo);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: repo.layoutPath("inputs", "2026-07-04.yaml"), severity: "error" }),
        expect.objectContaining({ path: repo.layoutPath("reports", "2026-07-04.yaml"), severity: "error" }),
        expect.objectContaining({
          path: repo.layoutPath("contexts", "orphan.md"),
          message: expect.stringContaining("Orphan context"),
        }),
        expect.objectContaining({
          path: repo.layoutPath("taskMemory", "orphan.yaml"),
          message: expect.stringContaining("Orphan task memory"),
        }),
        expect.objectContaining({ task_id: "missing", message: expect.stringContaining("Input item") }),
        expect.objectContaining({ task_id: "missing", message: expect.stringContaining("Agent update") }),
        expect.objectContaining({ task_id: "missing", message: expect.stringContaining("Memory summary") }),
      ]),
    );
  });
});
