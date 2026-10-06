/**
 * Registers MCP tools for structured daily reports, overrides, rendering, and generated outputs.
 * 日次レポートの構造化データ、上書き、レンダリング、生成結果を公開するMCPツールを登録します。
 *
 * @remarks
 * It owns tool schemas and output metadata while receiving the LLM generation workflow from the caller.
 * ツールスキーマと出力メタデータを担当し、LLM生成ワークフローは呼び出し側から注入します。
 *
 * @packageDocumentation
 */
import { stat } from "node:fs/promises";
import * as z from "zod/v4";
import { listOutputDates } from "#app/catalog";
import { updateReportEntry } from "#domain/reports/actions";
import { generateReport } from "#domain/reports/render";
import { setTaskReportVisibility } from "#domain/tasks/actions";
import { resolveDate } from "#shared/date";
import { reportWebUrl, taskMcpWebLinks, withoutPersistencePaths } from "#mcp/presentation/webLinks";
import { jsonText } from "#mcp/protocol/result";
import type { ToolRegistrationContext } from "#mcp/tools/context";

/** Contract for LLM-backed daily report generation. LLMを伴う日次レポート生成関数の契約です。 */
export type GenerateDateReport = (date: string, format: "text" | "markdown" | "html") => Promise<unknown>;

/** Registers report-related MCP tools. レポート関連MCPツールを登録します。 */
export function registerReportTools(
  { server, repo, config }: ToolRegistrationContext,
  generateDateReport: GenerateDateReport,
): void {
  server.registerTool(
    "report_set_task_visibility",
    {
      description:
        "Include or exclude one task from all generated reports without deleting its task data, Activity, Context, or Task Memory. Excluded tasks are also ignored by unreflected-Activity warnings. Use visible=true to restore report inclusion.",
      inputSchema: z.object({
        task_id: z.string(),
        visible: z.boolean(),
        date: z.string().optional(),
        render_formats: z.array(z.enum(["text", "markdown", "html"])).optional(),
      }),
    },
    async ({ task_id, visible, date, render_formats }) =>
      jsonText(
        await repo.withTransaction(async () => {
          const updated = await setTaskReportVisibility(repo, task_id, visible);
          const outputs = [];
          const resolved = resolveDate(date, config);
          for (const format of render_formats ?? []) {
            outputs.push(await generateReport(repo, resolved, true, format));
          }
          return withoutPersistencePaths({
            ...updated,
            outputs,
            web_url: reportWebUrl(resolved, render_formats?.includes("markdown") ? "markdown" : "text"),
          });
        }),
      ),
  );
  server.registerTool(
    "report_get_daily",
    {
      description:
        "Get structured report source by date and its Web URL. Present web_url in chat instead of a local filesystem path.",
      inputSchema: z.object({ date: z.string().optional() }),
    },
    async ({ date }) => {
      const resolved = resolveDate(date, config);
      return jsonText({ ...(await repo.loadReport(resolved)), web_url: reportWebUrl(resolved, "text") });
    },
  );
  server.registerTool(
    "report_update_entry",
    {
      description:
        "Set a persistent per-date report override without changing activities. replace/append survive regeneration, delete persistently hides the entry, and clear_override returns it to normal generation.",
      inputSchema: z.object({
        date: z.string().optional(),
        task_id: z.string(),
        mode: z.enum(["replace", "append", "delete", "clear_override"]),
        done: z.array(z.string()).optional(),
        next: z.array(z.string()).optional(),
        today_diff_heading_only: z.boolean().optional(),
        today_diff_order: z.number().optional(),
        render_formats: z.array(z.enum(["text", "markdown", "html"])).optional(),
      }),
    },
    async ({ date, render_formats, ...input }) => {
      const resolved = resolveDate(date, config);
      return jsonText(
        await repo.withTransaction(async () => {
          const updated = await updateReportEntry(repo, resolved, input);
          const outputs = [];
          for (const format of render_formats ?? []) outputs.push(await generateReport(repo, resolved, true, format));
          return withoutPersistencePaths({
            ...updated,
            outputs,
            web_url: reportWebUrl(resolved, render_formats?.includes("markdown") ? "markdown" : "text"),
            web_links: taskMcpWebLinks(resolved),
          });
        }),
      );
    },
  );
  server.registerTool(
    "report_get_output",
    {
      description:
        "Get a rendered output by renderer and date. Present the returned web_url in chat instead of a local filesystem path.",
      inputSchema: z.object({
        date: z.string().optional(),
        renderer: z.string().default(config.defaultRenderer),
        extension: z.string().default("txt"),
      }),
    },
    async ({ date, renderer, extension }) => {
      const resolved = resolveDate(date, config);
      const reportText = await repo.loadOutput(renderer, resolved, extension);
      const path = repo.pathFor(config.layout.outputs, renderer, `${resolved}.${extension}`);
      const metadata = await stat(path)
        .then((info) => ({ size_bytes: info.size, generated_at: info.mtime.toISOString() }))
        .catch(() => ({}));
      return jsonText({
        date: resolved,
        renderer,
        extension,
        exists: reportText !== null,
        text: reportText,
        ...metadata,
        web_url: reportWebUrl(resolved, renderer === "markdown" || extension === "md" ? "markdown" : "text"),
      });
    },
  );
  server.registerTool(
    "report_render_output",
    {
      description: "Render existing task and report data without calling an LLM.",
      inputSchema: z.object({
        date: z.string().optional(),
        format: z.enum(["text", "markdown", "html"]).default("text"),
        write: z.boolean().default(true),
      }),
    },
    async ({ date, format, write }) => {
      const resolved = resolveDate(date, config);
      return jsonText(
        withoutPersistencePaths({
          ...(await generateReport(repo, resolved, write, format)),
          date: resolved,
          format,
          written: write,
          web_url: reportWebUrl(resolved, format),
        }),
      );
    },
  );
  server.registerTool(
    "report_list_outputs",
    {
      description:
        "List generated output dates with browser URLs for a renderer and optional extension. Do not present local filesystem paths in chat.",
      inputSchema: z.object({ renderer: z.string().default(config.defaultRenderer), extension: z.string().optional() }),
    },
    async ({ renderer, extension }) => {
      const listed = await listOutputDates(repo, renderer, extension);
      const resolvedExtension = extension ?? (renderer === "markdown" ? "md" : renderer === "html" ? "html" : "txt");
      const outputs = await Promise.all(
        listed.dates.map(async (date) => {
          const path = repo.pathFor(config.layout.outputs, renderer, `${date}.${resolvedExtension}`);
          return stat(path)
            .then((info) => ({
              date,
              size_bytes: info.size,
              generated_at: info.mtime.toISOString(),
              web_url: reportWebUrl(date, renderer === "markdown" || resolvedExtension === "md" ? "markdown" : "text"),
            }))
            .catch(() => ({
              date,
              web_url: reportWebUrl(date, renderer === "markdown" || resolvedExtension === "md" ? "markdown" : "text"),
            }));
        }),
      );
      return jsonText({ ...listed, outputs });
    },
  );
  server.registerTool(
    "report_generate_output",
    {
      description:
        "Generate daily report entries, task snapshots, and the latest task display summary with the selected external LLM provider, then render text, markdown, or html. Reads durable memory as context but never modifies it. If the selected LLM provider fails, fail without switching providers or producing deterministic output. Present the returned web_url in chat instead of a local filesystem path.",
      inputSchema: z.object({
        date: z.string().optional(),
        format: z.enum(["text", "markdown", "html"]).default("text"),
      }),
    },
    async ({ date, format }) => {
      const resolved = resolveDate(date, config);
      return jsonText(
        withoutPersistencePaths({
          ...((await generateDateReport(resolved, format)) as Record<string, unknown>),
          web_url: reportWebUrl(resolved, format),
          web_links: taskMcpWebLinks(resolved),
        }),
      );
    },
  );
}
