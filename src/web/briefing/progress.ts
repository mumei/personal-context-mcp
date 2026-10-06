/**
 * @packageDocumentation
 * Assesses progress against the current day's briefing task table and reads saved assessments.
 * It does not generate briefing text, build the complete overview, or handle HTTP requests.
 * 当日のブリーフィングタスク表に対する進捗を判定し、保存済みの判定を読み取る。
 * ブリーフィング本文の生成、概要全体の構築、HTTP リクエスト処理は担当しない。
 */
import type { LlmGenerator } from "#llm/types";
import { loadRelevantKnowledge } from "#app/knowledgeContext";
import { recordKnowledgeUsage } from "#infra/audit/knowledgeUsage";
import { resolveDate } from "#shared/date";
import { activeTasks } from "#domain/tasks/state";
import { Repository } from "#infra/repository/repository";
import type { TaskMcpConfig } from "#shared/types";
import type { GeneratedMorningTaskSections, MorningProgressDocument, MorningProgressState } from "#web/types";
import { generateWebLlm, webLlmMetadata } from "#web/llm";
import { parseMorningBrief } from "#web/briefing/parser";

function morningProgressOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            task_id: { type: "string", minLength: 1, maxLength: 160 },
            state: {
              type: "string",
              enum: ["not_started", "in_progress", "aligned", "completed", "waiting", "blocked"],
            },
            assessment: { type: "string", minLength: 1, maxLength: 400 },
            evidence: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 200 } },
          },
          required: ["task_id", "state", "assessment", "evidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  };
}

function parseMorningProgress(text: string, taskIds: string[], date: string): MorningProgressDocument {
  const parsed = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  ) as { items?: MorningProgressDocument["items"] };
  const validStates = new Set<MorningProgressState>([
    "not_started",
    "in_progress",
    "aligned",
    "completed",
    "waiting",
    "blocked",
  ]);
  if (!Array.isArray(parsed.items)) throw new Error("Briefing progress check returned no items.");
  const expected = new Set(taskIds);
  const seen = new Set<string>();
  const items = parsed.items.map((item) => {
    if (!item || !expected.has(item.task_id) || seen.has(item.task_id))
      throw new Error("Briefing progress check returned an unknown or duplicate task_id.");
    if (
      !validStates.has(item.state) ||
      typeof item.assessment !== "string" ||
      !item.assessment.trim() ||
      item.assessment.length > 400 ||
      !Array.isArray(item.evidence) ||
      !item.evidence.every((value) => typeof value === "string" && value.trim())
    )
      throw new Error(`Briefing progress check returned an invalid assessment for ${item.task_id}.`);
    seen.add(item.task_id);
    return {
      task_id: item.task_id,
      state: item.state,
      assessment: item.assessment.trim(),
      evidence: item.evidence.map((value) => value.trim()).slice(0, 4),
    };
  });
  if (seen.size !== expected.size) throw new Error("Briefing progress check did not assess every task-table row.");
  return { date, checked_at: new Date().toISOString(), items };
}

function morningTaskPlanRows(text: string, date: string): GeneratedMorningTaskSections["task_table"] {
  const table = parseMorningBrief(date, text).sections.find((section) => section.number === 5)?.table;
  if (!table?.rows.length) throw new Error("Today's personal task table has not been generated.");
  return table.rows.map((row) => {
    const encodedTaskId = row.join(" ").match(/<!--task-id:([^>]+)-->/)?.[1];
    let taskId = "";
    try {
      taskId = encodedTaskId ? decodeURIComponent(encodedTaskId) : "";
    } catch {
      taskId = "";
    }
    if (!taskId) throw new Error("Today's personal task table contains a row without task_id.");
    const clean = row.map((cell) => cell.replace(/ *<!--task-id:[^>]+-->/g, "").trim());
    return {
      priority: clean[0] ?? "",
      task_id: taskId,
      task_name: clean[1] ?? taskId,
      today_action: clean[2] ?? "",
      today_goal: clean[3] ?? "",
    };
  });
}

/**
 * Compares the current day's task table with evidence, assesses each row, and saves the result.
 * 当日のタスク表を証拠データと比較し、各行の進捗を判定して保存する。
 */
