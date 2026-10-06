/**
 * @packageDocumentation
 * Generates and merges morning briefing task sections and coordinates external input collection.
 * It does not perform general parsing of saved documents, assess progress, or handle HTTP requests.
 * モーニングブリーフのタスクセクションを生成・統合し、外部入力収集と連携する。
 * 保存済み文書の汎用解析、進捗の判定、HTTP リクエスト処理は担当しない。
 */
import { createHash, randomUUID } from "node:crypto";
import { loadRelevantKnowledge } from "#app/knowledgeContext";
import { recordKnowledgeUsage } from "#infra/audit/knowledgeUsage";
import type { LlmGenerator } from "#llm/types";
import { runExternalInputCollector, type ExternalInputCollectorResult } from "#domain/inputs/externalCollector";
import { resolveDate } from "#shared/date";
import { activeTasks } from "#domain/tasks/state";
import { Repository } from "#infra/repository/repository";
import type { TaskMcpConfig } from "#shared/types";
import type { GeneratedMorningTaskSections, MorningBriefDocument } from "#web/types";
import { generateWebLlm, webLlmMetadata } from "#web/llm";
import { parseMorningBrief } from "#web/briefing/parser";

interface MorningGenerationSnapshot {
  brief: string;
  source: Record<string, unknown>;
  taskIds: Set<string>;
  relevantKnowledge: Awaited<ReturnType<typeof loadRelevantKnowledge>>;
  hash: string;
}

interface MorningGenerationMarker {
  generation_id: string;
  input_hash: string;
  status: "running" | "committed";
  started_at: string;
  committed_at?: string;
}

/**
 * Signals that a briefing result is valid in shape but stale relative to the
 * latest generation request or source data.
 *
 * ブリーフィング結果の形式は正しいものの、最新の生成要求または入力データに対して
 * 古くなっていることを通知します。
 */
export class BriefingGenerationConflictError extends Error {
  override readonly name = "BriefingGenerationConflictError";
}

function externalBriefingSections(text: string): string {
  const marker = text.match(/^4\.\s+/m);
  return (marker?.index === undefined ? text : text.slice(0, marker.index)).trimEnd();
}

async function loadMorningGenerationSnapshot(repo: Repository, date: string): Promise<MorningGenerationSnapshot> {
  const [brief, tasksDocument, activity, report, globalMemory] = await Promise.all([
    repo.loadOutput("morning", date, "md"),
    repo.loadTasks(),
    repo.loadActivity(date),
    repo.loadReport(date),
    repo.loadGlobalMemory(),
  ]);
  if (!brief) throw new Error("Generate or import briefing sections 1-3 before generating task sections.");
  const tasks = activeTasks(tasksDocument.tasks).filter((task) => task.status !== "done");
  const taskIds = new Set(tasks.map((task) => task.id));
  const memories = await Promise.all(
    tasks.slice(0, 20).map(async (task) => ({ task_id: task.id, memory: await repo.loadTaskMemory(task.id) })),
  );
  const relevantKnowledge = await loadRelevantKnowledge(
    repo,
    tasks.slice(0, 20).flatMap((task) => [task.id, task.title, task.project, task.compact_summary]),
    { limit: 24 },
  );
  const source = {
    date,
    tasks: tasks.map((task) => ({
      id: task.id,
      project: task.project,
      title: task.title,
      tier: task.tier,
      status: task.status,
      due: task.due,
      report_exclude: task.report_exclude,
      compact_summary: task.compact_summary,
    })),
    today_activity: activity.entries
      .filter((entry) => taskIds.has(entry.task_id))
      .map((entry) => ({
        task_id: entry.task_id,
        done: entry.done,
        next: entry.next,
        compact_summary: entry.compact_summary,
      })),
    today_report: report.entries
      .filter((entry) => taskIds.has(entry.task_id))
      .map((entry) => ({
        task_id: entry.task_id,
        done: entry.done,
        next: entry.next,
        task_snapshot: entry.task_snapshot,
      })),
    task_memory: memories.map(({ task_id, memory }) => ({
      task_id,
      summary: memory.summary,
      decisions: memory.decisions,
      risks: memory.risks,
      next: memory.next,
    })),
    global_memory: {
      summary: globalMemory.summary,
      preferences: globalMemory.preferences,
      rules: globalMemory.rules,
    },
    relevant_knowledge: relevantKnowledge,
  };
  const hash = createHash("sha256")
    .update(JSON.stringify({ external_briefing: externalBriefingSections(brief), source }))
    .digest("hex");
  return { brief, source, taskIds, relevantKnowledge, hash };
}

function parseGenerationMarker(text: string | null): MorningGenerationMarker | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as MorningGenerationMarker;
    return typeof value.generation_id === "string" && typeof value.input_hash === "string" ? value : null;
  } catch {
    return null;
  }
}

function morningTaskSectionsOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      attention: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 240 } },
      task_table: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            priority: { type: "string", minLength: 1, maxLength: 12 },
            task_id: { type: "string", minLength: 1, maxLength: 160 },
            task_name: { type: "string", minLength: 1, maxLength: 160 },
            today_action: { type: "string", minLength: 1, maxLength: 200 },
            today_goal: { type: "string", minLength: 1, maxLength: 200 },
          },
          required: ["priority", "task_id", "task_name", "today_action", "today_goal"],
          additionalProperties: false,
        },
      },
      recommendation: { type: "string", minLength: 1, maxLength: 600 },
    },
    required: ["attention", "task_table", "recommendation"],
    additionalProperties: false,
  };
}

function parseGeneratedMorningTaskSections(
  text: string,
  allowedTaskIds: ReadonlySet<string>,
): GeneratedMorningTaskSections {
  const parsed = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  ) as Partial<GeneratedMorningTaskSections>;
  if (
    !Array.isArray(parsed.attention) ||
    parsed.attention.length > 8 ||
    !parsed.attention.every((item) => typeof item === "string" && item.trim())
  )
    throw new Error("Briefing generation returned invalid attention items.");
  if (
    !Array.isArray(parsed.task_table) ||
    parsed.task_table.length > 6 ||
    !parsed.task_table.every(
      (row) =>
        row &&
        [row.priority, row.task_id, row.task_name, row.today_action, row.today_goal].every(
          (value) => typeof value === "string" && value.trim(),
        ),
    )
  )
    throw new Error("Briefing generation returned an invalid task table.");
  if (allowedTaskIds.size > 0 && parsed.task_table.length === 0) {
    throw new Error("Briefing generation returned an empty task table despite active input tasks.");
  }
  const normalizedTaskIds = parsed.task_table.map((row) => row.task_id.trim());
  if (normalizedTaskIds.some((taskId) => !allowedTaskIds.has(taskId))) {
    throw new Error("Briefing generation returned a task_id that is not an active input task.");
  }
  if (new Set(normalizedTaskIds).size !== normalizedTaskIds.length) {
    throw new Error("Briefing generation returned duplicate task_id values.");
  }
  if (typeof parsed.recommendation !== "string" || !parsed.recommendation.trim())
    throw new Error("Briefing generation returned no recommendation.");
  return {
    attention: parsed.attention.map((item) => item.trim()),
    task_table: parsed.task_table.map((row) => ({
      priority: row.priority.trim(),
      task_id: row.task_id.trim(),
      task_name: row.task_name.trim(),
      today_action: row.today_action.trim(),
      today_goal: row.today_goal.trim(),
    })),
    recommendation: parsed.recommendation.trim(),
  };
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "／").replace(/\s+/g, " ").trim();
}

/**
 * Preserves existing sections 1-3 and merges generated sections 4-6.
 * 既存のセクション 1-3 を保持し、生成済みセクション 4-6 を統合する。
 */
export function mergeMorningTaskSections(base: string, generated: GeneratedMorningTaskSections): string {
  const marker = base.match(/^4\.\s+/m);
  const preserved = (marker?.index === undefined ? base : base.slice(0, marker.index)).trimEnd();
  if (!/^1\.\s+/m.test(preserved) || !/^2\.\s+/m.test(preserved) || !/^3\.\s+/m.test(preserved))
    throw new Error("Briefing sections 1-3 must exist before generating task sections.");
  const tableRows = generated.task_table.map(
    (row) =>
      `| ${markdownCell(row.priority)} | ${markdownCell(row.task_name)} <!--task-id:${encodeURIComponent(row.task_id)}--> | ${markdownCell(row.today_action)} | ${markdownCell(row.today_goal)} |`,
  );
  return [
    preserved,
    "",
    "4. 今日注意が必要なタスク",
    ...generated.attention.map((item) => `- ${item.trim()}`),
    "",
    "5. 本日のワタシ用タスク表",
    "| 優先 | タスク名 | 今日やること | 今日のゴール |",
    "| --- | --- | --- | --- |",
    ...tableRows,
    "",
    "6. 今日の推奨アクション",
    generated.recommendation,
    "",
  ].join("\n");
}

/**
 * Generates briefing sections 4-6 from the current day's task data and saves them.
 * 当日のタスク情報からブリーフィングのセクション 4-6 を生成して保存する。
 */
