import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createTempRepo } from "./helpers.ts";

describe("Repository", () => {
  it("loads and saves task documents under the configured data root", async () => {
    const { repo } = await createTempRepo();

    expect(await repo.loadTasks()).toEqual({ tasks: [] });

    await repo.saveTasks(
      {
        tasks: [
          {
            id: "task-1",
            title: "Generic task",
            status: "todo",
            context: "contexts/task-1.md",
          },
        ],
      },
      "test-save",
    );

    const saved = await readFile(repo.layoutPath("tasks"), "utf8");
    expect(saved).toContain("task-1");
    expect(await repo.loadTasks()).toMatchObject({
      tasks: [{ id: "task-1", title: "Generic task" }],
    });
  });

  it("rejects paths outside the data root", async () => {
    const { repo } = await createTempRepo();

    expect(() => repo.pathFor("../outside.yaml")).toThrow(/Unsafe path/);
    expect(() => repo.pathFor("/tmp/outside.yaml")).toThrow(/Unsafe path/);
  });

  it("stores task context as frontmatter markdown", async () => {
    const { repo } = await createTempRepo();
    const task = { id: "task-ctx", title: "Context task", status: "inProgress" as const };

    await repo.saveTaskContext(
      task,
      {
        data: { owner: "agent" },
        body: "Important context\n",
      },
      "test-context",
    );

    await expect(repo.loadTaskContext(task)).resolves.toEqual({
      data: { owner: "agent" },
      body: "Important context\n",
    });
  });

  it("loads inputs and reports from the standard layout", async () => {
    const { repo } = await createTempRepo();
    await repo.saveYaml(
      repo.layoutPath("inputs", "2026-07-04.yaml"),
      {
        date: "2026-07-04",
        items: [{ title: "Calendar input", source: "calendar" }],
      },
      "seed-input",
    );
    await repo.saveYaml(
      repo.layoutPath("reports", "2026-07-04.yaml"),
      {
        date: "2026-07-04",
        entries: [{ task_id: "task-1", done: ["Reported work"] }],
      },
      "seed-report",
    );

    await expect(repo.loadInputs("2026-07-04")).resolves.toMatchObject({
      items: [{ title: "Calendar input", source: "calendar" }],
    });
    await expect(repo.loadReport("2026-07-04")).resolves.toMatchObject({
      entries: [{ task_id: "task-1", done: ["Reported work"] }],
    });
  });
});
