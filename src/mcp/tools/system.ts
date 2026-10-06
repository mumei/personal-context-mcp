/**
 * Registers system tools for guidance, search, situation retrieval, date catalogs, and validation.
 * 利用ガイド、検索、状況取得、日付一覧、データ検証のSystemツールを登録します。
 *
 * @remarks
 * It exposes cross-cutting read use cases and delegates search and validation logic to the application layer.
 * 読み取り中心の横断ユースケースをMCPへ公開し、検索・検証ロジック自体はapplication層へ委譲します。
 *
 * @packageDocumentation
 */
import * as z from "zod/v4";
import { listDataDates } from "#app/catalog";
import { searchTaskContext } from "#app/search";
import { getUserSituation } from "#app/situation";
import { getUsageGuide } from "#app/usageGuide";
import { validateData } from "#app/validation";
import { prepareWork } from "#app/workPreparation";
import { recordKnowledgeUsage } from "#infra/audit/knowledgeUsage";
import { resolveDate } from "#shared/date";
import { taskMcpWebLinks } from "#mcp/presentation/webLinks";
import { jsonText } from "#mcp/protocol/result";
import type { ToolRegistrationContext } from "#mcp/tools/context";

/** Registers cross-cutting system tools on the MCP server. 横断的なSystem MCPツールを登録します。 */
export function registerSystemTools({ server, repo, config }: ToolRegistrationContext): void {
  server.registerTool(
    "system_get_usage_guide",
    { description: "Get Personal Context MCP data-operation guidance for AI clients.", inputSchema: z.object({}) },
    async () => jsonText({ guide: getUsageGuide() }),
  );
  server.registerTool(
    "system_prepare_work",
    {
      description:
        "Prepare bounded read-only context before planning, decisions, recommendations, design, or drafting. Pass concise reusable domain concepts, not the entire conversation. task_id defaults to strict isolation: only the target task context, memory and situation, plus explicitly selected knowledge_ids (no graph expansion). Use include_context_body=true for documents. Cross-task situation requires scope=global and include_global_situation=true; Global Memory requires include_global_memory=true. No automatic related-task expansion. Skip for simple status reads or mechanical operations.",
      inputSchema: z.object({
        query: z.string().min(1),
        task_id: z.string().optional(),
        scope: z.enum(["strict", "global"]).optional(),
        include_global_situation: z.boolean().default(false),
        include_global_memory: z.boolean().default(false),
        knowledge_ids: z.array(z.string().min(1)).max(25).default([]),
        date: z.string().optional(),
        lookback_days: z.number().int().positive().max(90).default(config.defaultLookbackDays),
        knowledge_depth: z.number().int().min(0).max(3).default(1),
        knowledge_limit: z.number().int().positive().max(25).default(10),
        include_context_body: z.boolean().default(false),
      }),
      annotations: {
        title: "Prepare Work Context",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      query,
      task_id,
      date,
      lookback_days,
      knowledge_depth,
      knowledge_limit,
      include_context_body,
      scope,
      include_global_situation,
      include_global_memory,
      knowledge_ids,
    }) => {
      const prepared = await prepareWork(repo, {
        query,
        taskId: task_id,
        scope,
        includeGlobalSituation: include_global_situation,
        includeGlobalMemory: include_global_memory,
        knowledgeIds: knowledge_ids,
        date: resolveDate(date, config),
        lookbackDays: lookback_days,
        knowledgeDepth: knowledge_depth,
        knowledgeLimit: knowledge_limit,
        includeContextBody: include_context_body,
      });
      await recordKnowledgeUsage(repo, config, {
        workflow: "system_prepare_work",
        stage: "delivered_to_client",
        date: prepared.date,
        contexts: [{ ...(task_id ? { task_id } : {}), knowledge: prepared.knowledge }],
      }).catch((error: unknown) => console.error("Failed to write Knowledge usage log:", error));
      return jsonText(prepared);
    },
  );
  server.registerTool(
    "system_list_data_dates",
    {
      description: "List dates that have inputs, activities, reports, or agent update queues.",
      inputSchema: z.object({}),
    },
    async () => jsonText(await listDataDates(repo)),
  );
  server.registerTool(
    "system_search_context",
    {
      description:
        "Search all task, context, input, work-log, report, memory, and agent-update history with optional filters.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().positive().max(100).default(20),
        task_id: z.string().optional(),
        project: z.string().optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        section: z.union([z.string(), z.array(z.string())]).optional(),
        terms_mode: z.enum(["all", "any"]).default("all"),
        include_deleted: z.boolean().default(false),
      }),
    },
    async ({ query, limit, ...options }) => {
      const matches = await searchTaskContext(repo, query, limit, options);
      return jsonText({ count: matches.length, matches });
    },
  );
  server.registerTool(
    "system_get_user_situation",
    {
      description:
        "Get cross-task situation summary with handoff-health coverage, source-backed decisions and next actions, and the Web summary URL. Present web_url in chat instead of local source paths unless source diagnostics were explicitly requested.",
      inputSchema: z.object({
        date: z.string().optional(),
        lookback_days: z.number().int().positive().max(90).default(config.defaultLookbackDays),
      }),
    },
    async ({ date, lookback_days }) => {
      const resolved = resolveDate(date, config);
      return jsonText({
        ...(await getUserSituation(repo, resolved, lookback_days)),
        web_url: taskMcpWebLinks(resolved).summary,
        web_links: taskMcpWebLinks(resolved),
      });
    },
  );
  server.registerTool(
    "system_validate_data",
    {
      description:
        "Validate task data references such as duplicate task ids and unknown task ids in activities/reports.",
      inputSchema: z.object({}),
    },
    async () => jsonText(await validateData(repo)),
  );
}
