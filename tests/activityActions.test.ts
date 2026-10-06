import { describe, expect, it } from "vitest";
import { appendActivityEntry } from "#domain/activities/actions";
import { createTempRepo } from "./helpers.ts";

const date = "2026-07-11";

describe("appendActivityEntry", () => {
  it("always appends a new immutable journal entry", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1" }] }, "seed-tasks");
    await repo.saveActivity(
      date,
      {
        date,
        entries: [{ activity_id: "existing", task_id: "task-1", done: ["first"] }],
      },
      "seed",
    );

    const result = await appendActivityEntry(
      repo,
      date,
      {
        task_id: "task-1",
        done: ["second"],
        next: ["continue"],
      },
      new Date("2026-07-11T01:02:03.000Z"),
    );

    expect(result.entry.activity_id).toEqual(expect.any(String));
    expect(result.entry.activity_id).not.toBe("existing");
    await expect(repo.loadActivity(date)).resolves.toEqual({
      date,
      entries: [
        { activity_id: "existing", task_id: "task-1", done: ["first"] },
        expect.objectContaining({
          task_id: "task-1",
          done: ["second"],
          next: ["continue"],
          occurred_at: "2026-07-11T01:02:03.000Z",
          recorded_at: "2026-07-11T01:02:03.000Z",
        }),
      ],
    });
  });

  it("does not expose a mutation mode or activity selector", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1" }] }, "seed-tasks");
    const result = await appendActivityEntry(repo, date, { task_id: "task-1", done: ["fact"] });

    expect(result).not.toHaveProperty("mode");
    expect(result).not.toHaveProperty("removed");
  });

  it("normalizes a declared Activity alias to the canonical task id", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      { tasks: [{ id: "task-current", title: "Current task", activity_aliases: ["task-legacy"] }] },
      "seed-tasks",
    );

    const result = await appendActivityEntry(repo, date, { task_id: "task-legacy", done: ["fact"] });

    expect(result.task_id).toBe("task-current");
    expect(result.entry.task_id).toBe("task-current");
  });

  it("rejects an unknown task id before appending", async () => {
    const { repo } = await createTempRepo();

    await expect(appendActivityEntry(repo, date, { task_id: "missing", done: ["fact"] })).rejects.toThrow(
      "Unknown task_id: missing",
    );
    await expect(repo.loadActivity(date)).resolves.toEqual({ date, entries: [] });
  });
});
