/**
 * Provides generation capabilities for the domain layer.
 * Responsibility: This module owns the generation behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * domain層のgeneration機能を提供します。
 * 責務: このモジュールは、ここで宣言するgenerationの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import { loadRelevantKnowledge } from "#app/knowledgeContext";
import { createExternalLlmGenerator } from "#llm/providerRuntime";
import { recordKnowledgeUsage } from "#infra/audit/knowledgeUsage";
import type { ExternalLlmProvider, LlmGenerator } from "#llm/types";
import type { Repository } from "#infra/repository/repository";
import { generateReport, type ReportFormat } from "#domain/reports/render";
import { replaceTaskCompactSummaries } from "#domain/tasks/actions";
import { isTaskDeleted } from "#domain/tasks/state";
import { buildTaskActivityIdentityMap } from "#domain/tasks/identity";
import type { ReportEntry, TaskMcpConfig } from "#shared/types";
import {
  buildReportActivityCheckpoint,
  loadReportActivitySyncState,
  unreflectedActivities,
  type ReportActivityCheckpoint,
} from "#domain/reports/activitySync";
import { preserveReportEntryUrls } from "#domain/reports/urlPreservation";

interface GeneratedTaskReport {
  task_id: string;
  report_entry: { done: string[]; next: string[] };
  task_summary: string[];
  activity_checkpoint?: ReportActivityCheckpoint;
}

interface GeneratedDateReport {
  date: string;
  source_revision: string;
  llm_provider: ExternalLlmProvider;
  model?: string;
  codex_thread_id?: string;
  codex_turn_id?: string;
  claude_session_id?: string;
  tasks: GeneratedTaskReport[];
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1]?.trim() ?? "";
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function compactSummaryLines(value: unknown, taskId: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Scoped generation task_summary must be an array: ${taskId}`);
  const lines = value.map((line) => {
    if (typeof line !== "string" || line.trim().length === 0) {
      throw new Error(`Scoped generation task_summary must contain non-empty strings: ${taskId}`);
    }
    return line.trim();
  });
  if (lines.length < 1 || lines.length > 2) {
    throw new Error(`Scoped generation task_summary must contain 1-2 lines: ${taskId}`);
  }
  return lines;
}

function outputSchema(): Record<string, unknown> {
  const stringArray = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            task_id: { type: "string" },
            report_entry: {
              type: "object",
              properties: { done: stringArray, next: stringArray },
              required: ["done", "next"],
              additionalProperties: false,
            },
            task_summary: stringArray,
          },
          required: ["task_id", "report_entry", "task_summary"],
          additionalProperties: false,
        },
      },
    },
    required: ["tasks"],
    additionalProperties: false,
  };
}

async function loadSource(repo: Repository, date: string, taskIds: string[]) {
  const [tasksDoc, activity, inputs, globalMemory, reportSummary, report] = await Promise.all([
    repo.loadTasks(),
    repo.loadActivity(date),
    repo.loadInputs(date),
    repo.loadGlobalMemory(),
    repo.loadReportSummary(date),
    repo.loadReport(date),
  ]);
  const tasksById = new Map(tasksDoc.tasks.map((task) => [task.id, task]));
  const tasksByActivityId = buildTaskActivityIdentityMap(tasksDoc.tasks);
  const checkpoints = new Map<string, ReportActivityCheckpoint>();
  const tasks = await Promise.all(
    taskIds.map(async (taskId) => {
      const task = tasksById.get(taskId);
      if (!task || isTaskDeleted(task)) throw new Error(`Unknown task_id: ${taskId}`);
      const [context, memory] = await Promise.all([repo.loadTaskContext(task), repo.loadTaskMemory(taskId)]);
      const knowledge = await loadRelevantKnowledge(
        repo,
        [task.id, task.title, task.project, task.compact_summary, context.body, memory.summary, memory.facts],
        { limit: 10 },
      );
      const taskActivities = activity.entries.filter((entry) => tasksByActivityId.get(entry.task_id)?.id === taskId);
      const existingReportEntry = report.entries.find((entry) => entry.task_id === taskId);
      checkpoints.set(taskId, buildReportActivityCheckpoint(taskActivities));
      return {
        task,
        context_frontmatter: context.data,
        context_body: context.body,
        existing_memory: memory,
        relevant_knowledge: knowledge,
        unreflected_activities: unreflectedActivities(taskActivities, existingReportEntry),
        existing_report_entry: existingReportEntry,
      };
    }),
  );
  const source = { date, tasks, inputs, global_memory: globalMemory, report_summary: reportSummary };
  return { source, checkpoints, revision: createHash("sha256").update(JSON.stringify(source)).digest("hex") };
}

function generationPrompt(source: Awaited<ReturnType<typeof loadSource>>["source"]): string {
  return [
    "Personal Context MCP daily report generation.",
    "Return only valid JSON matching the supplied schema.",
    "For every input task, produce one daily report entry and one Tier task-list summary.",
    "Keep activities as an append-only journal. Do not rewrite or compact source activities.",
    "Do not produce or modify task memory. Existing memory is read-only context for this report generation.",
    "Apply global_memory.rules as mandatory user-wide output constraints when relevant and compatible with the schema and source evidence.",
    "Apply global_memory.preferences to wording and presentation. Treat global_memory.summary as cross-task context, not dated work evidence.",
    "Report entries contain concise Japanese Done/Next only. Merge repeated monitoring snapshots into the latest meaningful state.",
    "Only unreflected_activities are new. Reorganize them with existing_report_entry into the complete current report text.",
    "Preserve every user-facing HTTP/HTTPS URL from existing_report_entry and unreflected_activities verbatim in the corresponding Done/Next report field.",
    "If existing_report_entry is manually overridden, preserve its useful facts while incorporating the new activity; do not merely append raw logs.",
    "Task summary contains 1-2 concise bullets describing current stable state, blocker, deadline, or next direction.",
    "Do not expose commands, PID, raw internal keys, file paths, or implementation logs in report_entry or task_summary.",
    "Use short arrays and return every requested task_id exactly once.",
    "Source JSON:",
    JSON.stringify(source),
  ].join("\n");
}

async function generateEntries(
  repo: Repository,
  config: TaskMcpConfig,
  date: string,
  taskIds: string[],
  generate: LlmGenerator,
  provider: GeneratedDateReport["llm_provider"],
): Promise<GeneratedDateReport> {
  const loaded = await loadSource(repo, date, taskIds);
  const response = await generate({
    prompt: generationPrompt(loaded.source),
    cwd: process.cwd(),
    outputSchema: outputSchema(),
  });
  const parsed = JSON.parse(stripJsonFences(response.text)) as { tasks?: GeneratedTaskReport[] };
  if (!Array.isArray(parsed.tasks)) throw new Error("Daily report generation response is missing tasks.");
  const tasks = parsed.tasks.map((task) => ({
    ...task,
    task_summary: compactSummaryLines(task.task_summary, task.task_id),
    activity_checkpoint: loaded.checkpoints.get(task.task_id),
  }));
  for (const task of tasks) {
    const source = loaded.source.tasks.find((item) => item.task.id === task.task_id);
    if (!source) continue;
    preserveReportEntryUrls(task.report_entry, [
      ...(source.existing_report_entry ? [source.existing_report_entry] : []),
      ...source.unreflected_activities,
    ]);
  }
  if (
    tasks.length !== taskIds.length ||
    taskIds.some((taskId) => tasks.filter((task) => task.task_id === taskId).length !== 1)
  ) {
    throw new Error("Daily report generation must return every requested task_id exactly once.");
  }
  await recordKnowledgeUsage(repo, config, {
    workflow: "report_generate_output",
    stage: "injected_to_llm",
    date,
    provider,
    model: response.model,
    contexts: loaded.source.tasks.map((source) => ({
      task_id: source.task.id,
      knowledge: source.relevant_knowledge,
    })),
  }).catch((error: unknown) => console.error("Failed to write Knowledge usage log:", error));
  return {
    date,
    source_revision: loaded.revision,
    llm_provider: provider,
    model: response.model,
    ...(provider === "codex_app_server"
      ? {
          codex_thread_id: response.threadId,
          codex_turn_id: response.turnId,
        }
      : provider === "claude_cli"
        ? { claude_session_id: response.sessionId }
        : {}),
    tasks,
  };
}

async function applyGeneratedEntries(repo: Repository, generated: GeneratedDateReport) {
  const compactSummaries = await replaceTaskCompactSummaries(
    repo,
    generated.tasks.map((item) => ({
      task_id: item.task_id,
      compact_summary: item.task_summary,
    })),
  );
  const tasksById = new Map(compactSummaries.tasks.map((task) => [task.id, task]));
  const report = await repo.loadReport(generated.date);
  const entries = [...report.entries];
  for (const item of generated.tasks) {
    const task = tasksById.get(item.task_id);
    if (!task) throw new Error(`Missing saved task for task_id: ${item.task_id}`);
    const index = entries.findIndex((entry) => entry.task_id === item.task_id);
    const existing = index >= 0 ? entries[index] : undefined;
    const existingMetadata = { ...(existing ?? { task_id: item.task_id }) };
    delete existingMetadata.task_summary;
    delete existingMetadata.done;
    delete existingMetadata.next;
    delete existingMetadata.source_activity_revision;
    delete existingMetadata.source_activity_ids;
    delete existingMetadata.activity_generated_at;
    const taskSnapshot = {
      title: task.title,
      ...(task.project !== undefined ? { project: task.project } : {}),
      ...(task.tier !== undefined ? { tier: task.tier } : {}),
      ...(task.status !== undefined ? { status: task.status } : {}),
      summary: compactSummaryLines(task.compact_summary, item.task_id),
    };
    const entry: ReportEntry = {
      ...existingMetadata,
      task_id: item.task_id,
      ...(item.report_entry.done.length ? { done: item.report_entry.done } : {}),
      ...(item.report_entry.next.length ? { next: item.report_entry.next } : {}),
      ...item.activity_checkpoint,
      task_snapshot: taskSnapshot,
    };
    if (index >= 0) entries[index] = entry;
    else entries.push(entry);
  }
  const reportSave = await repo.saveReport(
    generated.date,
    { date: generated.date, entries },
    "apply-date-report-generation",
  );
  return { tasks_save: compactSummaries.save, report_save: reportSave };
}

/**
 * Performs the public `generateDateReportWithCodex` operation provided by this module.
 *
 * このモジュールが提供する公開操作`generateDateReportWithCodex`を実行します。
 */
