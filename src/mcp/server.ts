#!/usr/bin/env node
/**
 * Initializes the Personal Context MCP server, assembles runtime dependencies, and manages process lifecycle.
 * Responsibility: This module owns MCP construction, provider selection initialization, tool registration,
 * dependency composition, stdio transport startup, and the optional web monitor lifecycle.
 * Non-responsibility: This module does not implement LLM generation, domain persistence, or session workflows.
 *
 * Personal Context MCPサーバを初期化し、実行時依存を組み立て、プロセスライフサイクルを管理します。
 * 責務: このモジュールは、MCP生成、Provider選択の初期化、ツール登録、依存組立、stdio transport起動、
 * および任意のWeb monitorライフサイクルを担当します。
 * 非責務: このモジュールは、LLM生成、ドメイン永続化、セッションワークフローを実装しません。
 *
 * @packageDocumentation
 */
import type { Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "#infra/config/config";
import { writeRequestLog } from "#infra/audit/requestLog";
import { Repository } from "#infra/repository/repository";
import { syncDataRootReadme } from "#infra/startup/syncReadme";
import { providerConfigSummary, selectLlmProvider } from "#llm/providerSelector";
import { isWebServerEnabled, parseWebServerOptions, startTaskMcpWebServer, stopTaskMcpWebServer } from "#web/server";
import { generateMorningTaskSections, generateWebMorningSummary } from "#web/briefing/generation";
import { createGenerationRuntime } from "#mcp/llm/generationRuntime";
import { installRequestLogging } from "#mcp/middleware/requestLogging";
import { registerBriefingTools } from "#mcp/tools/briefing";
import { registerCleanupTools } from "#mcp/tools/cleanup";
import { registerJournalTools } from "#mcp/tools/journal";
import { registerKnowledgeTools } from "#mcp/tools/knowledge";
import { registerMemoryGenerationTools } from "#mcp/tools/memoryGeneration";
import { registerMemoryStateTools } from "#mcp/tools/memoryState";
import { registerPeopleTools } from "#mcp/tools/people";
import { registerReportTools } from "#mcp/tools/reports";
import { registerWeeklyReportTools } from "#mcp/tools/weeklyReports";
import { registerSessionTools } from "#mcp/tools/session";
import { registerSystemTools } from "#mcp/tools/system";
import { registerTaskTools } from "#mcp/tools/tasks";
import { registerTicketTools } from "#mcp/tools/tickets";
import { createFinishTaskSessionWorkflow } from "#mcp/workflows/finishTaskSession";
import { startBackupRetentionScheduler } from "#app/cleanup";

export {
  buildReportEntriesPrompt,
  mergeDuplicateReportEntries,
  parseGeneratedReportEntries,
} from "#mcp/llm/reportEntries";
export { preserveProposedUpdateUrls } from "#mcp/llm/generationRuntime";

const config = loadConfig();
const repo = new Repository(config);

const serverInstructions = `Personal Context MCP is the source of truth for the user's tasks, activity, memory, knowledge, and people context.
Use child tickets only for independently completable, substantial, delegated or blocked work. Do not ticket short checks, single commands or every utterance. Handle IDs internally without asking the user. Existing Codex tasks may execute several tickets sequentially; new tasks require user authorization and a need for parallelism or isolation. Read ticket revisions before updating; record detail via Activity with ticket_id. Context and Memory keep their existing responsibilities.
Before delegating or starting substantial work, read system_get_usage_guide, Small work tickets. The sender creates a todo ticket and passes it without starting it. Only the receiving worker calls ticket_start_item with its own assignee and latest revision at actual work start; receipt alone leaves it todo.
Before planning, making a decision, recommending an approach, designing a solution, or drafting content, call system_prepare_work with concise reusable domain concepts from the request and task_id when known.
For task-specific documents use task_id, scope=strict and include_context_body=true. Never use another project's work as task evidence. Global situation requires scope=global and include_global_situation=true for cross-task planning only. In strict scope, Knowledge requires explicit knowledge_ids; no automatic neighborhood expansion occurs. Global Memory is opt-in via include_global_memory.
Use the returned Global Memory as user-wide rules, Task Memory as task-specific durable context, and Knowledge as reusable task-independent guidance. Apply Knowledge evidence, applicability, and limitations; never use it as proof of dated work.
Use Knowledge proactively when a conversation establishes a generalized insight reusable across tasks. Save it immediately with knowledge_upsert_note when no task session is being finished, or include it in session_finish_task.knowledge_updates at task-session end. Do not wait for the user to request registration. Reuse an existing note id for the same concept, and do not save dated work, one-task state, person facts, user preferences, or operating rules as Knowledge.
Use People proactively when durable person information appears in the conversation. Call people_find_duplicates before creating a person; immediately capture user-provided or clearly observed profile facts, relationships, and dated interactions with people_capture_update without waiting for an explicit registration request. Never infer missing fields. Keep confirmed, observed, and inferred information distinct. Merge only confirmed duplicate profiles with people_merge_profiles. At session end, use session_finish_task.people_updates only for person information not already captured. Person data is local-only and is never injected into LLM generation or promoted to Knowledge automatically.
Use Activity for dated facts. During work, append checkpoints with activity_append_entry. Call session_finish_task exactly once when one AI thread or task session actually ends; routine completion records Activity and defers LLM report generation. Use report_generate_output when a complete dated output is needed. Use system_get_usage_guide when operation semantics are unclear.`;

/**
 * Creates and configures the Personal Context MCP protocol server.
 *
 * Personal Context MCPプロトコルサーバを作成して構成します。
 */
export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "personal-context-mcp",
      version: "0.1.0",
    },
    { instructions: serverInstructions },
  );
  const configuredProvider = config.reportLlmProvider;
  server.server.oninitialized = () => {
    const selection = selectLlmProvider(configuredProvider, server.server.getClientVersion());
    config.reportLlmProvider = selection.provider;
    const summary = providerConfigSummary(config, selection);
    config.connectedMcpClient = {
      ...selection.client,
      configured_provider: configuredProvider,
      selected_provider: selection.provider,
      selection_reason: selection.reason,
      ...(typeof summary.model === "string" ? { selected_model: summary.model } : {}),
    };
    console.error(`personal-context-mcp LLM provider: ${selection.provider} (${selection.reason})`);
    void writeRequestLog(repo, config, {
      tool: "system_initialize_provider",
      status: "ok",
      duration_ms: 0,
      arguments_summary: summary,
      result_summary: summary,
    }).catch((error: unknown) => console.error("Failed to write provider selection log:", error));
  };

  const context = { server, repo, config };
  installRequestLogging(server, repo, config);
  const generation = createGenerationRuntime(context);

  registerTaskTools(context);
  registerTicketTools(context);
  registerSystemTools(context);
  registerJournalTools(context);
  registerKnowledgeTools(context, {
    promote: ({ taskId, maxNotes, maxTokens }) => generation.promoteTaskMemoryToKnowledge(taskId, maxNotes, maxTokens),
  });
  registerPeopleTools(context);
  registerBriefingTools(context, (date) =>
    generateWebMorningSummary(repo, config, date, undefined, (targetRepo, targetConfig, targetDate) =>
      generateMorningTaskSections(targetRepo, targetConfig, targetDate, (request) =>
        generation.generateStructured(request),
      ),
    ),
  );
  registerReportTools(context, (date, format) => generation.generateDateReport(repo, date, format));
  registerWeeklyReportTools(context, (request) => generation.generateStructured(request));
  registerMemoryStateTools(context);
  registerMemoryGenerationTools(context, {
    promote: ({ date, taskId, lookbackDays, maxTokens, force }) =>
      generation.generateAndApplyMemorySummaryWithLlm(
        repo,
        date,
        { task_id: taskId, lookback_days: lookbackDays, force },
        maxTokens,
      ),
    generateMindMap: (taskId, maxTokens) => generation.generateTaskMemoryMindMapWithLlm(taskId, maxTokens),
  });
  registerSessionTools(context, createFinishTaskSessionWorkflow({ repo, config, generation }));
  registerCleanupTools(context);

  return server;
}

