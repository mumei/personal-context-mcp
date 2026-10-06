/**
 * Parses, merges, and prepares source-grounded generation prompts for daily report entries.
 * 日次レポート項目の解析・統合と、根拠付き生成プロンプトの構築を担当します。
 *
 * @remarks
 * This module does not call an LLM or persist generated reports.
 * このモジュールはLLM呼び出しや生成レポートの永続化を担当しません。
 *
 * @packageDocumentation
 */
import type { Repository } from "#infra/repository/repository";
import type { ReportEntry } from "#shared/types";
import { isTaskDeleted } from "#domain/tasks/state";
import { stripJsonFences } from "#mcp/llm/content";

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

/** Parses and validates LLM-generated daily report entries. LLMが生成した日次レポート項目を解析・検証します。 */
export function parseGeneratedReportEntries(text: string): ReportEntry[] {
  const parsed = JSON.parse(stripJsonFences(text)) as unknown;
  if (!parsed || typeof parsed !== "object" || !("entries" in parsed)) {
    throw new Error("Generated response did not contain an entries array.");
  }
  const entries = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    throw new Error("Generated response entries must be an array.");
  }
  const parsedEntries = entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Generated response entry ${index} must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.task_id !== "string" || record.task_id.trim().length === 0) {
      throw new Error(`Generated response entry ${index} is missing task_id.`);
    }
    return {
      task_id: record.task_id.trim(),
      ...(stringArray(record.done) ? { done: stringArray(record.done) } : {}),
      ...(stringArray(record.next) ? { next: stringArray(record.next) } : {}),
    };
  });
  return mergeDuplicateReportEntries(parsedEntries);
}

/** Merges duplicate task entries while enforcing report bullet limits. 同一タスクの重複項目を箇条書き上限に従って統合します。 */
export function mergeDuplicateReportEntries(entries: ReportEntry[]): ReportEntry[] {
  const limits = {
    done: 4,
    next: 3,
  } as const;
  const entriesByTaskId = new Map<string, ReportEntry>();
  for (const entry of entries) {
    const existing = entriesByTaskId.get(entry.task_id);
    if (!existing) {
      const normalized: ReportEntry = { ...entry };
      for (const field of ["done", "next"] as const) {
        const values = [...new Set(entry[field] ?? [])].slice(0, limits[field]);
        if (values.length > 0) normalized[field] = values;
      }
      entriesByTaskId.set(entry.task_id, normalized);
      continue;
    }
    for (const field of ["done", "next"] as const) {
      const values = [...(entry[field] ?? [])];
      for (const value of existing[field] ?? []) {
        if (!values.includes(value)) values.push(value);
      }
      if (values.length > 0) existing[field] = values.slice(0, limits[field]);
    }
  }
  return [...entriesByTaskId.values()];
}

