/**
 * @packageDocumentation
 * Generates, normalizes, and saves a mind map derived from task memory.
 * It does not reorganize the full task context, generate briefings, or handle HTTP requests.
 * タスクメモリからマインドマップを生成・正規化し、保存する。
 * タスクコンテキスト全体の再編成、ブリーフィングの生成、HTTP リクエスト処理は担当しない。
 */
import { normalizeMemoryMindMap, updateTaskMemoryMindMap } from "#domain/memory/actions";
import { isTaskDeleted } from "#domain/tasks/state";
import { Repository } from "#infra/repository/repository";
import type { TaskMcpConfig } from "#shared/types";
import { generateWebLlm, webLlmMetadata } from "#web/llm";

function mindMapOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      mindmap: {
        type: "object",
        properties: {
          root: { type: "string", maxLength: 32 },
          paths: {
            type: "array",
            maxItems: 24,
            items: { type: "array", minItems: 2, maxItems: 6, items: { type: "string", maxLength: 32 } },
          },
        },
        required: ["root", "paths"],
        additionalProperties: false,
      },
    },
    required: ["mindmap"],
    additionalProperties: false,
  };
}

/**
 * Generates and saves a mind map from consolidated task memory.
 * 統合済みタスクメモリからマインドマップを生成して保存する。
 */
export async function generateWebTaskMindMap(
  repo: Repository,
  config: TaskMcpConfig,
  taskId: string,
): Promise<unknown> {
  const [tasks, memory] = await Promise.all([repo.loadTasks(), repo.loadTaskMemory(taskId)]);
  const task = tasks.tasks.find((item) => item.id === taskId);
  if (!task || isTaskDeleted(task)) throw new Error(`Task not found: ${taskId}`);
  const sharedMemory = {
    summary: memory.summary ?? [],
    facts: memory.facts ?? [],
    decisions: memory.decisions ?? [],
    risks: memory.risks ?? [],
    next: memory.next ?? [],
  };
  if (Object.values(sharedMemory).every((items) => items.length === 0))
    throw new Error("Task memory has no content to map.");
  const prompt = [
    "Create a compact Japanese mind map from already-consolidated task memory.",
    "Return only JSON matching {mindmap:{root,paths}}.",
    "Use meaningful 4-6 level paths when supported by the memory.",
    "Organize each path by scope, concern, subject, and state.",
    "Every leaf must state a concrete current status, settled decision, active risk, or next action.",
    "Avoid vague standalone labels such as 状況, 対応, 確認, or 次.",
    "Keep each label under 32 Japanese characters and do not copy full memory sentences.",
    JSON.stringify({ task_id: taskId, title: task.title, memory: sharedMemory }),
  ].join("\n");
  const generated = await generateWebLlm(config, { prompt, cwd: process.cwd(), outputSchema: mindMapOutputSchema() });
  const parsed = JSON.parse(
    generated.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  ) as { mindmap?: unknown };
  const mindmap = normalizeMemoryMindMap(parsed.mindmap);
  if (!mindmap || mindmap.children.length === 0) throw new Error("Mind-map generation returned no usable paths.");
  const applied = await updateTaskMemoryMindMap(repo, taskId, mindmap);
  return {
    task_id: taskId,
    ...webLlmMetadata(config, generated),
    shared_fields: Object.keys(sharedMemory),
    excluded_fields: ["context", "activities", "inputs", "sources", "file_paths"],
    mindmap,
    save: applied.save,
  };
}

/**
 * Returns the mind map definition shared with the information organization schema.
 * 情報整理スキーマと共有するマインドマップ定義を返す。
 */
export function mindMapSchemaForOrganization(): unknown {
  return (mindMapOutputSchema().properties as Record<string, unknown>).mindmap;
}
