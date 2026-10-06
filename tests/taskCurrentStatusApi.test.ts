import type { AddressInfo } from "node:net";
import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createTaskMcpWebServer, stopTaskMcpWebServer } from "#webServer";
import { createTempRepo } from "./helpers.ts";

async function requestTask(
  server: ReturnType<typeof createTaskMcpWebServer>,
  path: string,
): Promise<Record<string, unknown>> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  } finally {
    await stopTaskMcpWebServer(server);
  }
}

describe("task current-status API projection", () => {
  it("falls back through context and the newest dated Activity without writing durable documents", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          { id: "task-1", title: "Task 1", status: "inProgress", compact_summary: [" ", ""], report_exclude: true },
        ],
      },
      "seed",
    );
    await repo.saveTaskContext(
      { id: "task-1", title: "Task 1" },
      { data: { compact_summary: [" Context\nsummary ", "Context summary"] }, body: "" },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-01",
      {
        date: "2026-07-01",
        entries: [
          {
            task_id: "task-1",
            compact_summary: ["Old activity"],
            next: ["Old next"],
            occurred_at: "2026-07-01T12:00:00Z",
          },
        ],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-02",
      {
        date: "2026-07-02",
        entries: [
          {
            task_id: "task-1",
            compact_summary: ["Newest activity"],
            next: [" Latest next ", "Latest next"],
            occurred_at: "2026-07-02T12:00:00Z",
          },
          {
            task_id: "task-1",
            compact_summary: ["Unsorted stale"],
            next: ["Stale next"],
            occurred_at: "2026-07-02T01:00:00Z",
          },
        ],
      },
      "seed",
    );
    const before = await repo.loadActivity("2026-07-02");

    const detail = await requestTask(createTaskMcpWebServer(repo, config), "/api/task/task-1?date=2026-07-03");

    expect(detail.task).toMatchObject({ report_exclude: true });
    expect(detail.current_status).toEqual({ summary: ["Context summary"], risks: [], next: ["Latest next"] });
    expect(detail.latest_activity).toMatchObject({ compact_summary: ["Newest activity"] });
    expect(await repo.loadActivity("2026-07-02")).toEqual(before);
    await expect(access(repo.layoutPath("taskMemory", "task-1.yaml"))).rejects.toThrow();
    await expect(access(repo.layoutPath("reports", "2026-07-03.yaml"))).rejects.toThrow();
  });

  it("uses the newer explicit Activity next clear, but retains newer memory next", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1", status: "inProgress" }] }, "seed");
    await repo.saveTaskMemory(
      "task-1",
      { task_id: "task-1", summary: ["  "], next: ["Memory next"], updated_at: "2026-07-02T12:00:00Z" },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-01",
      {
        date: "2026-07-01",
        entries: [
          { task_id: "task-1", compact_summary: ["Activity summary"], next: [], occurred_at: "2026-07-03T12:00:00Z" },
        ],
      },
      "seed",
    );
    const first = await requestTask(createTaskMcpWebServer(repo, config), "/api/task/task-1?date=2026-07-03");
    expect(first.current_status).toEqual({ summary: ["Activity summary"], risks: [], next: [] });

    await repo.saveTaskMemory(
      "task-1",
      { task_id: "task-1", next: [" Newer memory next "], updated_at: "2026-07-04T12:00:00Z" },
      "seed-newer-memory",
    );
    const second = await requestTask(createTaskMcpWebServer(repo, config), "/api/task/task-1?date=2026-07-03");
    expect(second.current_status).toEqual({ summary: ["Activity summary"], risks: [], next: ["Newer memory next"] });
  });

  it("uses recorded and operational Activity dates before an older explicit memory next", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          { id: "recorded", title: "Recorded", status: "inProgress" },
          { id: "dated", title: "Dated", status: "inProgress" },
        ],
      },
      "seed",
    );
    await repo.saveTaskMemory(
      "recorded",
      { task_id: "recorded", next: ["Old memory next"], updated_at: "2026-07-01T12:00:00Z" },
      "seed",
    );
    await repo.saveTaskMemory(
      "dated",
      { task_id: "dated", next: ["Old memory next"], updated_at: "2026-07-01T12:00:00Z" },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-02",
      {
        date: "2026-07-02",
        entries: [
          { task_id: "recorded", next: ["Recorded next"], recorded_at: "2026-07-02T12:00:00Z" },
          { task_id: "dated", next: ["Dated next"] },
        ],
      },
      "seed",
    );

    const recorded = await requestTask(createTaskMcpWebServer(repo, config), "/api/task/recorded?date=2026-07-03");
    const dated = await requestTask(createTaskMcpWebServer(repo, config), "/api/task/dated?date=2026-07-03");
    expect(recorded.current_status).toEqual({ summary: [], risks: [], next: ["Recorded next"] });
    expect(dated.current_status).toEqual({ summary: [], risks: [], next: ["Dated next"] });
    expect(dated).toMatchObject({ latest_next_activity_date: "2026-07-02" });

    await repo.saveTaskMemory(
      "recorded",
      { task_id: "recorded", summary: ["Newer summary only"], updated_at: "2026-07-03T12:00:00Z" },
      "seed-summary-only",
    );
    const summaryOnly = await requestTask(createTaskMcpWebServer(repo, config), "/api/task/recorded?date=2026-07-03");
    expect(summaryOnly.current_status).toEqual({ summary: ["Newer summary only"], risks: [], next: ["Recorded next"] });
  });
});
