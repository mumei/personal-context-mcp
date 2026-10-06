/**
 * Promotes durable task memory into self-contained task-independent knowledge.
 * Responsibility: This module builds the minimal LLM request, validates generated JSON, and applies a note batch.
 * Non-responsibility: This module never reads Activity, chooses an LLM provider, registers tools, or silently promotes session data.
 *
 * 永続Task Memoryを、自己完結したタスク非依存知識へ昇格します。
 * 責務: このモジュールは、最小限のLLM要求構築、生成JSONの検証、およびノート群の適用を担当します。
 * 非責務: このモジュールは、Activity読み込み、LLM Provider選択、ツール登録、セッションデータの暗黙昇格を行いません。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";
import type { LlmGenerator } from "#llm/types";
import { stripJsonFences } from "#mcp/llm/content";
import { applyKnowledgeNoteBatch, type UpsertKnowledgeNoteInput } from "#domain/knowledge/actions";
import { KNOWLEDGE_NODE_TYPES, KNOWLEDGE_RELATION_TYPES } from "#domain/knowledge/validation";

/** Input for explicit task-memory promotion. 明示的Task Memory昇格の入力です。 */
export interface PromoteTaskMemoryToKnowledgeInput {
  task_id: string;
  max_notes?: number;
}

/** Explicitly promotes reusable Task Memory through an injected configured LLM runtime. 注入された設定済みLLMランタイムを通じ、再利用可能なTask Memoryを明示的に昇格します。 */
export async function promoteTaskMemoryToKnowledge(
  repo: Repository,
  input: PromoteTaskMemoryToKnowledgeInput,
  generate: LlmGenerator,
): Promise<unknown> {
  const [tasks, memory, existingNotes] = await Promise.all([
    repo.loadTasks(),
    repo.loadTaskMemory(input.task_id),
    repo.loadKnowledgeNotes(),
  ]);
  const task = tasks.tasks.find((candidate) => candidate.id === input.task_id && !candidate.deleted);
  if (!task) throw new Error(`Task not found: ${input.task_id}`);
  const durableFields = {
    summary: memory.summary ?? [],
    facts: memory.facts ?? [],
    decisions: memory.decisions ?? [],
    risks: memory.risks ?? [],
    next: memory.next ?? [],
  };
  if (Object.values(durableFields).every((values) => values.length === 0)) {
    throw new Error(`Task memory has no durable content to promote: ${input.task_id}`);
  }
  const maxNotes = Math.max(1, Math.min(10, input.max_notes ?? 3));
  const prompt = [
    "Promote durable Personal Context MCP task memory into task-independent Knowledge Graph notes.",
    "This is an explicit promotion. Return JSON only and do not include commentary.",
    `Return at most ${maxNotes} complete notes. Reuse an existing id when updating the same concept.`,
    "Keep only knowledge reusable beyond this task: systems, technologies, organizations, people, decisions, documents, or concepts.",
    "Do not promote dated work logs, one-time completion statements, monitoring snapshots, transient counts, progress, report prose, commands, PIDs, or local file paths as knowledge content.",
    "Every note must be understandable and reusable without opening a task, file, URL, or external document.",
    "A note qualifies only when it remains meaningful after removing the originating task name and date, can be reused across multiple tasks, and explains why it holds, where it applies, and relevant limitations.",
    "Keep task-specific reusable facts and decisions in Task Memory, dated work and transient observations in Activity, and user-wide preferences or operating rules in Global Memory. Do not duplicate those into Knowledge.",
    "Good generalization: 'When a customer objects to price, identify whether ROI, budget timing, or value recognition is unresolved before responding.'",
    "Rejected task-specific statement: 'Customer X rejected Task Y's quote today.'",
    "If none of the supplied memory qualifies, return {notes:[],skipped_reason:'...'} instead of creating a weak or task-specific note.",
    "Embed at least one evidence item with a reusable statement and the rationale that supports it. Include applicability and limitations when useful.",
    "Use body for explanation that is not already represented in evidence. Do not add an Evidence or 根拠 heading to body.",
    "Do not output task ids, activity ids, local paths, URLs, or source references as evidence. Generalize the supporting content into the note itself.",
    "Relations are additions or updates. Existing aliases, tags, evidence, body content, and unrelated relations are preserved when an existing id is reused.",
    "Targets must be existing notes or notes returned in the same response.",
    `Node types: ${KNOWLEDGE_NODE_TYPES.join(", ")}.`,
    `Relation types: ${KNOWLEDGE_RELATION_TYPES.join(", ")}.`,
    "Use safe lowercase ids containing only a-z, 0-9, underscore, or hyphen.",
    "Response shape: {notes:[{id,title,type,aliases,tags,summary,evidence,relations,body}],skipped_reason?:string}",
    "Existing graph nodes:",
    JSON.stringify(existingNotes.map(({ body: _body, ...note }) => note)),
    "Task title and already-consolidated durable memory (Activity is intentionally excluded):",
    JSON.stringify({ task: { id: task.id, title: task.title, project: task.project }, memory: durableFields }),
  ].join("\n");
  const response = await generate({ prompt, cwd: process.cwd(), outputSchema: promotionOutputSchema(maxNotes) });
  const parsed = JSON.parse(stripJsonFences(response.text)) as {
    notes?: UpsertKnowledgeNoteInput[];
    skipped_reason?: string;
  };
  if (!Array.isArray(parsed.notes) || parsed.notes.length > maxNotes) {
    throw new Error(`Knowledge promotion must return between 0 and ${maxNotes} notes.`);
  }
  if (parsed.notes.length === 0) {
    return {
      task_id: input.task_id,
      llm_provider: response.provider,
      model: response.model,
      skipped: true,
      skipped_reason: parsed.skipped_reason?.trim() || "No task-independent reusable knowledge was found.",
      notes: [],
      index: {
        node_count: existingNotes.length,
        edge_count: existingNotes.reduce((count, note) => count + note.relations.length, 0),
      },
      saves: [],
    };
  }
  const applied = await applyKnowledgeNoteBatch(repo, parsed.notes);
  return {
    task_id: input.task_id,
    llm_provider: response.provider,
    model: response.model,
    notes: applied.notes,
    index: { node_count: applied.index.nodes.length, edge_count: applied.index.edges.length },
    saves: applied.saves,
    index_save: applied.index_save,
  };
}

function promotionOutputSchema(maxNotes: number): Record<string, unknown> {
  const evidence = {
    type: "object",
    properties: {
      statement: { type: "string", minLength: 1 },
      rationale: { type: "string", minLength: 1 },
      applicability: { type: "string", minLength: 1 },
      limitations: { type: "string", minLength: 1 },
    },
    required: ["statement", "rationale"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: {
      notes: {
        type: "array",
        maxItems: maxNotes,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            type: { type: "string", enum: [...KNOWLEDGE_NODE_TYPES] },
            aliases: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            summary: { type: "string", minLength: 1 },
            relations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: [...KNOWLEDGE_RELATION_TYPES] },
                  target_id: { type: "string" },
                  label: { type: "string" },
                },
                required: ["type", "target_id"],
                additionalProperties: false,
              },
            },
            evidence: { type: "array", items: evidence, minItems: 1 },
            body: { type: "string", minLength: 1 },
          },
          required: ["id", "title", "type", "aliases", "tags", "summary", "evidence", "relations", "body"],
          additionalProperties: false,
        },
      },
      skipped_reason: { type: "string" },
    },
    required: ["notes"],
    additionalProperties: false,
  };
}
