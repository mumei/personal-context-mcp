/**
 * @packageDocumentation
 * Matches Web API paths and methods and dispatches requests to application operations.
 * It does not create, start, or stop the server, authenticate requests, or serve static assets.
 * Web API のパスとメソッドを判定し、リクエストを各アプリケーション処理へ振り分ける。
 * サーバーの生成・起動・停止、リクエスト認証、静的アセット配信は担当しない。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  completeDailyTaskSettings,
  dailyTaskModelOptions,
  inspectDailyTaskClients,
  loadDailyTaskSettings,
  prepareDailyTaskSettings,
  updateDailyTaskSettings,
  type DailyTaskRunner,
  type DailyTaskSettings,
} from "#infra/config/dailyTask";
import { parseActivityRolloverHour, profileSettingsView, updateProfileSettings } from "#infra/config/profileSettings";
import {
  maintenanceSettingsView,
  updateMaintenanceSettings,
  type StoredMaintenanceSettings,
} from "#infra/config/maintenanceSettings";
import { runBackupRetention } from "#app/cleanup";
import { getKnowledgeUsageSummary } from "#infra/audit/knowledgeUsage";
import { Repository } from "#infra/repository/repository";
import { generateDateReportWithExternalLlm } from "#domain/reports/generation";
import { generateReport } from "#domain/reports/render";
import { getKnowledgeNote, searchKnowledge } from "#domain/knowledge/actions";
import { KNOWLEDGE_NODE_TYPES } from "#domain/knowledge/validation";
import { setTaskReportVisibility } from "#domain/tasks/actions";
import { getPersonProfile, listPersonProfiles } from "#domain/people/actions";
import { isTaskDeleted } from "#domain/tasks/state";
import { searchTaskContext } from "#app/search";
import { operationalDateRange, resolveDate, todayInTimeZone } from "#shared/date";
import {
  deriveCurrentStatus,
  latestDatedActivity,
  latestDatedNextActivity,
  type DatedActivityEntry,
} from "#shared/currentStatus";
import type { TaskMcpConfig } from "#shared/types";
import { resolveExternalLlmModel } from "#llm/providerRuntime";
import type { ExternalLlmProvider } from "#llm/types";
import {
  buildOverview,
  checkMorningTaskProgress,
  generateWebLlm,
  generateWebMorningSummary,
  generateWebTaskMindMap,
  loadWebReportOutputs,
  organizeWebTaskInformation,
  renderMarkdownBody,
  resolveWebAgentUpdatesWithAi,
  webExternalProvider,
} from "#web/application";
import { json, readJsonBody } from "#web/http/response";
import { knowledgeGraphView } from "#web/knowledge/view";
import { buildActivityCalendar } from "#web/activity/calendar";
import { generateWeeklyReport, readWeeklyReport } from "#domain/reports/weekly/generation";
import { listWeeklyHistory } from "#domain/reports/weekly/history";
import { loadReportSettings, reportSettingsPath, updateReportSettings } from "#infra/config/reportSettings";
import { resolveWeeklyPeriod } from "#domain/reports/weekly/range";
import { ticketApi, ticketDetailApi } from "#web/http/tickets";

/**
 * Returns whether a request is an allowed mutating Web API operation.
 * リクエストが許可された更新系 Web API 操作かを返す。
 */
export function isAllowedMutation(method: string | undefined, pathname: string): boolean {
  if (method === "GET") return true;
  if (method === "PUT" && pathname === "/api/tickets") return true;
  return (
    (method === "POST" &&
      [
        "/api/summary/generate",
        "/api/summary/progress",
        "/api/report/generate",
        "/api/report/weekly/generate",
        "/api/global/resolve-agent-updates",
        "/api/settings/maintenance/run",
      ].includes(pathname)) ||
    (method === "POST" &&
      ["/api/settings/daily-task/prepare", "/api/settings/daily-task/complete"].includes(pathname)) ||
    (method === "POST" && /^\/api\/task\/[^/]+\/(?:mindmap|organize)$/.test(pathname)) ||
    (method === "PUT" && /^\/api\/task\/[^/]+\/report-visibility$/.test(pathname)) ||
    (method === "PUT" &&
      [
        "/api/settings/daily-task",
        "/api/settings/profile",
        "/api/settings/maintenance",
        "/api/settings/report",
      ].includes(pathname))
  );
}

