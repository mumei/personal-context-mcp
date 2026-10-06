/**
 * Registers tools for task queries, creation, updates, logical deletion, restoration, and context updates.
 * タスクの参照、作成、更新、論理削除、復元、コンテキスト更新ツールを登録します。
 *
 * @remarks
 * It connects MCP schemas to domain operations and does not own task rules or persistence.
 * MCPスキーマとドメイン操作の接続だけを担当し、タスク更新ルールや永続化は担当しません。
 *
 * @packageDocumentation
 */
import * as z from "zod/v4";
import { addTask, deleteTask, restoreTask, updateTask, updateTaskContext } from "#domain/tasks/actions";
import { isTaskDeleted } from "#domain/tasks/state";
import { jsonText } from "#mcp/protocol/result";
import type { ToolRegistrationContext } from "#mcp/tools/context";

/** Registers public task tools on the MCP server. タスク関連の公開MCPツールをサーバへ登録します。 */
export function registerTaskTools({ server, repo }: ToolRegistrationContext): void {
  server.registerTool(
    "task_list_items",
    {
      description: "List tasks from the configured data root.",
      inputSchema: z.object({
        status: z.union([z.string(), z.array(z.string())]).optional(),
        project: z.string().optional(),
        tier: z.number().int().min(1).max(3).optional(),
        include_done: z.boolean().default(false),
        include_deleted: z.boolean().default(false),
      }),
    },
    async ({ status, project, tier, include_done, include_deleted }) => {
      const doc = await repo.loadTasks();
      const statuses = Array.isArray(status) ? status : status ? [status] : undefined;
      const tasks = doc.tasks.filter((task) => {
        if (!include_deleted && isTaskDeleted(task)) return false;
        if (!include_done && task.status === "done") return false;
        if (statuses && (!task.status || !statuses.includes(task.status))) return false;
        if (project && task.project !== project) return false;
        if (tier && task.tier !== tier) return false;
        return true;
      });
      return jsonText({ count: tasks.length, tasks });
    },
  );

  server.registerTool(
    "task_get_item",
    {
      description: "Get one task and its context frontmatter/body.",
      inputSchema: z.object({
        task_id: z.string(),
        include_context_body: z.boolean().default(false),
        include_deleted: z.boolean().default(false),
      }),
    },
    async ({ task_id, include_context_body, include_deleted }) => {
      const doc = await repo.loadTasks();
      const task = doc.tasks.find((item) => item.id === task_id);
      if (!task || (!include_deleted && isTaskDeleted(task))) throw new Error(`Task not found: ${task_id}`);
      const context = await repo.loadTaskContext(task);
      return jsonText({
        task,
        context_frontmatter: context.data,
        context_body: include_context_body ? context.body : undefined,
      });
    },
  );

  server.registerTool(
    "task_create_item",
    {
      description: "Create a task and its context file.",
      inputSchema: z.object({
        id: z.string(),
        title: z.string(),
        project: z.string().optional(),
        tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        status: z
          .enum(["todo", "inProgress", "done", "waiting", "blocked"])
          .default("todo")
          .describe(
            "Use waiting only for an external response or event. Use blocked for an explicit stop, suspension, or concrete blocker.",
          ),
        due: z.string().nullable().optional(),
        context: z.string().optional(),
        compact_summary: z.array(z.string()).optional(),
        context_body: z.string().optional(),
        report_exclude: z.boolean().optional(),
        cadence: z.string().optional(),
        activity_aliases: z.array(z.string().min(1)).optional(),
      }),
    },
    async (input) => jsonText(await addTask(repo, input)),
  );

  server.registerTool(
    "task_update_item",
    {
      description: "Update an existing task's state, priority, due date, title, project, or report flags.",
      inputSchema: z.object({
        task_id: z.string(),
        title: z.string().optional(),
        project: z.string().optional(),
        tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        status: z
          .enum(["todo", "inProgress", "done", "waiting", "blocked"])
          .optional()
          .describe(
            "Use waiting only for an external response or event. Use blocked for an explicit stop, suspension, or concrete blocker. Never map an explicit stop to waiting.",
          ),
        due: z.string().nullable().optional(),
        completed_on: z.string().nullable().optional(),
        blocked_by: z.array(z.string()).optional(),
        report_exclude: z.boolean().optional(),
        cadence: z.string().optional(),
        activity_aliases: z.array(z.string().min(1)).optional(),
        fields_to_clear: z
          .array(
            z.enum([
              "project",
              "tier",
              "due",
              "completed_on",
              "blocked_by",
              "report_exclude",
              "cadence",
              "activity_aliases",
            ]),
          )
          .optional(),
      }),
    },
    async (input) => jsonText(await updateTask(repo, input)),
  );

  server.registerTool(
    "task_delete_item",
    {
      description:
        "Logically delete a task. The task, context, memory, activities, and report history remain stored, but current lists, situation retrieval, search, and report generation exclude it.",
      inputSchema: z.object({ task_id: z.string() }),
    },
    async ({ task_id }) => jsonText(await deleteTask(repo, task_id)),
  );
  server.registerTool(
    "task_restore_item",
    {
      description: "Restore a logically deleted task to current lists, retrieval, and report generation.",
      inputSchema: z.object({ task_id: z.string() }),
    },
    async ({ task_id }) => jsonText(await restoreTask(repo, task_id)),
  );
  server.registerTool(
    "task_update_context",
    {
      description: "Update a task context frontmatter and optionally replace or append the Markdown body.",
      inputSchema: z.object({
        task_id: z.string(),
        compact_summary: z.array(z.string()).optional(),
        sources: z.array(z.string()).optional(),
        frontmatter: z.record(z.string(), z.unknown()).optional(),
        body: z.string().optional(),
        body_mode: z.enum(["preserve", "replace", "append"]).default("preserve"),
        fields_to_clear: z
          .array(z.enum(["compact_summary", "sources", "risks", "facts", "decisions", "next"]))
          .optional(),
      }),
    },
    async (input) => jsonText(await updateTaskContext(repo, input)),
  );
}
