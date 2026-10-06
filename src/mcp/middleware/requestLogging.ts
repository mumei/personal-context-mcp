/**
 * Installs transparent audit logging around every registered MCP tool handler.
 * 登録されたすべてのMCPツールハンドラーへ透過的な監査ログ記録を追加します。
 *
 * @remarks
 * This module records sanitized arguments, results, duration, and errors. It does not define tools or business behavior.
 * このモジュールはサニタイズ済み引数・結果・所要時間・エラーを記録し、ツール定義や業務処理は担当しません。
 *
 * @packageDocumentation
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  summarizeErrorMessage,
  summarizeToolArguments,
  summarizeToolResult,
  writeRequestLog,
} from "#infra/audit/requestLog";
import type { Repository } from "#infra/repository/repository";
import type { TaskMcpConfig } from "#shared/types";
import { requestLogIdentity, toolResultPayload } from "#mcp/protocol/result";

/** Installs request logging before tools are registered. ツール登録前にリクエストログ処理を導入します。 */
export function installRequestLogging(server: McpServer, repo: Repository, config: TaskMcpConfig): void {
  const originalRegisterTool = server.registerTool.bind(server) as unknown as (
    name: string,
    options: unknown,
    handler: (args: unknown, extra: unknown) => Promise<unknown> | unknown,
  ) => unknown;
  server.registerTool = ((
    name: string,
    options: unknown,
    handler: (args: unknown, extra: unknown) => Promise<unknown> | unknown,
  ) =>
    originalRegisterTool(name, options, async (args: unknown, extra: unknown) => {
      const started = Date.now();
      try {
        const result = await handler(args, extra);
        await writeRequestLog(repo, config, {
          tool: String(name),
          status: "ok",
          duration_ms: Date.now() - started,
          ...requestLogIdentity(extra),
          arguments_summary: summarizeToolArguments(args),
          result_summary: summarizeToolResult(toolResultPayload(result)),
        }).catch((error: unknown) => console.error("Failed to write request log:", error));
        return result;
      } catch (error) {
        await writeRequestLog(repo, config, {
          tool: String(name),
          status: "error",
          duration_ms: Date.now() - started,
          ...requestLogIdentity(extra),
          arguments_summary: summarizeToolArguments(args),
          error: {
            name: error instanceof Error ? error.name : undefined,
            message: summarizeErrorMessage(error instanceof Error ? error.message : String(error)),
            fallback_reason_codes: Array.isArray((error as { fallback_reason_codes?: unknown }).fallback_reason_codes)
              ? (error as { fallback_reason_codes: unknown[] }).fallback_reason_codes
              : undefined,
          },
        }).catch((logError: unknown) => console.error("Failed to write request log:", logError));
        throw error;
      }
    })) as unknown as typeof server.registerTool;
}