export async function checkMorningTaskProgress(
  repo: Repository,
  config: TaskMcpConfig,
  date: string,
  generate: LlmGenerator = (input) => generateWebLlm(config, input),
): Promise<{ document: MorningProgressDocument; save: unknown; llm_provider: string }> {
  const today = resolveDate(undefined, config);
  if (date !== today) throw new Error(`Briefing task progress can only be checked for today (${today}).`);
  const morningBrief = await repo.loadOutput("morning", date, "md");
  if (!morningBrief) throw new Error("Generate today's briefing before checking task progress.");
  const plan = morningTaskPlanRows(morningBrief, date);
  const taskIds = plan.map((row) => row.task_id);
  const taskIdSet = new Set(taskIds);
  const tasks = activeTasks((await repo.loadTasks()).tasks).filter((task) => taskIdSet.has(task.id));
  if (tasks.length !== taskIdSet.size)
    throw new Error("Today's personal task table references an inactive or missing task.");
  const [activity, report, memories, globalMemory, relevantKnowledge] = await Promise.all([
    repo.loadActivity(date),
    repo.loadReport(date),
    Promise.all(taskIds.map(async (taskId) => ({ task_id: taskId, memory: await repo.loadTaskMemory(taskId) }))),
    repo.loadGlobalMemory(),
    loadRelevantKnowledge(
      repo,
      plan.flatMap((row) => [row.task_id, row.task_name, row.today_action, row.today_goal]),
      { limit: 18 },
    ),
  ]);
  const source = {
    date,
    plan,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      project: task.project,
      status: task.status,
      due: task.due,
      compact_summary: task.compact_summary,
    })),
    today_activity: activity.entries
      .filter((entry) => taskIdSet.has(entry.task_id))
      .map((entry) => ({
        task_id: entry.task_id,
        done: entry.done,
        next: entry.next,
        compact_summary: entry.compact_summary,
      })),
    today_report: report.entries
      .filter((entry) => taskIdSet.has(entry.task_id))
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
  const prompt = [
    "Assess whether each row in today's personal task table is progressing in alignment with its today_action and today_goal.",
    "Return only JSON matching the schema. Assess every task_id exactly once and never add task IDs.",
    "Use only supplied evidence. Do not infer that work happened merely because it was planned.",
    "Apply global_memory.rules as mandatory user-wide assessment constraints when relevant and compatible with the schema and evidence.",
    "Apply global_memory.preferences to wording. Treat global_memory.summary only as cross-task context, not evidence of progress.",
    "Relevant Knowledge is background context only. Never treat it as evidence that today's planned work progressed or completed.",
    "State meanings: not_started=no evidence of work; in_progress=work exists but alignment or goal attainment is still unclear; aligned=evidence shows work is following the planned action; completed=the stated goal is achieved; waiting=progress depends on an external response; blocked=a concrete blocker prevents the planned action.",
    "assessment must be one or two concise Japanese sentences that state what has concretely been completed so far and what remains before today's goal is achieved.",
    "When no work is evidenced, explicitly say that no completed progress can be confirmed and name the planned first action.",
    "evidence must contain only concise facts present in the input. Never mention files, MCP internals, or generation mechanics.",
    JSON.stringify(source),
  ].join("\n");
  const result = await generate({ prompt, cwd: process.cwd(), outputSchema: morningProgressOutputSchema() });
  const document = parseMorningProgress(result.text, taskIds, date);
  const llmMetadata = webLlmMetadata(config, result);
  await recordKnowledgeUsage(repo, config, {
    workflow: "briefing_check_progress",
    stage: "injected_to_llm",
    date,
    provider: llmMetadata.llm_provider,
    model: result.model,
    contexts: [{ knowledge: relevantKnowledge }],
  }).catch((error: unknown) => console.error("Failed to write Knowledge usage log:", error));
  const save = await repo.saveOutput(
    "morning-progress",
    date,
    JSON.stringify(document, null, 2) + "\n",
    "check-morning-task-progress",
    "json",
  );
  return { document, save, ...llmMetadata };
}

/**
 * Validates a saved progress assessment and returns null when it cannot be used.
 * 保存済みの進捗判定を検証し、利用できない場合は null を返す。
 */
export async function loadMorningProgress(repo: Repository, date: string): Promise<MorningProgressDocument | null> {
  const text = await repo.loadOutput("morning-progress", date, "json");
  if (!text) return null;
  try {
    const value = JSON.parse(text) as MorningProgressDocument;
    return value.date === date && Array.isArray(value.items) ? value : null;
  } catch {
    return null;
  }
}
