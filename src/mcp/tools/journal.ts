/**
 * Registers MCP tools for daily inputs and the immutable activity journal.
 * 日次入力と不変アクティビティジャーナルのMCPツールを登録します。
 *
 * @remarks
 * It resolves dates and connects schemas while delegating merge rules and persistence to domain modules.
 * 日付解決とスキーマ接続を担当し、入力統合規則やActivity永続化は各ドメインへ委譲します。
 *
 * @packageDocumentation
 */
import * as z from "zod/v4";
import { appendActivityEntry } from "#domain/activities/actions";
import { upsertInputItem } from "#domain/inputs/actions";
import { resolveActivityWriteDate, resolveDate } from "#shared/date";
import { jsonText } from "#mcp/protocol/result";
import type { ToolRegistrationContext } from "#mcp/tools/context";
import { buildTaskActivityIdentityMap } from "#domain/tasks/identity";

/** Registers external-input and Activity Journal tools. 外部入力とActivity JournalのMCPツールを登録します。 */
export function registerJournalTools({ server, repo, config }: ToolRegistrationContext): void {
  server.registerTool(
    "input_get_daily",
    { description: "Get external inputs by date.", inputSchema: z.object({ date: z.string().optional() }) },
    async ({ date }) => jsonText(await repo.loadInputs(resolveDate(date, config))),
  );
  server.registerTool(
    "input_upsert_item",
    {
      description: "Replace, append, or delete one external input item for a date.",
      inputSchema: z.object({
        date: z.string().optional(),
        input_id: z.string().optional(),
        title: z.string(),
        mode: z.enum(["replace", "append", "delete"]),
        source: z.string().optional(),
        project: z.string().optional(),
        url: z.string().nullable().optional(),
        received_at: z.string().optional(),
        summary: z.array(z.string()).optional(),
        action_required: z.boolean().nullable().optional(),
        related_task_id: z.string().nullable().optional(),
      }),
    },
    async ({ date, ...input }) => jsonText(await upsertInputItem(repo, resolveDate(date, config), input)),
  );

  server.registerTool(
    "activity_get_daily",
    {
      description: "Get an activity log by date.",
      inputSchema: z.object({ date: z.string().optional(), task_id: z.string().optional() }),
    },
    async ({ date, task_id }) => {
      const activity = await repo.loadActivity(resolveDate(date, config));
      if (!task_id) return jsonText(activity);
      const tasks = await repo.loadTasks();
      const taskIdentities = buildTaskActivityIdentityMap(tasks.tasks);
      const selected = taskIdentities.get(task_id);
      return jsonText(
        selected
          ? {
              ...activity,
              entries: activity.entries.filter((entry) => taskIdentities.get(entry.task_id)?.id === selected.id),
            }
          : { ...activity, entries: [] },
      );
    },
  );

  server.registerTool(
    "activity_append_entry",
    {
      description:
        "Append one immutable activity journal entry. For normal writes omit date; the server derives the work date from occurred_at, timezone, and the configured rollover hour. An explicit historical date is accepted only with backfill=true. This tool cannot replace, delete, compact, or shorten existing activities.",
      annotations: {
        title: "Append activity journal entry",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: z.object({
        date: z.string().optional(),
        backfill: z.boolean().default(false),
        task_id: z.string(),
        ticket_id: z.string().uuid().optional(),
        idempotency_key: z.string().optional(),
        project: z.string().optional(),
        title: z.string().optional(),
        done: z.array(z.string()).optional(),
        next: z.array(z.string()).optional(),
        sources: z.array(z.string()).optional(),
        compact_summary: z.array(z.string()).optional(),
        occurred_at: z.string().datetime({ offset: true }).optional(),
      }),
    },
    async ({ date, backfill, ...input }) => {
      const recordedAt = new Date();
      const resolved = resolveActivityWriteDate(date, input.occurred_at, backfill, config, recordedAt);
      return jsonText(await appendActivityEntry(repo, resolved, input, recordedAt));
    },
  );
}
