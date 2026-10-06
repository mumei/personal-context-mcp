import { describe, expect, it } from "vitest";
import {
  applyAgentUpdates,
  applyAgentUpdatesDryRun,
  compactAgentUpdates,
  submitAgentUpdate,
} from "#domain/agent-updates/workflow";
import { createTempRepo } from "./helpers.ts";

describe("agent updates", () => {
  it("queues high-confidence updates for known tasks", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Build MCP", status: "inProgress" }],
      },
      "seed",
    );

    const result = await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "session-a",
      source: "codex",
      task_id: "task-1",
      summary: "Implemented initial MCP server",
      done: ["Added stdio server"],
      next: ["Run validation"],
      confidence: "high",
    });

    expect(result.update.status).toBe("pending");
    expect(result.warnings).toEqual([]);

    const doc = await repo.loadAgentUpdates("2026-07-04");
    expect(doc.updates).toHaveLength(1);
    expect(doc.updates[0]?.session_id).toBe("session-a");
  });

  it("routes low-confidence updates to review and accepts high-confidence completion updates", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Build MCP", status: "inProgress" }],
      },
      "seed",
    );

    const lowConfidence = await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "session-a",
      source: "codex",
      task_id: "task-1",
      summary: "Maybe done",
      confidence: "low",
    });

    const doneSuggestion = await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "session-b",
      source: "codex",
      task_id: "task-1",
      summary: "Looks complete",
      status_suggestion: "done",
      confidence: "high",
    });

    expect(lowConfidence.update.status).toBe("needs_review");
    expect(doneSuggestion.update.status).toBe("pending");
  });

  it("converts pending updates to dry-run activity entries", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Build MCP", status: "inProgress" }],
      },
      "seed",
    );

    await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "session-a",
      source: "codex",
      task_id: "task-1",
      project: "generic-mcp",
      title: "Build MCP",
      summary: "Server is ready for validation",
      done: ["Registered task tools"],
      next: ["Execute tests"],
      confirm: ["Check API naming"],
      context_updates: ["Data root is ~/.tasks by default"],
      sources: ["src/server.ts"],
      confidence: "high",
    });

    const result = await applyAgentUpdatesDryRun(repo, "2026-07-04");

    expect(result.skipped_updates).toEqual([]);
    expect(result.entries).toEqual([
      expect.objectContaining({
        task_id: "task-1",
        project: "generic-mcp",
        title: "Build MCP",
        done: ["Registered task tools"],
        next: ["Execute tests"],
        confirm: ["Check API naming"],
        compact_summary: ["Data root is ~/.tasks by default"],
        sources: ["src/server.ts"],
        status: undefined,
      }),
    ]);
    expect(result.entries[0]?.agent_update_id).toEqual(expect.any(String));
    expect(result.entries[0]?.activity_id).toBe(result.entries[0]?.agent_update_id);
  });

  it("applies pending updates to the activity log, then marks them applied", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Build MCP", status: "inProgress" }],
      },
      "seed",
    );
    const submitted = await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "session-a",
      source: "codex",
      task_id: "task-1",
      summary: "Ready to persist",
      done: ["Added apply flow"],
      confidence: "high",
    });

    const result = await applyAgentUpdates(repo, "2026-07-04", [submitted.update.update_id]);

    expect(result.entries).toHaveLength(1);
    await expect(repo.loadActivity("2026-07-04")).resolves.toMatchObject({
      entries: [{ task_id: "task-1", done: ["Added apply flow"] }],
    });
    await expect(repo.loadReport("2026-07-04")).resolves.toEqual({ date: "2026-07-04", entries: [] });
    const queue = await repo.loadAgentUpdates("2026-07-04");
    expect(queue.updates[0]?.status).toBe("applied");
    expect(queue.updates[0]?.applied_to).toEqual([result.activitySave.path]);
  });

  it("compacts repeated pending monitor updates by keeping the latest one", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "monitor-task", title: "Monitor", status: "inProgress" }],
      },
      "seed",
    );
    await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "monitor-1",
      source: "codex",
      task_id: "monitor-task",
      summary: "Progress 10%",
      done: ["Observed 10%"],
      occurred_at: "2026-07-04T10:00:00+09:00",
      confidence: "high",
    });
    const latest = await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "monitor-2",
      source: "codex",
      task_id: "monitor-task",
      summary: "Progress 20%",
      done: ["Observed 20%"],
      occurred_at: "2026-07-04T11:00:00+09:00",
      confidence: "high",
    });

    const preview = await compactAgentUpdates(repo, "2026-07-04", {
      task_id: "monitor-task",
      dry_run: true,
    });
    expect(preview.compacted_update_ids).toHaveLength(1);
    await expect(repo.loadAgentUpdates("2026-07-04")).resolves.toMatchObject({
      updates: [{ status: "pending" }, { status: "pending" }],
    });

    const result = await compactAgentUpdates(repo, "2026-07-04", {
      task_id: "monitor-task",
      dry_run: false,
      reason: "Keep latest monitor status only.",
    });

    expect(result.kept_update?.update_id).toBe(latest.update.update_id);
    expect(result.compacted_update_ids).toHaveLength(1);
    const queue = await repo.loadAgentUpdates("2026-07-04");
    expect(queue.updates.map((update) => update.status)).toEqual(["rejected", "pending"]);
    expect(queue.updates[0]?.compacted_into).toBe(latest.update.update_id);
    expect(queue.updates[1]?.compacted_from).toEqual([queue.updates[0]?.update_id]);
  });

  it("preserves every update submitted concurrently", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Build MCP", status: "inProgress" }],
      },
      "seed",
    );

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        submitAgentUpdate(repo, "2026-07-04", {
          session_id: `session-${index}`,
          source: "codex",
          task_id: "task-1",
          summary: `Update ${index}`,
          confidence: "high",
        }),
      ),
    );

    const queue = await repo.loadAgentUpdates("2026-07-04");
    expect(queue.updates).toHaveLength(20);
    expect(new Set(queue.updates.map((update) => update.session_id)).size).toBe(20);
  });

  it("treats an exact same-session submission as an idempotent retry", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Build MCP", status: "inProgress" }],
      },
      "seed",
    );
    const input = {
      session_id: "session-retry",
      source: "codex",
      task_id: "task-1",
      summary: "Same operation",
      confidence: "high" as const,
    };

    const first = await submitAgentUpdate(repo, "2026-07-04", input);
    const second = await submitAgentUpdate(repo, "2026-07-04", input);
    const queue = await repo.loadAgentUpdates("2026-07-04");

    expect(second.update.update_id).toBe(first.update.update_id);
    expect(second.save.changed).toBe(false);
    expect(queue.updates).toHaveLength(1);
  });

  it("does not duplicate an activity when an interrupted apply is retried", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Build MCP", status: "inProgress" }],
      },
      "seed",
    );
    const submitted = await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "session-retry",
      source: "codex",
      task_id: "task-1",
      summary: "Retry-safe update",
      done: ["Persisted once"],
      confidence: "high",
    });
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [
          {
            agent_update_id: submitted.update.update_id,
            task_id: "task-1",
            done: ["Persisted once"],
          },
        ],
      },
      "simulate-interrupted-apply",
    );

    const result = await applyAgentUpdates(repo, "2026-07-04", [submitted.update.update_id]);
    const activity = await repo.loadActivity("2026-07-04");
    const queue = await repo.loadAgentUpdates("2026-07-04");

    expect(result.already_applied_updates).toEqual([submitted.update.update_id]);
    expect(activity.entries).toHaveLength(1);
    expect(queue.updates[0]?.status).toBe("applied");
  });
});