export async function generateDateReportWithCodex(
  repo: Repository,
  config: TaskMcpConfig,
  date: string,
  format: ReportFormat,
  generate: LlmGenerator = createExternalLlmGenerator(config, "codex_app_server"),
) {
  const taskIds = (await loadReportActivitySyncState(repo, date)).tasks.map((task) => task.task_id);
  if (taskIds.length === 0) {
    const report = await generateReport(repo, date, true, format);
    return { ...report, task_ids: [], scoped_generation: undefined, scoped_apply: undefined };
  }
  const generated = await generateEntries(repo, config, date, taskIds, generate, "codex_app_server");
  return repo.withTransaction(async () => {
    const current = await loadSource(repo, date, taskIds);
    if (current.revision !== generated.source_revision) {
      throw new Error("Daily report source changed while the LLM was running; retry to include the latest activity.");
    }
    const applied = await applyGeneratedEntries(repo, generated);
    const report = await generateReport(repo, date, true, format);
    return { ...report, task_ids: taskIds, scoped_generation: generated, scoped_apply: applied };
  });
}

/**
 * Performs the public `generateDateReportWithExternalLlm` operation provided by this module.
 *
 * このモジュールが提供する公開操作`generateDateReportWithExternalLlm`を実行します。
 */
export async function generateDateReportWithExternalLlm(
  repo: Repository,
  config: TaskMcpConfig,
  date: string,
  format: ReportFormat,
  provider: ExternalLlmProvider,
  generate: LlmGenerator = createExternalLlmGenerator(config, provider),
) {
  const taskIds = (await loadReportActivitySyncState(repo, date)).tasks.map((task) => task.task_id);
  if (taskIds.length === 0) {
    const report = await generateReport(repo, date, true, format);
    return { ...report, task_ids: [], scoped_generation: undefined, scoped_apply: undefined };
  }
  const generated = await generateEntries(repo, config, date, taskIds, generate, provider);
  return repo.withTransaction(async () => {
    const current = await loadSource(repo, date, taskIds);
    if (current.revision !== generated.source_revision) {
      throw new Error("Daily report source changed while the LLM was running; retry to include the latest activity.");
    }
    const applied = await applyGeneratedEntries(repo, generated);
    const report = await generateReport(repo, date, true, format);
    return { ...report, task_ids: taskIds, scoped_generation: generated, scoped_apply: applied };
  });
}
