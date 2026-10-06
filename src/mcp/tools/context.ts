/**
 * Defines the minimal runtime context shared by MCP tool registration modules.
 * MCPツール登録モジュール間で共有する最小実行コンテキストを定義します。
 *
 * @remarks
 * It only carries runtime dependencies and does not register tools or implement business behavior.
 * 実行時依存の受け渡しだけを担当し、ツール登録や業務処理は担当しません。
 *
 * @packageDocumentation
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TaskMcpConfig } from "#shared/types";
import type { Repository } from "#infra/repository/repository";

/** Runtime dependencies used by MCP tool groups. MCPツール群が利用する実行時依存オブジェクトです。 */
export interface ToolRegistrationContext {
  server: McpServer;
  repo: Repository;
  config: TaskMcpConfig;
}
