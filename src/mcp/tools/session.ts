/**
 * Registers the composite MCP tool that finalizes one task session.
 * 1つのタスクセッションを完了する複合MCPツールを登録します。
 *
 * @remarks
 * This module owns the public schema and delegates the atomic workflow to an injected handler.
 * このモジュールは公開スキーマを担当し、原子的なワークフローは注入されたハンドラーへ委譲します。
 *
 * @packageDocumentation
 */
import * as z from "zod/v4";
import { jsonText } from "#mcp/protocol/result";
import type { ToolRegistrationContext } from "#mcp/tools/context";
import { peopleCaptureSchema } from "#mcp/tools/people";
import { knowledgeNoteInputSchema } from "#mcp/tools/knowledge";

const sessionFinishSchema = z.object({
  date: z.string().optional(),
  backfill: z.boolean().default(false),
  session_id: z.string(),
  source: z.string(),
  summary: z.string(),
  task_id: z.string(),
  project: z.string().optional(),
  title: z.string().optional(),
  done: z.array(z.string()).optional(),
  next: z.array(z.string()).optional(),
  status_suggestion: z
    .enum(["todo", "inProgress", "done", "waiting", "blocked"])
    .optional()
    .describe(
      "Task lifecycle suggestion. Use waiting only when work is expected to resume after an external response or event. Use blocked when the user explicitly stops or suspends the task, or a concrete blocker prevents progress. Never represent an explicit stop as waiting.",
    ),
  context_updates: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  dry_run: z.boolean().default(false),
  formats: z
    .array(z.enum(["text", "markdown", "html"]))
    .default([])
    .describe(
      "Optional full report outputs to render immediately. Leave empty for normal session completion; report_generate_output later refreshes only tasks with unreflected Activity.",
    ),
  processing_policy: z
    .enum(["auto", "immediate", "deferred"])
    .default("auto")
    .describe(
      "auto defers routine updates and processes terminal state changes or explicit output requests immediately. immediate forces scoped LLM generation. deferred records Activity without LLM generation.",
    ),
  memory_policy: z
    .enum(["auto", "force", "skip"])
    .default("auto")
    .describe(
      "auto keeps task memory read-only unless the deprecated promote_memory=true compatibility flag is supplied. force requests durable-memory generation; skip never modifies task memory.",
    ),
  apply_task_state: z.boolean().default(false),
  apply_context: z.boolean().default(false),
  promote_memory: z
    .boolean()
    .optional()
    .describe(
      "Deprecated compatibility flag. true is treated as memory_policy=force and false as memory_policy=skip. Prefer memory_policy.",
    ),
  global_memory_updates: z
    .object({
      summary: z.array(z.string()).optional(),
      preferences: z.array(z.string()).optional(),
      rules: z.array(z.string()).optional(),
    })
    .optional()
    .describe(
      "Append only explicit task-independent context, user preferences, or operating rules that should apply across multiple tasks. Never promote task-specific facts or dated activity.",
    ),
  knowledge_updates: z
    .array(knowledgeNoteInputSchema)
    .max(5)
    .optional()
    .describe(
      "Proactively save reusable, task-independent knowledge discovered in this session. Include only complete generalized notes that remain useful after removing this task name and date, with rationale, applicability, and limitations in evidence. Reuse an existing id to merge an established concept. Do not include dated work, one-task state, person profiles, user preferences, or operating rules.",
    ),
  people_updates: peopleCaptureSchema
    .optional()
    .describe(
      "Profiles, relationships, and dated interactions discovered during this session. Supply durable user-provided or clearly observed person information here when it was not already captured during the conversation.",
    ),
});

/** Parsed input for the session-finalization workflow. セッション完了ワークフロー用に解析された入力です。 */
export type SessionFinishToolInput = z.infer<typeof sessionFinishSchema>;

/** Registers the task-session finalization tool. タスクセッション完了ツールを登録します。 */
export function registerSessionTools(
  { server }: ToolRegistrationContext,
  finish: (input: SessionFinishToolInput) => Promise<unknown>,
): void {
  server.registerTool(
    "session_finish_task",
    {
      description:
        "Finish one AI thread or clear work session exactly once. Routine completion records immutable Activity and leaves report generation pending without calling an LLM; report_generate_output later refreshes only tasks with unreflected Activity. Proactively include knowledge_updates when this session established a self-contained insight reusable across tasks; do not wait for a separate user request. Include people_updates only to capture durable person information not already recorded during the conversation. Use activity_append_entry for intermediate checkpoints. auto processing runs scoped LLM generation immediately only for terminal state transitions, forced memory promotion, or explicitly requested output formats. Reusing the same task_id and session_id is idempotent. For normal writes omit date; use backfill=true only for intentional historical import.",
      inputSchema: sessionFinishSchema,
    },
    async (input) => jsonText(await finish(input)),
  );
}