function connectedRunner(name?: string): DailyTaskRunner | undefined {
  const normalized = name?.toLowerCase() ?? "";
  if (normalized.includes("cursor")) return "cursor";
  if (normalized.includes("copilot")) return "copilot_cli";
  if (normalized.includes("gemini")) return "gemini_cli";
  if (normalized.includes("claude") && normalized.includes("desktop")) return "claude_desktop";
  if (normalized.includes("claude")) return "claude_code_loop";
  if (normalized.includes("codex") || normalized.includes("openai") || normalized.includes("chatgpt")) return "codex";
  return undefined;
}

function dailyTaskUpdateFromBody(body: Record<string, unknown>): DailyTaskSettings {
  const runner = ["codex", "cursor", "claude_code_loop", "claude_desktop", "copilot_cli", "gemini_cli"].includes(
    String(body.runner),
  )
    ? (body.runner as DailyTaskRunner)
    : ("" as DailyTaskRunner);
  return {
    version: 1,
    name: typeof body.name === "string" ? body.name : "",
    prompt: typeof body.prompt === "string" ? body.prompt : "",
    enabled: body.enabled === true,
    runner,
    schedule: typeof body.schedule === "string" ? body.schedule : "",
    timezone: typeof body.timezone === "string" ? body.timezone : "",
    model: typeof body.model === "string" ? body.model : "",
    reasoning_effort:
      body.reasoning_effort === "low" || body.reasoning_effort === "medium" || body.reasoning_effort === "high"
        ? body.reasoning_effort
        : ("" as never),
    workspace: typeof body.workspace === "string" ? body.workspace : "",
    claude_loop_interval: typeof body.claude_loop_interval === "string" ? body.claude_loop_interval : "",
  };
}

/**
 * Dispatches an API request to the corresponding read, generation, or configuration operation.
 * API リクエストを対応する読み取り、生成、設定処理へ振り分ける。
 */
