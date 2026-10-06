/**
 * Orchestrates Activity-first completion of one task session with optional immediate LLM processing.
 * Responsibility: This module owns session date normalization, idempotency, preview validation, transactional Activity
 * application, processing-policy selection, optional task/context changes, and requested report rendering.
 * Non-responsibility: This module does not register MCP tools, generate LLM content, or define persistence rules.
 *
 * 1つのタスクセッションをActivity優先で完了し、必要な場合だけLLM処理する流れを調整します。
 * 責務: セッション日付の正規化、冪等性、preview検証、Activityのtransaction適用、処理方針の選択、
 * 任意のタスク・context変更、および指定されたreport renderingを担当します。
 * 非責務: このモジュールは、MCPツール登録、LLM内容生成、永続化規則の定義を担当しません。
 *
 * @packageDocumentation
 */
import { applyAgentUpdates, previewAgentUpdate, submitAgentUpdate } from "#domain/agent-updates/workflow";
import { generateReport } from "#domain/reports/render";
import { loadReportActivitySyncState } from "#domain/reports/activitySync";
import { finishTaskSession } from "#domain/sessions/finishTask";
import { updateGlobalMemory } from "#domain/memory/actions";
import { applyKnowledgeNoteBatch } from "#domain/knowledge/actions";
import { updateTask, updateTaskContext } from "#domain/tasks/actions";
import type { Repository } from "#infra/repository/repository";
import { resolveActivityWriteDate } from "#shared/date";
import type { TaskMcpConfig } from "#shared/types";
import type { GenerationRuntime } from "#mcp/llm/generationRuntime";
import type { SessionFinishToolInput } from "#mcp/tools/session";
import { applyPeopleCapture } from "#mcp/tools/people";

/**
 * Defines the dependencies required by the task-session completion workflow.
 *
 * タスクセッション完了ワークフローが必要とする依存を定義します。
 */
export interface FinishTaskSessionDependencies {
  repo: Repository;
  config: TaskMcpConfig;
  generation: GenerationRuntime;
}

/**
 * Creates the handler used to complete one task session atomically.
 *
 * 1つのタスクセッションを原子的に完了するハンドラーを作成します。
 */