export async function generateMorningTaskSections(
  repo: Repository,
  config: TaskMcpConfig,
  date: string,
  generate: LlmGenerator = (input) => generateWebLlm(config, input),
): Promise<{
  document: MorningBriefDocument;
  generated: GeneratedMorningTaskSections;
  save: unknown;
  llm_provider: string;
}> {
  const today = resolveDate(undefined, config);
  if (date !== today) throw new Error(`Briefing task sections can only be generated for today (${today}).`);
  const generationId = randomUUID();
  const startedAt = new Date().toISOString();
  const snapshot = await repo.withTransaction(async () => {
    const loaded = await loadMorningGenerationSnapshot(repo, date);
    const marker: MorningGenerationMarker = {
      generation_id: generationId,
      input_hash: loaded.hash,
      status: "running",
      started_at: startedAt,
    };
    await repo.saveOutput(
      "morning-generation",
      date,
      JSON.stringify(marker, null, 2) + "\n",
      "start-morning-generation",
      "json",
    );
    return loaded;
  });
  const prompt = [
    "Generate sections 4-6 of today's Japanese briefing from Personal Context MCP data.",
    "Return only JSON matching the provided schema.",
    "Use only facts supported by the input. Do not invent schedules, progress, blockers, or goals.",
    "Apply global_memory.rules as mandatory user-wide operating constraints when they are relevant and do not conflict with the output schema or source evidence.",
    "Apply global_memory.preferences to prioritization and wording. Use global_memory.summary only as cross-task context, never as evidence of dated work.",
    "Use relevant_knowledge only as task-independent planning context. It cannot prove that work happened today.",
    "Prioritize overdue, blocked, waiting, Tier 1, and concrete next actions. Treat report_exclude tasks as hold items unless urgent.",
    "attention: concise task-specific risks or decisions requiring attention today.",
    "task_table: up to 5 actionable rows plus at most one hold row. task_id must match an input task.",
    "today_action must be a concrete action supported by activity, report, memory next, risk, due date, or current task summary.",
    "today_goal must describe the verifiable state reached by completing that action.",
    "recommendation: recommend an execution order and explain it briefly. Do not mention files, MCP internals, or the generation process.",
    JSON.stringify(snapshot.source),
  ].join("\n");
  const result = await generate({ prompt, cwd: process.cwd(), outputSchema: morningTaskSectionsOutputSchema() });
  const generated = parseGeneratedMorningTaskSections(result.text, snapshot.taskIds);
  const llmMetadata = webLlmMetadata(config, result);
  await recordKnowledgeUsage(repo, config, {
    workflow: "briefing_generate_daily",
    stage: "injected_to_llm",
    date,
    provider: llmMetadata.llm_provider,
    model: result.model,
    contexts: [{ knowledge: snapshot.relevantKnowledge }],
  }).catch((error: unknown) => console.error("Failed to write Knowledge usage log:", error));
  const persisted = await repo.withTransaction(async () => {
    const [latest, markerText] = await Promise.all([
      loadMorningGenerationSnapshot(repo, date),
      repo.loadOutput("morning-generation", date, "json"),
    ]);
    const marker = parseGenerationMarker(markerText);
    if (marker?.generation_id !== generationId) {
      throw new BriefingGenerationConflictError("A newer briefing generation request superseded this result.");
    }
    if (latest.hash !== snapshot.hash) {
      throw new BriefingGenerationConflictError(
        "Briefing inputs changed while the LLM was generating; run generation again.",
      );
    }
    parseGeneratedMorningTaskSections(result.text, latest.taskIds);
    const latestText = mergeMorningTaskSections(latest.brief, generated);
    const morningSave = await repo.saveOutput("morning", date, latestText, "generate-morning-task-sections", "md");
    await repo.saveOutput(
      "morning-progress",
      date,
      JSON.stringify({ date, checked_at: new Date().toISOString(), items: [] }, null, 2) + "\n",
      "reset-morning-task-progress",
      "json",
    );
    const committedMarker: MorningGenerationMarker = {
      ...marker,
      status: "committed",
      committed_at: new Date().toISOString(),
    };
    await repo.saveOutput(
      "morning-generation",
      date,
      JSON.stringify(committedMarker, null, 2) + "\n",
      "commit-morning-generation",
      "json",
    );
    return { save: morningSave, text: latestText };
  });
  return {
    document: parseMorningBrief(date, persisted.text),
    generated,
    save: persisted.save,
    ...llmMetadata,
  };
}

/**
 * Collects external input sections and then generates the current day's task sections.
 * 外部入力セクションを収集した後、当日のタスクセクションを生成する。
 */
export async function generateWebMorningSummary(
  repo: Repository,
  config: TaskMcpConfig,
  date: string,
  collect: (repo: Repository, date: string) => Promise<ExternalInputCollectorResult> = runExternalInputCollector,
  generate: (
    repo: Repository,
    config: TaskMcpConfig,
    date: string,
  ) => ReturnType<typeof generateMorningTaskSections> = generateMorningTaskSections,
): Promise<Awaited<ReturnType<typeof generateMorningTaskSections>> & { external_input: ExternalInputCollectorResult }> {
  const externalInput = await collect(repo, date);
  if (!externalInput.executed) throw new Error("External input collector is not configured or is disabled.");
  const summary = await generate(repo, config, date);
  return { ...summary, external_input: externalInput };
}