/** Builds the source-grounded prompt used to generate report entries. レポート項目生成に使用する根拠付きプロンプトを構築します。 */
export async function buildReportEntriesPrompt(
  targetRepo: Repository,
  date: string,
): Promise<{ prompt: string; source_activity_count: number }> {
  const [tasksDoc, activity, existingReport, globalMemory, reportSummary] = await Promise.all([
    targetRepo.loadTasks(),
    targetRepo.loadActivity(date),
    targetRepo.loadReport(date),
    targetRepo.loadGlobalMemory(),
    targetRepo.loadReportSummary(date),
  ]);
  const tasksById = new Map(tasksDoc.tasks.map((task) => [task.id, task]));
  const taskIds = [...new Set(activity.entries.map((entry) => entry.task_id))].filter(
    (taskId) => !isTaskDeleted(tasksById.get(taskId)),
  );
  const taskContexts = await Promise.all(
    taskIds.map(async (taskId) => {
      const task = tasksById.get(taskId);
      const memory = await targetRepo.loadTaskMemory(taskId);
      const context = task ? await targetRepo.loadTaskContext(task) : { data: {}, body: "" };
      return {
        task_id: taskId,
        task,
        task_memory: memory,
        context_frontmatter: context.data,
      };
    }),
  );
  const payload = {
    date,
    activities: activity.entries.filter((entry) => !isTaskDeleted(tasksById.get(entry.task_id))),
    tasks: taskContexts,
    global_memory: globalMemory,
    report_summary: reportSummary,
    existing_report_display_overrides: existingReport.entries
      .filter((entry) => !isTaskDeleted(tasksById.get(entry.task_id)))
      .map((entry) => ({
        task_id: entry.task_id,
        today_diff_heading_only: entry.today_diff_heading_only,
        today_diff_order: entry.today_diff_order,
      })),
  };
  const visibleActivityCount = payload.activities.length;
  return {
    source_activity_count: visibleActivityCount,
    prompt: [
      "Personal Context MCP daily report entry generation.",
      "",
      "Create a human-facing daily report from the short-term work log and durable memory.",
      "This is not an audit log, command log, or monitoring dump.",
      "Return only valid JSON. Do not include Markdown fences or commentary.",
      "",
      "Schema:",
      '{"entries":[{"task_id":"...","done":["..."],"next":["..."]}]}',
      "Use empty arrays for sections that have no content.",
      "",
      "Rules:",
      "- `activities` is the authoritative short-term work log for the target date.",
      "- `task_memory`, `global_memory`, contexts, and `report_summary` are context for wording and prioritization; do not invent dated work from memory alone.",
      "- Apply `global_memory.rules` as mandatory user-wide output constraints when relevant and compatible with the schema and source evidence.",
      "- Apply `global_memory.preferences` to wording and presentation. Treat `global_memory.summary` only as cross-task context.",
      "- If several activity entries for the same task supersede each other, keep only the latest meaningful state and drop older numeric values.",
      "- Output exactly one report entry for each `task_id`; merge all meaningful content for that task into that one entry.",
      "- Prefer business/status summary over command execution details.",
      "- Do not include PID, script names, raw status fields, grep results, file paths, stack traces, or database internals unless they are the user-facing outcome.",
      "- Convert monitoring details into status sentences: current progress, health/blocker, and next check.",
      "- For crawler/monitor tasks, summarize as progress, health, risk, and next action.",
      "- Each task should normally have done 2-4 bullets and next 1-3 bullets.",
      "- Keep each Japanese bullet short enough for a LINE-style daily report. Target under 70 Japanese characters when possible.",
      "- Avoid duplicate or near-duplicate bullets across done and next.",
      "- Output only `done` and `next`. Do not output confirmation sections or external summaries.",
      "- Keep bullets concrete, but do not expose internal implementation details when a higher-level status is enough.",
      "- Rewrite internal English keys and system labels into natural Japanese. Do not output words like fetched, pending, industry_, query_summary, process_health, or current_active_log_age_seconds.",
      "- Use Japanese business wording for operational terms: fetched/pending -> 取得済み/残件, industry_系 -> 業種別ソース, query_summary -> 検索条件, process_health -> 稼働状態.",
      "- Do not use slash-separated internal pair notation like 取得済み/残件. Write natural Japanese such as 取得済み件数と残件.",
      "- Include only tasks that have meaningful report content for the date.",
      "",
      "Bad report bullet examples:",
      "- status_integrated_mobility_source_collection.sh を実行した",
      "- monitor PID 41569、runner PID 42767 を確認した",
      "- current_active_log_age_seconds=1219、current_progress_delta_total=0",
      "- 次回はfetched/pending差分とprocess_healthを確認する",
      "- 次回は取得済み/残件の差分を確認する",
      "- 媒体別内訳ではindustry_系の業種行を省略しない",
      "- external_summary に done と同じ要約を入れる",
      "- confirm に通常の確認事項や運用ルールを入れる",
      "",
      "Good report bullet examples:",
      "- 世田谷区の詳細取得は1,300/5,165件まで進み、進捗率は25.17%。",
      "- 収集プロセスは稼働中で、アクセス制限後も自動復旧して保存を再開済み。",
      "- 次回は詳細取得の進捗差分とプロセス健全性を確認する。",
      "- 次回は取得済み件数と残件の差分を確認する。",
      "- 媒体別内訳では業種別ソースも含めて確認する。",
      "",
      "Source JSON:",
      JSON.stringify(payload),
    ].join("\n"),
  };
}
