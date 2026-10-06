/**
 * Registers tools for archival cleanup, restoration, and deletion of archived data.
 * データを保持しながら整理するアーカイブ、復元、アーカイブ削除ツールを登録します。
 *
 * @remarks
 * It connects MCP schemas to cleanup use cases and does not select candidates or manipulate files directly.
 * MCP入力スキーマとcleanupユースケースの接続だけを担当し、候補判定やファイル操作は担当しません。
 *
 * @packageDocumentation
 */
import * as z from "zod/v4";
import { archiveCleanup, finalizeCleanupArchive, restoreCleanupArchive, runBackupRetention } from "#app/cleanup";
import { jsonText } from "#mcp/protocol/result";
import type { ToolRegistrationContext } from "#mcp/tools/context";

const targetSchema = z.enum(["outputs", "backups", "request_logs", "agent_update_assets", "system_junk", "all"]);

/** Registers cleanup tools on the MCP server. Cleanup関連のMCPツールを登録します。 */
export function registerCleanupTools({ server, repo, config }: ToolRegistrationContext): void {
  server.registerTool(
    "cleanup_run_retention",
    {
      description:
        "Apply the configured backup retention policy in one operation. It preserves recent generations, archives excess daily/weekly/monthly backups for restoration, and permanently deletes only archived backup data whose configured grace period expired. Other archived targets remain untouched. No LLM is used.",
      inputSchema: z.object({
        dry_run: z.boolean().default(true),
        force: z.boolean().default(false),
      }),
    },
    async (input) => jsonText(await runBackupRetention(repo, config, input)),
  );
  server.registerTool(
    "cleanup_archive_candidates",
    {
      description:
        "Archive cleanup candidates and record a compact restorable archive summary with per-file content summaries. Use cleanup_restore_archive if data is needed again.",
      inputSchema: z.object({
        target: targetSchema.default("outputs"),
        archive_date: z.string().optional(),
        keep_output_dirs: z.array(z.string()).optional(),
        dry_run: z.boolean().default(true),
      }),
    },
    async (input) => jsonText(await archiveCleanup(repo, config, input)),
  );
  server.registerTool(
    "cleanup_restore_archive",
    {
      description:
        "Restore files from cleanup_archive to their original data-root locations when cleanup_archive_candidates archived data that is needed again.",
      inputSchema: z.object({
        archive_date: z.string().optional(),
        target: targetSchema.default("outputs"),
        dry_run: z.boolean().default(false),
        relative_paths: z.array(z.string()).optional(),
      }),
    },
    async (input) => jsonText(await restoreCleanupArchive(repo, config, input)),
  );
  server.registerTool(
    "cleanup_delete_archive",
    {
      description:
        "Delete files already stored in cleanup_archive after they are no longer needed. This never deletes unarchived source files.",
      inputSchema: z.object({
        archive_date: z.string().optional(),
        target: targetSchema.default("outputs"),
        relative_paths: z.array(z.string()).optional(),
        dry_run: z.boolean().default(true),
      }),
    },
    async (input) => jsonText(await finalizeCleanupArchive(repo, config, input)),
  );
}
