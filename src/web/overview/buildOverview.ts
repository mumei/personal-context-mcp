/**
 * @packageDocumentation
 * Builds the web dashboard overview model and saved report output views.
 * It does not route individual APIs, invoke LLM generation, or update data.
 * Web ダッシュボードの概要モデルと保存済みレポートの表示データを構築する。
 * 個別 API のルーティング、LLM 生成の実行、データ更新は担当しない。
 */
import { getUserSituation } from "#app/situation";
import { activeTasks } from "#domain/tasks/state";
import { Repository } from "#infra/repository/repository";
import { operationalDateRange, resolveDate } from "#shared/date";
import type { Task, TaskMcpConfig, TaskStatus } from "#shared/types";
import { listUnresolvedAgentUpdates } from "#web/agentUpdates/resolution";
import { loadMorningProgress } from "#web/briefing/progress";
import { parseMorningBrief } from "#web/briefing/parser";
import { renderMarkdownBody } from "#web/markdown";
import type { MorningTaskProgress, OverviewModel } from "#web/types";
import { loadReportActivitySyncState } from "#domain/reports/activitySync";

const statusOrder: TaskStatus[] = ["todo", "inProgress", "waiting", "blocked", "done"];

function taskCounts(tasks: Task[]): Record<TaskStatus, number> {
  return statusOrder.reduce<Record<TaskStatus, number>>(
    (acc, status) => {
      acc[status] = tasks.filter((task) => task.status === status).length;
      return acc;
    },
    { todo: 0, inProgress: 0, waiting: 0, blocked: 0, done: 0 },
  );
}

async function listDates(repo: Repository): Promise<OverviewModel["dates"]> {
  const [inputs, activities, reports, reportSummaries, memorySummaries, agentUpdates] = await Promise.all([
    repo.listYamlDates(repo.layoutName("inputs")),
    repo.listYamlDates(repo.layoutName("activities")),
    repo.listYamlDates(repo.layoutName("reports")),
    repo.listYamlDates(repo.layoutName("reportSummaries")),
    repo.listYamlDates(repo.layoutName("memorySummaries")),
    repo.listYamlDates(repo.layoutName("agentUpdates")),
  ]);
  return {
    inputs,
    activities,
    reports,
    report_summaries: reportSummaries,
    memory_summaries: memorySummaries,
    agent_updates: agentUpdates,
  };
}

async function latestTaskActivityDates(repo: Repository, taskIds: Set<string>): Promise<Record<string, string>> {
  const latest: Record<string, string> = {};
  if (taskIds.size === 0) return latest;
  const dates = (await repo.listYamlDates(repo.layoutName("activities"))).sort().reverse();
  for (const date of dates) {
    const activity = await repo.loadActivity(date);
    for (const entry of activity.entries)
      if (taskIds.has(entry.task_id) && !latest[entry.task_id]) latest[entry.task_id] = date;
    if (Object.keys(latest).length === taskIds.size) break;
  }
  return latest;
}

/**
 * Loads saved text and Markdown reports for the specified date in display-ready form.
 * 指定日の保存済み text/Markdown レポートを表示可能な形式で読み込む。
 */
export async function loadWebReportOutputs(repo: Repository, date: string) {
  const [textReport, markdownReport, sync] = await Promise.all([
    repo.loadOutput("text", date, "txt"),
    repo.loadOutput("markdown", date, "md"),
    loadReportActivitySyncState(repo, date),
  ]);
  const text = textReport ?? "";
  const markdown = markdownReport ?? "";
  return { date, sync, text: { text }, markdown: { text: markdown, html: renderMarkdownBody(markdown) } };
}

/**
 * Builds the overview model required to display the web dashboard for a specified date.
 * 指定日の Web ダッシュボード表示に必要な概要モデルを構築する。
 */
export async function buildOverview(
  repo: Repository,
  config: TaskMcpConfig,
  dateInput?: string,
): Promise<OverviewModel> {
  const today = resolveDate(undefined, config);
  const date = resolveDate(dateInput, config);
  const tasks = activeTasks((await repo.loadTasks()).tasks);
  const [
    dates,
    globalMemory,
    reportSummary,
    memorySummaries,
    agentUpdates,
    userSituation,
    unresolvedAgentUpdates,
    morningBriefText,
    activity,
    report,
    taskLastUpdated,
    savedMorningProgress,
    reportSync,
  ] = await Promise.all([
    listDates(repo),
    repo.loadGlobalMemory(),
    repo.loadReportSummary(date),
    repo.loadMemorySummaries(date),
    repo.loadAgentUpdates(date),
    getUserSituation(repo, date, config.defaultLookbackDays),
    listUnresolvedAgentUpdates(repo, date),
    repo.loadOutput("morning", date, "md"),
    repo.loadActivity(date),
    repo.loadReport(date),
    latestTaskActivityDates(repo, new Set(tasks.map((task) => task.id))),
    loadMorningProgress(repo, date),
    loadReportActivitySyncState(repo, date),
  ]);
  const activityTaskIds = new Set(activity.entries.map((entry) => entry.task_id));
  const snapshots = new Map(report.entries.map((entry) => [entry.task_id, entry.task_snapshot]));
  const isToday = date === resolveDate(undefined, config);
  const savedProgressByTask = new Map(savedMorningProgress?.items.map((item) => [item.task_id, item]) ?? []);
  const morningTaskProgress = Object.fromEntries(
    tasks.map((task) => {
      const snapshotStatus = snapshots.get(task.id)?.status;
      const historicalStatus = statusOrder.includes(snapshotStatus as TaskStatus)
        ? (snapshotStatus as TaskStatus)
        : (task.status ?? "todo");
      const status = isToday ? (task.status ?? "todo") : historicalStatus;
      const assessment = savedProgressByTask.get(task.id);
      return [
        task.id,
        {
          status,
          updated_on_date: activityTaskIds.has(task.id),
          completed: status === "done",
          ...(assessment
            ? {
                alignment_state: assessment.state,
                assessment: assessment.assessment,
                evidence: assessment.evidence,
                checked_at: savedMorningProgress?.checked_at,
              }
            : {}),
        } satisfies MorningTaskProgress,
      ];
    }),
  );
  return {
    root: repo.root,
    date,
    today,
    operational_range: operationalDateRange(date, config),
    counts: taskCounts(tasks),
    tasks,
    dates,
    global_memory: globalMemory,
    report_summary: reportSummary,
    memory_summaries: memorySummaries,
    agent_updates: agentUpdates,
    user_situation: userSituation,
    unresolved_agent_updates: unresolvedAgentUpdates,
    morning_brief: parseMorningBrief(date, morningBriefText),
    morning_task_progress: morningTaskProgress,
    task_last_updated: taskLastUpdated,
    report_sync: reportSync,
  };
}
