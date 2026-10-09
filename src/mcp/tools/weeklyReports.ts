/**
 * Registers weekly report generation/read tools using the shared provider runtime.
 * Does not register or change daily tools, automation, or provider selection.
 *
 * 共通Provider runtimeを使う週次レポートの生成・取得ツールを登録します。
 * 日次ツール・自動化・Provider選択は変更しません。
 * @packageDocumentation
 */
import * as z from "zod/v4";
import type { LlmGenerator } from "#llm/types";
import type { ToolRegistrationContext } from "#mcp/tools/context";
import { generateWeeklyReport, readWeeklyReport } from "#domain/reports/weekly/generation";
import { jsonText } from "#mcp/protocol/result";
import { resolveTaskMcpWebBaseUrl } from "#mcp/presentation/webLinks";

/** Builds a range-specific weekly Web link, never a local file path.
 * ローカルパスではなく集計範囲を指定した週次Webリンクを生成します。
 */
export function weeklyReportWebUrl(week: string, through: string, format = "text"): string {
  const base = resolveTaskMcpWebBaseUrl();
  const url = new URL(`${base}/report/weekly/${format}`);
  url.searchParams.set("week", week);
  url.searchParams.set("through", through);
  return url.toString();
}

/** Exposes read and LLM generation for full/partial weeks. 完全週・途中週の取得とLLM生成を公開します。 */
export function registerWeeklyReportTools(
  { server, repo, config }: ToolRegistrationContext,
  generate: LlmGenerator,
): void {
  const schema = z.object({
    week: z.string().optional(),
    through: z.string().optional(),
    format: z.enum(["text", "markdown"]).default("text"),
  });
  for (const generation of [false, true]) {
    server.registerTool(
      generation ? "report_generate_weekly" : "report_get_weekly",
      {
        description: generation
          ? "Generate a separate weekly or partial-week Done/Next report with the selected external LLM. week selects any date in the target week; through is its inclusive operational end date. Defaults to this week through today, using the configured week-start weekday, timezone and existing work-day cutoff. Labels today's/partial periods provisional with a generation timestamp. Reads only dated evidence; never updates daily reports, task state, memory or Activity. Preserves exclusion rules and URLs; no fallback provider. Return the Web URL, not a filesystem path."
          : "Read an existing weekly artifact without generation. week/through select an exact stored range; omitted end defaults to today or the week's end. Reports missing-record dates separately from no work. Display returned web_url.",
        inputSchema: schema,
      },
      async ({ week, through, format }) => {
        const result = generation
          ? await generateWeeklyReport(repo, config, week, through, generate)
          : await readWeeklyReport(repo, config, week, through);
        return jsonText({ ...result, web_url: weeklyReportWebUrl(result.week_start, result.through, format) });
      },
    );
  }
}
