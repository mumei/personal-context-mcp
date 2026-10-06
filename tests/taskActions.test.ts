import { describe, expect, it } from "vitest";
import { addTask, deleteTask, restoreTask, setTaskReportVisibility, updateTask } from "#domain/tasks/actions";
import { createTempRepo } from "./helpers.ts";

describe("task actions", () => {
  it("adds a task and creates its context file", async () => {
    const { repo } = await createTempRepo();

    const result = await addTask(repo, {
      id: "new-task",
      project: "Project",
      title: "New task",
      tier: 2,
      status: "inProgress",
      due: "2026-07-31",
      compact_summary: ["Initial summary"],
      context_body: "Long context\n",
    });

    expect(result.task).toEqual({
      id: "new-task",
      project: "Project",
      title: "New task",
      tier: 2,
      status: "inProgress",
      due: "2026-07-31",
      context: "contexts/new-task.md",
    });
    await expect(repo.loadTasks()).resolves.toMatchObject({
      tasks: [result.task],
    });
    await expect(repo.loadTaskContext(result.task)).resolves.toEqual({
      data: { compact_summary: ["Initial summary"] },
      body: "Long context\n",
    });
  });

  it("rejects duplicate task ids", async () => {
    const { repo } = await createTempRepo();
    await addTask(repo, {
      id: "new-task",
      title: "New task",
    });

    await expect(
      addTask(repo, {
        id: "new-task",
        title: "Duplicate task",
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("stores Activity aliases and rejects identity collisions", async () => {
    const { repo } = await createTempRepo();
    await addTask(repo, { id: "task-1", title: "Task 1" });
    await addTask(repo, { id: "task-2", title: "Task 2" });

    const updated = await updateTask(repo, { task_id: "task-1", activity_aliases: [" legacy-id "] });
    expect(updated.task.activity_aliases).toEqual(["legacy-id"]);
    await expect(updateTask(repo, { task_id: "task-2", activity_aliases: ["legacy-id"] })).rejects.toThrow(
      "conflicts with another task identity",
    );
  });

  it("logically deletes and restores a task without removing related data", async () => {
    const { repo } = await createTempRepo();
    const added = await addTask(repo, {
      id: "duplicate-task",
      title: "Duplicate task",
      context_body: "Preserved context",
    });
    await repo.saveTaskMemory(
      "duplicate-task",
      {
        task_id: "duplicate-task",
        summary: ["Preserved memory"],
      },
      "seed-memory",
    );

    const deleted = await deleteTask(repo, "duplicate-task");

    expect(deleted.task.deleted).toBe(true);
    await expect(updateTask(repo, { task_id: "duplicate-task", title: "Hidden" })).rejects.toThrow(/not found/);
    await expect(repo.loadTaskContext(added.task)).resolves.toMatchObject({ body: "Preserved context" });
    await expect(repo.loadTaskMemory("duplicate-task")).resolves.toMatchObject({ summary: ["Preserved memory"] });
    await expect(deleteTask(repo, "duplicate-task")).resolves.toMatchObject({ save: { changed: false } });

    const restored = await restoreTask(repo, "duplicate-task");
    expect(restored.task).not.toHaveProperty("deleted");
    await expect(restoreTask(repo, "duplicate-task")).resolves.toMatchObject({ save: { changed: false } });
  });

  it("excludes and restores a task in reports without changing its stored data", async () => {
    const { repo } = await createTempRepo();
    const added = await addTask(repo, {
      id: "quiet-task",
      title: "Quiet task",
      context_body: "Preserved context",
    });
    await repo.saveTaskMemory("quiet-task", { task_id: "quiet-task", facts: ["Preserved fact"] }, "seed-memory");

    const excluded = await setTaskReportVisibility(repo, "quiet-task", false);

    expect(excluded).toMatchObject({ visible: false, task: { report_exclude: true } });
    await expect(repo.loadTaskContext(added.task)).resolves.toMatchObject({ body: "Preserved context" });
    await expect(repo.loadTaskMemory("quiet-task")).resolves.toMatchObject({ facts: ["Preserved fact"] });

    const included = await setTaskReportVisibility(repo, "quiet-task", true);
    expect(included.visible).toBe(true);
    expect(included.task).not.toHaveProperty("report_exclude");
  });
});
