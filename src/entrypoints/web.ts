#!/usr/bin/env node

/**
 * Provides web capabilities for the executable entrypoint layer.
 * Responsibility: This module owns the web behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * 実行エントリポイント層のweb機能を提供します。
 * 責務: このモジュールは、ここで宣言するwebの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */
import { runWebServer } from "#web/server";

runWebServer().catch((error: unknown) => {
  console.error("Fatal error in personal-context-mcp monitor:", error);
  process.exit(1);
});
