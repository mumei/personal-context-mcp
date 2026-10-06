#!/usr/bin/env node

/**
 * Provides server capabilities for the package entrypoint layer.
 * Responsibility: This module owns the server behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * パッケージエントリポイント層のserver機能を提供します。
 * 責務: このモジュールは、ここで宣言するserverの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */
export * from "#mcp/server";
import { runMcpServer } from "#mcp/server";
import { isMainModule } from "#shared/isMainModule";

if (isMainModule(import.meta.url)) {
  runMcpServer().catch((error: unknown) => {
    console.error("Fatal error in personal-context-mcp:", error);
    process.exit(1);
  });
}