export async function handleApi(
  url: URL,
  req: IncomingMessage,
  repo: Repository,
  config: TaskMcpConfig,
  res: ServerResponse,
): Promise<void> {
  const date = url.searchParams.get("date") ?? undefined;
  if (url.pathname === "/api/settings/report") {
    if (req.method === "GET") json(res, { ...loadReportSettings(repo.root), path: reportSettingsPath(repo.root) });
    else if (req.method === "PUT") {
      const body = await readJsonBody(req);
      json(res, await updateReportSettings(repo, { week_start_day: body.week_start_day as number }));
    } else json(res, { error: "Method not allowed." }, 405);
    return;
  }
  if (url.pathname === "/api/report/weekly/history") {
    if (req.method !== "GET") json(res, { error: "Method not allowed." }, 405);
    else json(res, await listWeeklyHistory(repo, config));
    return;
  }
  if (url.pathname === "/api/report/weekly" || url.pathname === "/api/report/weekly/generate") {
    const generating = url.pathname.endsWith("/generate");
    if (req.method !== (generating ? "POST" : "GET")) {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const body = generating
      ? await readJsonBody(req)
      : { week: url.searchParams.get("week") ?? undefined, through: url.searchParams.get("through") ?? undefined };
    if (
      (body.week !== undefined && typeof body.week !== "string") ||
      (body.through !== undefined && typeof body.through !== "string")
    ) {
      json(res, { error: "week and through must be dates in YYYY-MM-DD format." }, 400);
      return;
    }
    let savedResult: Awaited<ReturnType<typeof readWeeklyReport>> | undefined;
    try {
      if (generating)
        resolveWeeklyPeriod(
          config,
          loadReportSettings(repo.root).week_start_day,
          body.week as string | undefined,
          body.through as string | undefined,
        );
      else
        savedResult = await readWeeklyReport(
          repo,
          config,
          body.week as string | undefined,
          body.through as string | undefined,
        );
    } catch (error) {
      json(res, { error: error instanceof Error ? error.message : String(error) }, 400);
      return;
    }
    const result = generating
      ? await generateWeeklyReport(
          repo,
          config,
          body.week as string | undefined,
          body.through as string | undefined,
          (input) => generateWebLlm(config, input),
        )
      : savedResult!;
    json(res, { ...result, markdown: { ...result.markdown, html: renderMarkdownBody(result.markdown.text) } });
    return;
  }
  if (url.pathname === "/api/tickets/detail") {
    await ticketDetailApi(req, res, repo, url);
    return;
  }
  if (["/api/tickets", "/api/tickets/events"].includes(url.pathname)) {
    await ticketApi(req, res, repo, url.pathname.endsWith("/events"), resolveDate(undefined, config));
    return;
  }
  if (url.pathname === "/api/activity-calendar") {
    if (req.method !== "GET") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (Boolean(from) !== Boolean(to)) {
      json(res, { error: "from and to must be supplied together." }, 400);
      return;
    }
    try {
      const today = todayInTimeZone(config.timezone);
      json(res, await buildActivityCalendar(repo, config, from ?? today, to ?? today));
    } catch (error) {
      json(res, { error: error instanceof Error ? error.message : String(error) }, 400);
    }
    return;
  }
  if (url.pathname === "/api/knowledge/graph") {
    if (req.method !== "GET") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const requestedType = url.searchParams.get("type") ?? undefined;
    const type = KNOWLEDGE_NODE_TYPES.find((candidate) => candidate === requestedType);
    if (requestedType && !type) {
      json(res, { error: `Unsupported knowledge node type: ${requestedType}` }, 400);
      return;
    }
    const graph = await searchKnowledge(repo, {
      query: url.searchParams.get("query") ?? undefined,
      type,
      tags: url.searchParams.getAll("tag"),
      depth: boundedInteger(url.searchParams.get("depth"), 1, 0, 3),
      limit: boundedInteger(url.searchParams.get("limit"), 100, 1, 250),
    });
    json(res, knowledgeGraphView(graph));
    return;
  }
  if (url.pathname === "/api/knowledge/usage") {
    if (req.method !== "GET") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    json(
      res,
      await getKnowledgeUsageSummary(repo, {
        days: boundedInteger(url.searchParams.get("days"), 30, 1, 365),
        limit: boundedInteger(url.searchParams.get("limit"), 20, 1, 200),
      }),
    );
    return;
  }
  if (url.pathname === "/api/people") {
    if (req.method !== "GET") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    json(
      res,
      await listPersonProfiles(repo, {
        query: url.searchParams.get("query") ?? undefined,
        relationship_status:
          url.searchParams.get("status") === "active" || url.searchParams.get("status") === "inactive"
            ? (url.searchParams.get("status") as "active" | "inactive")
            : undefined,
        include_deleted: url.searchParams.get("include_deleted") === "true",
      }),
    );
    return;
  }
  const personMatch = url.pathname.match(/^\/api\/people\/([^/]+)$/);
  if (personMatch) {
    if (req.method !== "GET") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    try {
      json(
        res,
        await getPersonProfile(repo, decodeURIComponent(personMatch[1]), {
          include_deleted: url.searchParams.get("include_deleted") === "true",
          interaction_limit: boundedInteger(url.searchParams.get("interaction_limit"), 50, 1, 200),
        }),
      );
    } catch (error) {
      json(res, { error: error instanceof Error ? error.message : String(error) }, 404);
    }
    return;
  }
  const knowledgeNoteMatch = url.pathname.match(/^\/api\/knowledge\/note\/([^/]+)$/);
  if (knowledgeNoteMatch) {
    if (req.method !== "GET") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const id = decodeURIComponent(knowledgeNoteMatch[1]);
    const result = await getKnowledgeNote(
      repo,
      id,
      boundedInteger(url.searchParams.get("depth"), 1, 0, 3),
      boundedInteger(url.searchParams.get("limit"), 25, 1, 100),
    );
    const graph = knowledgeGraphView(result.graph, result.note);
    json(res, { note: graph.nodes.find((node) => node.id === result.note.id), graph });
    return;
  }
  if (url.pathname === "/api/settings/automation-status") {
    if (req.method !== "GET") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const client = config.connectedMcpClient;
    const selectedProvider = client?.selected_provider ?? webExternalProvider(config);
    const providers: Array<{ id: ExternalLlmProvider; command: string }> = [
      { id: "codex_app_server", command: config.codexAppServerCommand },
      { id: "claude_cli", command: config.claudeCliCommand },
      { id: "copilot_cli", command: config.copilotCliCommand },
      { id: "cursor_cli", command: config.cursorCliCommand },
      { id: "gemini_cli", command: config.geminiCliCommand },
      { id: "lm_studio", command: config.lmStudioBaseUrl },
    ];
    json(res, {
      connected_client: client
        ? { ...client, runner: connectedRunner(client.name) }
        : {
            selected_provider: config.reportLlmProvider,
            selected_model:
              config.reportLlmProvider === "claude_cli"
                ? config.claudeCliModel
                : config.reportLlmProvider === "copilot_cli"
                  ? config.copilotCliModel
                  : config.reportLlmProvider === "cursor_cli"
                    ? config.cursorCliModel
                    : config.reportLlmProvider === "gemini_cli"
                      ? config.geminiCliModel
                      : config.reportLlmProvider === "lm_studio"
                        ? config.lmStudioModel
                        : config.codexAppServerModel,
          },
      llm_provider: {
        configured_provider: client?.configured_provider ?? config.reportLlmProvider,
        selected_provider: selectedProvider,
        selected_model: client?.selected_model ?? resolveExternalLlmModel(config, selectedProvider),
        selection_reason:
          client?.selection_reason ?? (config.reportLlmProvider === "auto" ? "default" : "environment_override"),
        client_name: client?.name,
        client_version: client?.version,
        providers: providers.map((provider) => ({
          ...provider,
          model: resolveExternalLlmModel(config, provider.id),
          selected: provider.id === selectedProvider,
        })),
      },
      clients: await inspectDailyTaskClients(repo.root),
      model_options: dailyTaskModelOptions(),
    });
    return;
  }
  if (url.pathname === "/api/report") {
    if (req.method !== "GET") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    json(res, await loadWebReportOutputs(repo, resolveDate(date, config)));
    return;
  }
  if (url.pathname === "/api/report/generate") {
    if (req.method !== "POST") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const body = await readJsonBody(req);
    const format = body.format === "text" || body.format === "markdown" ? body.format : undefined;
    if (!format) {
      json(res, { error: "format must be text or markdown." }, 400);
      return;
    }
    const resolved = resolveDate(typeof body.date === "string" ? body.date : undefined, config);
    const provider = webExternalProvider(config);
    const generated = await generateDateReportWithExternalLlm(repo, config, resolved, format, provider, (input) =>
      generateWebLlm(config, input),
    );
    json(res, {
      date: resolved,
      sync: (await loadWebReportOutputs(repo, resolved)).sync,
      output: { text: generated.text, ...(format === "markdown" ? { html: renderMarkdownBody(generated.text) } : {}) },
    });
    return;
  }
  if (url.pathname === "/api/global/resolve-agent-updates") {
    if (req.method !== "POST") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const body = await readJsonBody(req);
    if (body.allow_llm_data_sharing !== true) {
      json(res, { error: "allow_llm_data_sharing=true is required." }, 400);
      return;
    }
    json(res, await resolveWebAgentUpdatesWithAi(repo, config, resolveDate(undefined, config)));
    return;
  }
  if (url.pathname === "/api/summary/generate") {
    if (req.method !== "POST") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const body = await readJsonBody(req);
    if (body.allow_llm_data_sharing !== true) {
      json(res, { error: "allow_llm_data_sharing=true is required." }, 400);
      return;
    }
    const requestedDate =
      typeof body.date === "string" ? resolveDate(body.date, config) : resolveDate(undefined, config);
    const today = resolveDate(undefined, config);
    if (requestedDate !== today) {
      json(res, { error: `Summary generation is available only for today (${today}).` }, 409);
      return;
    }
    json(res, await generateWebMorningSummary(repo, config, requestedDate));
    return;
  }
  if (url.pathname === "/api/summary/progress") {
    if (req.method !== "POST") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const body = await readJsonBody(req);
    if (body.allow_llm_data_sharing !== true) {
      json(res, { error: "allow_llm_data_sharing=true is required." }, 400);
      return;
    }
    const requestedDate =
      typeof body.date === "string" ? resolveDate(body.date, config) : resolveDate(undefined, config);
    const today = resolveDate(undefined, config);
    if (requestedDate !== today) {
      json(res, { error: `Briefing task progress can only be checked for today (${today}).` }, 409);
      return;
    }
    json(res, await checkMorningTaskProgress(repo, config, requestedDate));
    return;
  }
  if (url.pathname === "/api/settings/daily-task") {
    if (req.method === "GET") {
      json(res, await loadDailyTaskSettings(repo.root));
      return;
    }
    if (req.method === "PUT") {
      const body = await readJsonBody(req, 64 * 1024);
      json(res, await updateDailyTaskSettings(repo.root, dailyTaskUpdateFromBody(body)));
      return;
    }
    json(res, { error: "Method not allowed." }, 405);
    return;
  }
  if (url.pathname === "/api/settings/daily-task/prepare") {
    if (req.method !== "POST") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const body = await readJsonBody(req, 64 * 1024);
    json(res, await prepareDailyTaskSettings(repo.root, dailyTaskUpdateFromBody(body)));
    return;
  }
  if (url.pathname === "/api/settings/daily-task/complete") {
    if (req.method !== "POST") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const body = await readJsonBody(req, 64 * 1024);
    const sourceRunner = [
      "codex",
      "cursor",
      "claude_code_loop",
      "claude_desktop",
      "copilot_cli",
      "gemini_cli",
    ].includes(String(body.source_runner))
      ? (body.source_runner as DailyTaskRunner)
      : undefined;
    json(res, await completeDailyTaskSettings(repo.root, dailyTaskUpdateFromBody(body), sourceRunner));
    return;
  }
  if (url.pathname === "/api/settings/profile") {
    if (req.method === "GET") {
      json(res, profileSettingsView(config));
      return;
    }
    if (req.method === "PUT") {
      const body = await readJsonBody(req);
      let activityRolloverHour: number;
      try {
        activityRolloverHour = parseActivityRolloverHour(body.activity_rollover_hour);
      } catch (error) {
        json(res, { error: (error as Error).message }, 400);
        return;
      }
      json(
        res,
        await updateProfileSettings(repo, config, {
          timezone: typeof body.timezone === "string" ? body.timezone : "",
          activity_rollover_hour: activityRolloverHour,
        }),
      );
      return;
    }
    json(res, { error: "Method not allowed." }, 405);
    return;
  }
  if (url.pathname === "/api/settings/maintenance") {
    if (req.method === "GET") {
      json(res, await maintenanceSettingsView(repo, config));
      return;
    }
    if (req.method === "PUT") {
      const body = await readJsonBody(req);
      const update: StoredMaintenanceSettings = {
        enabled: body.enabled === true,
        run_at: typeof body.run_at === "string" ? body.run_at : "",
        keep_all_days: Number(body.keep_all_days),
        keep_daily_days: Number(body.keep_daily_days),
        keep_weekly_days: Number(body.keep_weekly_days),
        keep_monthly_days: Number(body.keep_monthly_days),
        archive_grace_days: Number(body.archive_grace_days),
        max_versions_per_file_per_day: Number(body.max_versions_per_file_per_day),
      };
      try {
        json(res, await updateMaintenanceSettings(repo, config, update));
      } catch (error) {
        json(res, { error: (error as Error).message }, 400);
      }
      return;
    }
    json(res, { error: "Method not allowed." }, 405);
    return;
  }
  if (url.pathname === "/api/settings/maintenance/run") {
    if (req.method !== "POST") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const body = await readJsonBody(req);
    json(res, await runBackupRetention(repo, config, { dry_run: body.dry_run !== false, force: true }));
    return;
  }
  const taskReportVisibilityMatch = url.pathname.match(/^\/api\/task\/([^/]+)\/report-visibility$/);
  if (taskReportVisibilityMatch) {
    if (req.method !== "PUT") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const body = await readJsonBody(req);
    if (typeof body.visible !== "boolean") {
      json(res, { error: "visible must be a boolean." }, 400);
      return;
    }
    const taskId = decodeURIComponent(taskReportVisibilityMatch[1] ?? "");
    const resolved = resolveDate(typeof body.date === "string" ? body.date : undefined, config);
    json(
      res,
      await repo.withTransaction(async () => {
        const updated = await setTaskReportVisibility(repo, taskId, body.visible as boolean);
        await Promise.all([
          generateReport(repo, resolved, true, "text"),
          generateReport(repo, resolved, true, "markdown"),
        ]);
        return { task: updated.task, visible: updated.visible, date: resolved };
      }),
    );
    return;
  }
  const taskOrganizationMatch = url.pathname.match(/^\/api\/task\/([^/]+)\/organize$/);
  if (taskOrganizationMatch) {
    if (req.method !== "POST") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const body = await readJsonBody(req);
    if (body.allow_llm_data_sharing !== true) {
      json(res, { error: "allow_llm_data_sharing=true is required." }, 400);
      return;
    }
    const lookbackDays =
      typeof body.lookback_days === "number" &&
      Number.isInteger(body.lookback_days) &&
      body.lookback_days >= 1 &&
      body.lookback_days <= 90
        ? body.lookback_days
        : config.defaultLookbackDays;
    const requestedDate =
      typeof body.date === "string" ? resolveDate(body.date, config) : resolveDate(undefined, config);
    json(
      res,
      await organizeWebTaskInformation(
        repo,
        config,
        decodeURIComponent(taskOrganizationMatch[1] ?? ""),
        requestedDate,
        lookbackDays,
      ),
    );
    return;
  }
  const mindMapMatch = url.pathname.match(/^\/api\/task\/([^/]+)\/mindmap$/);
  if (mindMapMatch) {
    if (req.method !== "POST") {
      json(res, { error: "Method not allowed." }, 405);
      return;
    }
    const body = await readJsonBody(req);
    if (body.allow_llm_data_sharing !== true) {
      json(res, { error: "allow_llm_data_sharing=true is required." }, 400);
      return;
    }
    json(res, await generateWebTaskMindMap(repo, config, decodeURIComponent(mindMapMatch[1] ?? "")));
    return;
  }
  if (url.pathname === "/api/overview") {
    json(res, await buildOverview(repo, config, date));
    return;
  }
  if (url.pathname.startsWith("/api/task/")) {
    const taskId = decodeURIComponent(url.pathname.slice("/api/task/".length));
    const tasks = await repo.loadTasks();
    const task = tasks.tasks.find((item) => item.id === taskId);
    if (!task || isTaskDeleted(task)) {
      json(res, { error: `Task not found: ${taskId}` }, 404);
      return;
    }
    const resolved = resolveDate(date, config);
    const [context, memory, activity, report, inputs, latestEntries] = await Promise.all([
      repo.loadTaskContext(task),
      repo.loadTaskMemory(taskId),
      repo.loadActivity(resolved),
      repo.loadReport(resolved),
      repo.loadInputs(resolved),
      loadLatestTaskActivitiesThrough(repo, taskId, resolved),
    ]);
    const latestActivity = latestDatedActivity(latestEntries);
    const latestNextActivity = latestDatedNextActivity(latestEntries);
    const latest_activity = latestActivity?.entry;
    const latest_next_activity = latestNextActivity?.entry;
    json(res, {
      task,
      context,
      context_body_html: renderMarkdownBody(context.body),
      memory,
      ...(latest_activity ? { latest_activity } : {}),
      ...(latestActivity ? { latest_activity_date: latestActivity.operational_date } : {}),
      ...(latest_next_activity ? { latest_next_activity } : {}),
      ...(latestNextActivity ? { latest_next_activity_date: latestNextActivity.operational_date } : {}),
      current_status: deriveCurrentStatus({
        task_compact_summary: task.compact_summary,
        context_compact_summary: context.data?.compact_summary,
        memory,
        latest_activity,
        latest_activity_date: latestActivity?.operational_date,
        latest_next_activity,
        latest_next_activity_date: latestNextActivity?.operational_date,
      }),
      activity: { ...activity, entries: activity.entries.filter((entry) => entry.task_id === taskId) },
      operational_range: operationalDateRange(resolved, config),
      report_entry: report.entries.find((entry) => entry.task_id === taskId) ?? null,
      inputs: { ...inputs, items: inputs.items.filter((item) => item.related_task_id === taskId) },
    });
    return;
  }
  if (url.pathname === "/api/search") {
    const query = url.searchParams.get("q") ?? "";
    json(res, { query, matches: query ? await searchTaskContext(repo, query, 50) : [] });
    return;
  }
  if (url.pathname === "/api/document") {
    const kind = url.searchParams.get("kind");
    const resolved = resolveDate(date, config);
    if (kind === "inputs") json(res, await repo.loadInputs(resolved));
    else if (kind === "activity") json(res, await repo.loadActivity(resolved));
    else if (kind === "report") json(res, await repo.loadReport(resolved));
    else if (kind === "report_summary") json(res, await repo.loadReportSummary(resolved));
    else if (kind === "memory_summaries") json(res, await repo.loadMemorySummaries(resolved));
    else if (kind === "agent_updates") json(res, await repo.loadAgentUpdates(resolved));
    else json(res, { error: "Unknown document kind." }, 400);
    return;
  }
  if (url.pathname === "/api/output") {
    const renderer = url.searchParams.get("renderer") ?? config.defaultRenderer;
    const extension =
      url.searchParams.get("extension") ?? (renderer === "markdown" ? "md" : renderer === "html" ? "html" : "txt");
    const resolved = resolveDate(date, config);
    json(res, { date: resolved, renderer, extension, text: await repo.loadOutput(renderer, resolved, extension) });
    return;
  }
  json(res, { error: "Not found" }, 404);
}

async function loadLatestTaskActivitiesThrough(
  repo: Repository,
  taskId: string,
  date: string,
): Promise<DatedActivityEntry[]> {
  const dates = (await repo.listYamlDates(repo.layoutName("activities"))).filter((candidate) => candidate <= date);
  let candidates: DatedActivityEntry[] = [];
  // Scan complete coverage, but retain only the two records needed by the projection.
  for (const activityDate of dates) {
    const document = await repo.loadActivity(activityDate);
    for (const [order, entry] of document.entries.entries()) {
      if (entry.task_id === taskId) candidates.push({ entry, operational_date: activityDate, order });
    }
    const latest = latestDatedActivity(candidates);
    const latestNext = latestDatedNextActivity(candidates);
    candidates = [latest, latestNext].filter((entry): entry is DatedActivityEntry => entry !== undefined);
  }
  return candidates;
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  const parsed = value === null ? fallback : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}
