import { describe, expect, it } from "vitest";
import { submitAgentUpdate } from "#domain/agent-updates/workflow";
import { getUserSituation } from "#app/situation";
import { createTempRepo } from "./helpers.ts";

describe("user situation", () => {
  it("summarizes active tasks, recent activity, and queued agent updates", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          { id: "task-1", title: "Build MCP", status: "inProgress" },
          { id: "task-2", title: "Waiting task", status: "waiting" },
          { id: "task-3", title: "Finished task", status: "done" },
          { id: "task-4", title: "Deleted duplicate", status: "inProgress", deleted: true },
        ],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-03",
      {
        date: "2026-07-03",
        entries: [
          {
            task_id: "task-1",
            done: ["Created generic task schema"],
            next: ["Wire MCP tools"],
            confirm: ["Default data root"],
            compact_summary: ["No runtime dependency on reference task directory"],
          },
          { task_id: "task-4", done: ["Deleted duplicate activity"] },
        ],
      },
      "seed",
    );
    await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "session-a",
      source: "codex",
      task_id: "task-1",
      summary: "Tools were added",
      confidence: "high",
    });
    await repo.saveGlobalMemory(
      {
        summary: ["Cross-task operating context"],
        preferences: ["Prefer concise output"],
        rules: ["Preserve user-facing URLs"],
      },
      "seed",
    );

    const situation = await getUserSituation(repo, "2026-07-04", 7);

    expect(situation.summary).toBe("2 active tasks, 1 waiting or blocked tasks, 1 pending agent updates.");
    expect(situation.active_tasks.map((task) => task.id)).toEqual(["task-1", "task-2"]);
    expect(situation.waiting_or_blocked.map((task) => task.id)).toEqual(["task-2"]);
    expect(situation.recent_done[0]?.text).toBe("Created generic task schema");
    expect(situation.next_actions[0]?.text).toBe("Wire MCP tools");
    expect(situation.confirmations[0]?.text).toBe("Default data root");
    expect(situation.context_notes.map((item) => item.text)).toContain(
      "No runtime dependency on reference task directory",
    );
    expect(situation.pending_agent_updates).toHaveLength(1);
    expect(situation.global_memory).toMatchObject({
      summary: ["Cross-task operating context"],
      preferences: ["Prefer concise output"],
      rules: ["Preserve user-facing URLs"],
    });
    expect(situation.context_notes.slice(0, 3).map((item) => item.text)).toEqual([
      "Cross-task operating context",
      "Prefer concise output",
      "Preserve user-facing URLs",
    ]);
    expect(situation.recent_done.map((item) => item.text)).not.toContain("Deleted duplicate activity");
    expect(situation.handoff_health).toMatchObject({
      active_count: 2,
      with_recent_activity_count: 1,
      attention_count: 2,
    });
  });

  it("keeps task-specific handoff state visible beyond the first 20 active tasks", async () => {
    const { repo } = await createTempRepo();
    const tasks = Array.from({ length: 21 }, (_, index) => ({
      id: `task-${String(index + 1).padStart(2, "0")}`,
      title: `Task ${index + 1}`,
      status: "inProgress" as const,
    }));
    await repo.saveTasks({ tasks }, "seed");
    await repo.saveGlobalMemory(
      { summary: Array.from({ length: 20 }, (_, index) => `Global note ${index + 1}`) },
      "seed",
    );
    await repo.saveTaskMemory(
      "task-21",
      {
        task_id: "task-21",
        summary: ["The late-listed task still needs handoff context"],
        decisions: ["Keep the existing API because clients depend on it"],
        next: ["Verify the compatibility contract"],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-04",
      { date: "2026-07-04", entries: [{ task_id: "task-21", done: ["Implemented the compatibility layer"] }] },
      "seed",
    );

    const situation = await getUserSituation(repo, "2026-07-04", 7);

    expect(situation.context_notes.map((item) => item.text)).toContain(
      "The late-listed task still needs handoff context",
    );
    expect(situation.decisions).toMatchObject([
      { task_id: "task-21", text: "Keep the existing API because clients depend on it" },
    ]);
    expect(situation.next_actions.map((item) => item.text)).toContain("Verify the compatibility contract");
    expect(situation.handoff_health).toMatchObject({
      active_count: 21,
      with_recent_activity_count: 1,
      with_next_action_count: 1,
      with_task_memory_count: 1,
      with_decision_count: 1,
    });
  });

  it("keeps recent Activity next actions ahead of more than 20 old or undated Memory items", async () => {
    const { repo } = await createTempRepo();
    const tasks = Array.from({ length: 25 }, (_, index) => ({
      id: `memory-${index}`,
      title: `Memory ${index}`,
      status: "inProgress" as const,
    }));
    await repo.saveTasks(
      { tasks: [{ id: "kian", title: "Kian", status: "inProgress", report_exclude: true }, ...tasks] },
      "seed",
    );
    for (const [index, task] of tasks.entries()) {
      await repo.saveTaskMemory(
        task.id,
        {
          task_id: task.id,
          next: [`Older action ${index}`],
          ...(index % 2 === 0 ? { updated_at: "2026-07-01T12:00:00Z" } : {}),
        },
        "seed",
      );
    }
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [
          {
            task_id: "kian",
            occurred_at: "2026-07-04T11:00:00Z",
            next: ["Evaluate the real model", "Integrate recording management"],
          },
          { task_id: "kian", occurred_at: "2026-07-04T10:00:00Z", next: ["Older activity action"] },
        ],
      },
      "seed",
    );

    const situation = await getUserSituation(repo, "2026-07-04", 7);

    expect(situation.next_actions).toHaveLength(20);
    expect(situation.next_actions.slice(0, 3).map((item) => item.text)).toEqual([
      "Evaluate the real model",
      "Integrate recording management",
      "Older activity action",
    ]);
    expect(situation.active_tasks.find((task) => task.id === "kian")?.report_exclude).toBe(true);
    const undated = situation.next_actions.find((item) => item.task_id === "memory-23");
    expect(undated).toBeDefined();
    expect(undated?.source_refs[0]?.date).toBeUndefined();
  });

  it("ranks actual timestamps, falls back to recorded_at, and deduplicates only within each task", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          { id: "task-1", title: "Task 1", status: "inProgress" },
          { id: "task-2", title: "Task 2", status: "inProgress" },
        ],
      },
      "seed",
    );
    await repo.saveTaskMemory(
      "task-1",
      { task_id: "task-1", next: ["Review the result"], updated_at: "2026-07-03T10:00:00Z" },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [
          { task_id: "task-1", occurred_at: "2026-07-04T10:00:00Z", next: [" Review  the result ", ""] },
          { task_id: "task-2", occurred_at: "2026-07-04T18:00:00+09:00", next: ["Review the result"] },
          {
            task_id: "task-1",
            occurred_at: "invalid",
            recorded_at: "2026-07-04T11:00:00Z",
            next: ["Newest recorded action"],
          },
          { task_id: "task-1", occurred_at: "2026-07-04T08:00:00Z", next: ["Review the result"] },
        ],
      },
      "seed",
    );

    const situation = await getUserSituation(repo, "2026-07-04", 7);

    expect(situation.next_actions.map(({ task_id, text }) => ({ task_id, text }))).toEqual([
      { task_id: "task-1", text: "Newest recorded action" },
      { task_id: "task-1", text: "Review  the result" },
      { task_id: "task-2", text: "Review the result" },
    ]);
    expect(situation.next_actions[1]?.source_refs).toHaveLength(2);
    expect(situation.next_actions[1]?.source_refs.map((ref) => ref.date)).toEqual(["2026-07-04", "2026-07-03"]);
  });
});
