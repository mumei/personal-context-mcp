/**
 * Registers MCP tools that use an LLM to promote task memory and generate a mind map.
 * タスクメモリの昇格とマインドマップ生成にLLMを使用するMCPツールを登録します。
 *
 * @remarks
 * This module owns the public schemas but delegates generation and persistence to injected workflows.
 * このモジュールは公開スキーマを担当し、生成と永続化は注入されたワークフローへ委譲します。
 *
 * @packageDocumentation
 */
import * as z from "zod/v4";
import { resolveDate } from "#shared/date";
import { jsonText } from "#mcp/protocol/result";
import type { ToolRegistrationContext } from "#mcp/tools/context";

/** Input passed to the task-memory promotion workflow. タスクメモリ昇格ワークフローへ渡す入力です。 */
export interface PromoteTaskMemoryRequest {
  date: string;
  taskId: string;
  lookbackDays: number;
  maxTokens: number;
  force: boolean;
}

/** LLM workflows required by memory-generation tools. メモリ生成ツールが必要とするLLMワークフローです。 */
export interface MemoryGenerationWorkflows {
  promote(input: PromoteTaskMemoryRequest): Promise<unknown>;
  generateMindMap(taskId: string, maxTokens: number): Promise<unknown>;
}

/** Registers task-memory generation tools. タスクメモリ生成ツールを登録します。 */
export function registerMemoryGenerationTools(
  { server, config }: ToolRegistrationContext,
  workflows: MemoryGenerationWorkflows,
): void {
  server.registerTool(
    "task_memory_promote_activity",
    {
      description:
        "Explicitly promote reusable knowledge from recent activity into one task's long-lived memory. Excludes dated work logs, monitoring snapshots, transient counts, report prose, commands, PIDs, and file paths; use activity/report tools for those instead.",
      inputSchema: z.object({
        date: z.string().optional(),
        task_id: z.string(),
        lookback_days: z.number().int().positive().max(90).default(config.defaultLookbackDays),
        max_tokens: z.number().int().positive().max(4000).default(1200),
        force: z
          .boolean()
          .default(false)
          .describe("Regenerate durable memory even when the promotion input checkpoint is unchanged."),
      }),
    },
    async ({ date, max_tokens, task_id, lookback_days, force }) =>
      jsonText(
        await workflows.promote({
          date: resolveDate(date, config),
          taskId: task_id,
          lookbackDays: lookback_days,
          maxTokens: max_tokens,
          force,
        }),
      ),
  );
  server.registerTool(
    "task_memory_generate_mindmap",
    {
      description:
        "Generate and replace only one task memory mindmap. Sends the task title and consolidated summary/facts/decisions/risks/next to the configured LLM; never sends context, activities, inputs, sources, or file paths. Requires explicit data-sharing consent.",
      annotations: {
        title: "Generate task-memory mind map",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: z.object({
        task_id: z.string(),
        allow_llm_data_sharing: z.literal(true),
        max_tokens: z.number().int().positive().max(4000).default(1600),
      }),
    },
    async ({ task_id, max_tokens }) => jsonText(await workflows.generateMindMap(task_id, max_tokens)),
  );
}
