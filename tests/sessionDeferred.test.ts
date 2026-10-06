import { describe, expect, it, vi } from "vitest";
import { createFinishTaskSessionWorkflow } from "#mcp/workflows/finishTaskSession";
import { loadReportActivitySyncState } from "#domain/reports/activitySync";
import type { GenerationRuntime } from "#mcp/llm/generationRuntime";
import { createTempRepo } from "./helpers.ts";

describe("deferred task-session completion", () => {
  it("records Activity once and defers routine LLM/report work", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks(
      { tasks: [{ id: "task-1", title: "Task", status: "inProgress", context: "contexts/task-1.md" }] },
      "seed",
    );
    const generation = {
      generateScopedTaskUpdates: vi.fn(),
      assertScopedGenerationCurrent: vi.fn(),
      applyScopedTaskUpdates: vi.fn(),
    } as unknown as GenerationRuntime;
    const finish = createFinishTaskSessionWorkflow({ repo, config, generation });
    const input = {
      backfill: true,
      date: "2026-08-12",
      session_id: "thread-1",
      source: "test",
      summary: "Routine checkpoint",
      task_id: "task-1",
      done: ["Implemented one step"],
      next: ["Continue verification"],
      dry_run: false,
      formats: [],
      processing_policy: "auto" as const,
      memory_policy: "auto" as const,
      apply_task_state: false,
      apply_context: false,
    };

    const first = (await finish(input)) as { processed_immediately: boolean; report_pending: boolean };
    const second = (await finish(input)) as { idempotent_retry: boolean };

    expect(first.processed_immediately).toBe(false);
    expect(first.report_pending).toBe(true);
    expect(second.idempotent_retry).toBe(true);
    expect(generation.generateScopedTaskUpdates).not.toHaveBeenCalled();
    expect((await repo.loadActivity("2026-08-12")).entries).toHaveLength(1);
    expect((await loadReportActivitySyncState(repo, "2026-08-12")).tasks).toMatchObject([
      { task_id: "task-1", pending_activity_count: 1 },
    ]);
  });

  it("queues low-confidence sessions for review without creating Activity", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks(
      { tasks: [{ id: "task-1", title: "Task", status: "inProgress", context: "contexts/task-1.md" }] },
      "seed",
    );
    const generation = {
      generateScopedTaskUpdates: vi.fn(),
      assertScopedGenerationCurrent: vi.fn(),
      applyScopedTaskUpdates: vi.fn(),
    } as unknown as GenerationRuntime;
    const finish = createFinishTaskSessionWorkflow({ repo, config, generation });

    const result = (await finish({
      backfill: true,
      date: "2026-08-12",
      session_id: "thread-low-confidence",
      source: "test",
      summary: "Uncertain checkpoint",
      task_id: "task-1",
      done: ["Possibly implemented one step"],
      confidence: "low",
      dry_run: false,
      formats: [],
      processing_policy: "auto",
      memory_policy: "auto",
      apply_task_state: false,
      apply_context: false,
    })) as { submitted: { update: { status: string } }; processed_immediately: boolean };

    expect(result.submitted.update.status).toBe("needs_review");
    expect(result.processed_immediately).toBe(false);
    expect(generation.generateScopedTaskUpdates).not.toHaveBeenCalled();
    expect((await repo.loadAgentUpdates("2026-08-12")).updates).toMatchObject([{ status: "needs_review" }]);
    expect((await repo.loadActivity("2026-08-12")).entries).toHaveLength(0);
  });
});
