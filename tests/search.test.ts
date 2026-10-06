import { describe, expect, it } from "vitest";
import { searchTaskContext } from "#app/search";
import { createTempRepo } from "./helpers.ts";

describe("searchTaskContext", () => {
  it("searches tasks, contexts, activities, and reports", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          {
            id: "task-1",
            title: "Generic RAG context",
            status: "inProgress",
          },
        ],
      },
      "seed",
    );
    await repo.saveTaskContext(
      { id: "task-1", title: "Generic RAG context" },
      { data: { domain: "mcp" }, body: "Long-lived context mentions synthesis." },
      "seed-context",
    );
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [{ task_id: "task-1", done: ["Synthesis activity entry"] }],
      },
      "seed-activity",
    );
    await repo.saveYaml(
      repo.layoutPath("reports", "2026-07-04.yaml"),
      {
        date: "2026-07-04",
        entries: [{ task_id: "task-1", next: ["Synthesis report entry"] }],
      },
      "seed-report",
    );

    const sections = (await searchTaskContext(repo, "synthesis", 10)).map((match) => match.section);

    expect(sections).toContain("context");
    expect(sections).toContain("activity");
    expect(sections).toContain("report");
  });

  it("searches every dated source and supports all-term and metadata filters", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Search task", project: "alpha", status: "inProgress" }],
      },
      "seed",
    );
    await repo.saveInputs(
      "2026-06-01",
      {
        date: "2026-06-01",
        items: [{ title: "Old input", project: "alpha", related_task_id: "task-1", summary: ["cross source phrase"] }],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-01",
      {
        date: "2026-07-01",
        entries: [{ task_id: "task-1", project: "alpha", done: ["cross source phrase"] }],
      },
      "seed",
    );
    await repo.saveYaml(
      repo.layoutPath("reports", "2026-07-02.yaml"),
      {
        date: "2026-07-02",
        entries: [{ task_id: "task-1", done: ["cross source phrase"] }],
      },
      "seed",
    );
    await repo.saveReportSummary("2026-07-03", { date: "2026-07-03", notes: ["cross source phrase"] }, "seed");
    await repo.saveMemorySummaries(
      "2026-07-04",
      {
        date: "2026-07-04",
        summaries: [
          {
            summary_id: "summary-1",
            status: "pending",
            target_type: "task",
            task_id: "task-1",
            summary: ["cross source phrase"],
            created_at: "2026-07-04T00:00:00Z",
          },
        ],
      },
      "seed",
    );
    await repo.saveAgentUpdates(
      "2026-07-05",
      {
        date: "2026-07-05",
        updates: [
          {
            update_id: "update-1",
            session_id: "session-1",
            source: "codex",
            status: "pending",
            received_at: "2026-07-05T00:00:00Z",
            summary: "cross source phrase",
            task_id: "task-1",
            project: "alpha",
          },
        ],
      },
      "seed",
    );

    const matches = await searchTaskContext(repo, "cross phrase", { project: "alpha", limit: 20 });
    const sections = matches.map((match) => match.section);

    expect(sections).toEqual(expect.arrayContaining(["input", "activity", "report", "memory_summary", "agent_update"]));
    expect(matches.find((match) => match.section === "input")?.date).toBe("2026-06-01");
    expect(await searchTaskContext(repo, "cross phrase", { section: "report_summary" })).toHaveLength(1);
    expect(await searchTaskContext(repo, "cross missing", { terms_mode: "all" })).toEqual([]);
    expect(
      await searchTaskContext(repo, "cross missing", { terms_mode: "any", section: "input", date: "2026-06-01" }),
    ).toHaveLength(1);
  });

  it("excludes logically deleted task data unless explicitly included", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "duplicate", title: "Duplicate searchable", status: "inProgress", deleted: true }],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [{ task_id: "duplicate", done: ["duplicate searchable evidence"] }],
      },
      "seed",
    );

    expect(await searchTaskContext(repo, "duplicate searchable")).toEqual([]);
    expect(await searchTaskContext(repo, "duplicate searchable", { include_deleted: true })).not.toHaveLength(0);
  });
});
