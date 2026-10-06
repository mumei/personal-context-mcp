/**
 * Registers direct read and update tools for task memory, global memory, and daily report summaries.
 * タスクメモリ、Globalメモリ、日次レポート要約の直接参照・更新ツールを登録します。
 *
 * @remarks
 * It only exposes explicit state operations and does not perform LLM promotion or mind-map generation.
 * 明示的な状態操作だけを担当し、ActivityからのLLM昇格やマインドマップ生成は担当しません。
 *
 * @packageDocumentation
 */
import * as z from "zod/v4";
import { updateGlobalMemory, updateReportSummary, updateTaskMemory } from "#domain/memory/actions";
import { resolveDate } from "#shared/date";
import { jsonText } from "#mcp/protocol/result";
import type { ToolRegistrationContext } from "#mcp/tools/context";

const sourceSchema = z.object({
  path: z.string().optional(),
  date: z.string().optional(),
  task_id: z.string().optional(),
  section: z.string().optional(),
});

/** Registers state-operation tools for durable memory and daily report summaries. 長期メモリと日次レポート要約の状態操作ツールを登録します。 */
export function registerMemoryStateTools({ server, repo, config }: ToolRegistrationContext): void {
  server.registerTool(
    "task_memory_get_state",
    {
      description: "Get internal long-lived memory for one task. This is separate from report text.",
      inputSchema: z.object({ task_id: z.string() }),
    },
    async ({ task_id }) => jsonText(await repo.loadTaskMemory(task_id)),
  );
  server.registerTool(
    "task_memory_update_state",
    {
      description: "Replace, append, or clear internal long-lived memory for one task.",
      inputSchema: z.object({
        task_id: z.string(),
        mode: z.enum(["replace", "append", "delete"]),
        summary: z.array(z.string()).optional(),
        facts: z.array(z.string()).optional(),
        decisions: z.array(z.string()).optional(),
        risks: z.array(z.string()).optional(),
        next: z.array(z.string()).optional(),
        sources: z.array(sourceSchema).optional(),
      }),
    },
    async (input) => jsonText(await updateTaskMemory(repo, input)),
  );
  server.registerTool(
    "global_memory_get_state",
    {
      description:
        "Get task-independent long-lived memory. Read this before planning or generating user-facing output so user-wide rules, preferences, and cross-task context are applied consistently.",
      inputSchema: z.object({}),
    },
    async () => jsonText(await repo.loadGlobalMemory()),
  );
  server.registerTool(
    "global_memory_update_state",
    {
      description:
        "Replace, append, or clear task-independent long-lived memory. Store only explicit user-wide rules, preferences, and cross-task context that should apply beyond one task; never store dated activity or task-specific state.",
      inputSchema: z.object({
        mode: z.enum(["replace", "append", "delete"]),
        summary: z.array(z.string()).optional(),
        preferences: z.array(z.string()).optional(),
        rules: z.array(z.string()).optional(),
        sources: z.array(sourceSchema).optional(),
      }),
    },
    async (input) => jsonText(await updateGlobalMemory(repo, input)),
  );
  server.registerTool(
    "report_summary_get_daily",
    {
      description: "Get the internal summary used as the report lead section for a date.",
      inputSchema: z.object({ date: z.string().optional() }),
    },
    async ({ date }) => jsonText(await repo.loadReportSummary(resolveDate(date, config))),
  );
  server.registerTool(
    "report_summary_update_daily",
    {
      description: "Replace, append, or clear the internal report summary for a date.",
      inputSchema: z.object({
        date: z.string().optional(),
        mode: z.enum(["replace", "append", "delete"]),
        headline: z.string().optional(),
        done: z.array(z.string()).optional(),
        next: z.array(z.string()).optional(),
        risks: z.array(z.string()).optional(),
        notes: z.array(z.string()).optional(),
        sources: z.array(sourceSchema).optional(),
      }),
    },
    async ({ date, ...input }) => jsonText(await updateReportSummary(repo, resolveDate(date, config), input)),
  );
}