/**
 * Runs the stdio MCP server and its optional co-located web monitor.
 *
 * stdio MCPサーバと任意の同居Web monitorを起動します。
 */
export async function runMcpServer(): Promise<void> {
  await syncDataRootReadme(repo);
  const stopMaintenance = startBackupRetentionScheduler(repo, config);
  let webServer: HttpServer | undefined;
  if (isWebServerEnabled()) {
    try {
      const webOptions = parseWebServerOptions(["node", "personal-context-mcp-web"], process.env);
      webServer = await startTaskMcpWebServer(repo, config, webOptions);
      console.error(`personal-context-mcp monitor running at http://${webOptions.host}:${webOptions.port}`);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`personal-context-mcp monitor not started: ${detail}`);
    }
  }
  const server = createServer();
  const transport = new StdioServerTransport();
  const stopWebServer = async (): Promise<void> => {
    const current = webServer;
    webServer = undefined;
    if (!current) return;
    await stopTaskMcpWebServer(current);
    console.error("personal-context-mcp monitor stopped");
  };
  const handleInputClose = (): void => {
    stopMaintenance();
    void stopWebServer().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`personal-context-mcp monitor shutdown failed: ${detail}`);
    });
  };
  process.stdin.once("end", handleInputClose);
  process.stdin.once("close", handleInputClose);
  await server.connect(transport);
  console.error(`personal-context-mcp running on stdio with data root: ${repo.root}`);
}
