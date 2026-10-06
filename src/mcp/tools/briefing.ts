/**
 * Registers the daily briefing generation entry point for AI clients.
 * Responsibility: This module validates MCP input, resolves the operational date, and presents the generated
 * briefing with its Web URL. Non-responsibility: It does not collect external data or invoke an LLM itself.
 *
 * AIクライアント向けの日次ブリーフィング生成入口を登録します。
 * 責務: MCP入力を検証し、運用日を解決し、生成結果とWeb URLを提示します。
 * 非責務: 外部データ収集やLLM呼び出し自体は行いません。
 *
 * @packageDocumentation
 */
import * as z from "zod/v4";
import { resolveDate } from "#shared/date";
import { taskMcpWebLinks } from "#mcp/presentation/webLinks";
import { jsonText } from "#mcp/protocol/result";
import type { ToolRegistrationContext } from "#mcp/tools/context";

/** Result returned by the briefing workflow before MCP presentation. MCP提示前のブリーフィング処理結果です。 */
export interface BriefingGenerationResult {
  save?: unknown;
  [key: string]: unknown;
}

/** Generates and persists one daily briefing. 日次ブリーフィングを生成して保存します。 */
export type BriefingGenerator = (date: string) => Promise<BriefingGenerationResult>;

/** Registers daily briefing tools on the MCP server. 日次ブリーフィングツールをMCPサーバへ登録します。 */
export function registerBriefingTools({ server, config }: ToolRegistrationContext, generate: BriefingGenerator): void {
  server.registerTool(
    "briefing_generate_daily",
    {
      description:
        "Generate today's complete briefing in one operation and return its Web URL. Calendar, Mail, and GitHub collection and sections 1-3 stay local and are never included in the LLM prompt. The configured LLM provider receives curated active-task planning fields plus task-independent Global Memory rules, preferences, and summary so cross-task priorities remain consistent. Never run the configured collector script directly. Only today's operational date is accepted.",
      inputSchema: z.object({
        date: z.string().optional(),
      }),
    },
    async ({ date }) => {
      const resolved = resolveDate(date, config);
      const today = resolveDate(undefined, config);
      if (resolved !== today) throw new Error(`Briefing can only be generated for today (${today}).`);
      const generated = await generate(resolved);
      const result = Object.fromEntries(Object.entries(generated).filter(([key]) => key !== "save"));
      return jsonText({ ...result, web_url: taskMcpWebLinks(resolved).summary });
    },
  );
}