export function createFinishTaskSessionWorkflow({
  repo,
  config,
  generation,
}: FinishTaskSessionDependencies): (input: SessionFinishToolInput) => Promise<unknown> {
  return async ({
    date,
    backfill,
    apply_task_state,
    apply_context,
    promote_memory,
    memory_policy,
    processing_policy,
    global_memory_updates,
    knowledge_updates,
    people_updates,
    ...input
  }) => {
    const recordedAt = new Date();
    const resolved = resolveActivityWriteDate(date, input.occurred_at, backfill, config, recordedAt);
    const normalizedInput = {
      ...input,
      occurred_at: input.occurred_at ?? recordedAt.toISOString(),
      confidence: input.confidence ?? "high",
    };
    if (normalizedInput.dry_run) {
      return {
        ...(await finishTaskSession(repo, resolved, normalizedInput)),
        global_memory_update_preview: global_memory_updates,
        knowledge_update_preview: knowledge_updates,
        people_update_preview: people_updates,
      };
    }

    const previewed = await previewAgentUpdate(repo, resolved, normalizedInput);
    if (previewed.duplicate?.status === "applied") {
      const sync = await loadReportActivitySyncState(repo, resolved);
      return {
        date: resolved,
        dry_run: false,
        idempotent_retry: true,
        update: previewed.duplicate,
        report_pending: sync.tasks.some((task) => task.task_id === normalizedInput.task_id),
        message: "This task session was already applied; no duplicate Activity or LLM generation was created.",
      };
    }
    if (previewed.update.status === "needs_review" && normalizedInput.confidence === "low") {
      const submitted = await submitAgentUpdate(repo, resolved, normalizedInput);
      return {
        date: resolved,
        dry_run: false,
        submitted,
        processing_policy,
        processed_immediately: false,
        message: "This low-confidence task session was queued for review; no Activity or LLM generation was created.",
      };
    }
    if (previewed.update.status !== "pending" && previewed.duplicate?.status !== "pending") {
      throw new Error(`Session update could not be finalized automatically: ${previewed.update.status}`);
    }

    const tasks = await repo.loadTasks();
    const task = tasks.tasks.find((candidate) => candidate.id === normalizedInput.task_id);
    if (!task) throw new Error(`Unknown task_id: ${normalizedInput.task_id}`);
    const statusTransition = Boolean(
      apply_task_state && normalizedInput.status_suggestion && normalizedInput.status_suggestion !== task.status,
    );
    const terminalTransition = Boolean(
      statusTransition && ["done", "waiting", "blocked"].includes(normalizedInput.status_suggestion ?? ""),
    );
    const effectiveMemoryPolicy = promote_memory === true ? "force" : promote_memory === false ? "skip" : memory_policy;
    const shouldPromoteMemory = effectiveMemoryPolicy === "force";
    const formats = normalizedInput.formats;
    const shouldGenerateImmediately =
      processing_policy === "immediate" ||
      (processing_policy === "auto" && (terminalTransition || shouldPromoteMemory || formats.length > 0));
    const generated = shouldGenerateImmediately
      ? await generation.generateScopedTaskUpdates(
          repo,
          resolved,
          [normalizedInput.task_id],
          [normalizedInput],
          shouldPromoteMemory,
          global_memory_updates,
        )
      : undefined;

    return repo.withTransaction(async () => {
      if (generated) await generation.assertScopedGenerationCurrent(repo, generated);
      const submitted = await submitAgentUpdate(repo, resolved, normalizedInput);
      if (submitted.update.status !== "pending") {
        throw new Error(`Agent update changed to ${submitted.update.status} before commit; retry after review.`);
      }
      const apply = await applyAgentUpdates(repo, resolved, [submitted.update.update_id]);
      if (apply_task_state && normalizedInput.status_suggestion) {
        await updateTask(repo, {
          task_id: normalizedInput.task_id,
          status: normalizedInput.status_suggestion,
          ...(normalizedInput.status_suggestion === "done" ? { completed_on: resolved } : {}),
        });
      }
      if (apply_context && normalizedInput.context_updates && normalizedInput.context_updates.length > 0) {
        await updateTaskContext(repo, {
          task_id: normalizedInput.task_id,
          compact_summary: normalizedInput.context_updates,
          body_mode: "preserve",
        });
      }
      const scoped = generated ? await generation.applyScopedTaskUpdates(repo, generated) : undefined;
      const hasGlobalMemoryUpdates = Boolean(
        global_memory_updates &&
        [global_memory_updates.summary, global_memory_updates.preferences, global_memory_updates.rules].some(
          (items) => items && items.length > 0,
        ),
      );
      const globalMemory = hasGlobalMemoryUpdates
        ? await updateGlobalMemory(repo, {
            mode: "append",
            ...global_memory_updates,
            sources: [{ date: resolved, task_id: normalizedInput.task_id, section: "session_finish_task" }],
          })
        : undefined;
      const existingKnowledgeIds = new Set((await repo.loadKnowledgeNotes()).map((note) => note.id));
      const knowledge = knowledge_updates?.length
        ? await applyKnowledgeNoteBatch(repo, knowledge_updates, "session-finish-knowledge")
        : undefined;
      const knowledgeCreatedCount = knowledge_updates?.filter((note) => !existingKnowledgeIds.has(note.id)).length ?? 0;
      const knowledgeUpdatedCount = (knowledge_updates?.length ?? 0) - knowledgeCreatedCount;
      const people = people_updates ? await applyPeopleCapture(repo, config, people_updates) : undefined;
      const reports = [];
      for (const format of formats) reports.push(await generateReport(repo, resolved, true, format));
      const sync = await loadReportActivitySyncState(repo, resolved);
      return {
        date: resolved,
        dry_run: false,
        submitted,
        apply,
        processing_policy: processing_policy,
        processed_immediately: shouldGenerateImmediately,
        scoped_generation: generated,
        scoped_apply: scoped,
        memory_policy: effectiveMemoryPolicy,
        memory_promoted: shouldPromoteMemory && Boolean(generated),
        global_memory_updated: hasGlobalMemoryUpdates,
        global_memory: globalMemory,
        knowledge_updated: Boolean(knowledge_updates?.length),
        knowledge_created_count: knowledgeCreatedCount,
        knowledge_updated_count: knowledgeUpdatedCount,
        knowledge,
        people_updated: Boolean(people_updates),
        people,
        task_state_applied: apply_task_state && Boolean(normalizedInput.status_suggestion),
        context_applied: apply_context && Boolean(normalizedInput.context_updates?.length),
        report_pending: sync.tasks.some((pending) => pending.task_id === normalizedInput.task_id),
        reports,
      };
    });
  };
}
