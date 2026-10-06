/**
 * Coordinates canonical Knowledge Graph persistence and retrieval operations.
 * Responsibility: This module owns transactional upsert, index rebuild, note retrieval, and bounded search workflows.
 * Non-responsibility: This module does not register MCP tools, render Web UI, or generate knowledge with an LLM.
 *
 * 正規Knowledge Graphの永続化および取得操作を調整します。
 * 責務: このモジュールは、トランザクション付きupsert、索引再構築、ノート取得、および範囲制限検索を担当します。
 * 非責務: このモジュールは、MCPツール登録、Web UI描画、LLMによる知識生成を担当しません。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";
import type {
  KnowledgeGraphIndex,
  KnowledgeGraphResult,
  KnowledgeEvidence,
  KnowledgeNodeType,
  KnowledgeNote,
  KnowledgeRelation,
  SaveResult,
} from "#shared/types";
import { buildKnowledgeGraphIndex, searchKnowledgeGraph, type KnowledgeSearchInput } from "#domain/knowledge/graph";
import { validateKnowledgeGraph } from "#domain/knowledge/validation";

/** Complete mutable fields accepted by a knowledge-note upsert. Knowledgeノートupsertが受け付ける完全な変更可能フィールドです。 */
export interface UpsertKnowledgeNoteInput {
  id: string;
  title: string;
  type: KnowledgeNodeType;
  aliases?: string[];
  tags?: string[];
  summary: string;
  evidence: KnowledgeEvidence[];
  relations?: KnowledgeRelation[];
  body: string;
}

/** Result of one transactional knowledge-note upsert. 1件のトランザクション付きKnowledgeノートupsert結果です。 */
export interface UpsertKnowledgeNoteResult {
  note: KnowledgeNote;
  note_save: SaveResult;
  index_save: SaveResult;
  node_count: number;
  edge_count: number;
}

/** Creates or completely updates one canonical note and rebuilds the index. 正規ノートを1件作成または完全更新し、索引を再構築します。 */
export async function upsertKnowledgeNote(
  repo: Repository,
  input: UpsertKnowledgeNoteInput,
): Promise<UpsertKnowledgeNoteResult> {
  return repo.withTransaction(async () => {
    const now = new Date().toISOString();
    const current = await repo.loadKnowledgeNotes();
    const existing = current.find((item) => item.id === input.id);
    const note: KnowledgeNote = {
      id: input.id,
      title: input.title,
      type: input.type,
      aliases: input.aliases ?? [],
      tags: input.tags ?? [],
      summary: input.summary,
      evidence: input.evidence,
      relations: input.relations ?? [],
      created_at: existing?.created_at || now,
      updated_at: now,
      body: input.body ?? "",
    };
    const validated = validateKnowledgeGraph([...current.filter((item) => item.id !== input.id), note]);
    const savedNote = validated.find((item) => item.id === input.id);
    if (!savedNote) throw new Error(`Validated knowledge note is missing: ${input.id}`);
    const index = buildKnowledgeGraphIndex(validated, now);
    const noteSave = await repo.saveKnowledgeNote(
      savedNote,
      existing ? "update-knowledge-note" : "create-knowledge-note",
    );
    const indexSave = await repo.saveKnowledgeGraphIndex(index);
    return {
      note: savedNote,
      note_save: noteSave,
      index_save: indexSave,
      node_count: index.nodes.length,
      edge_count: index.edges.length,
    };
  });
}

/** Applies a self-contained batch of generated notes as one validated transaction. 自己完結した生成ノート群を、検証済みの1トランザクションとして適用します。 */
export async function applyKnowledgeNoteBatch(
  repo: Repository,
  inputs: UpsertKnowledgeNoteInput[],
  reason = "promote-task-memory-to-knowledge",
): Promise<{ notes: KnowledgeNote[]; saves: SaveResult[]; index_save: SaveResult; index: KnowledgeGraphIndex }> {
  if (inputs.length === 0) throw new Error("Knowledge promotion produced no notes.");
  for (const input of inputs) {
    if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
      throw new Error(`Knowledge promotion must embed evidence in every note: ${input.id}`);
    }
  }
  const duplicateIds = inputs.map((input) => input.id).filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0)
    throw new Error(`Knowledge promotion returned duplicate ids: ${duplicateIds.join(", ")}`);
  return repo.withTransaction(async () => {
    const now = new Date().toISOString();
    const current = await repo.loadKnowledgeNotes();
    const currentById = new Map(current.map((note) => [note.id, note]));
    const replacements = inputs.map((input) => mergePromotedKnowledgeNote(currentById.get(input.id), input, now));
    const replacingIds = new Set(replacements.map((note) => note.id));
    const validated = validateKnowledgeGraph([
      ...current.filter((note) => !replacingIds.has(note.id)),
      ...replacements,
    ]);
    const index = buildKnowledgeGraphIndex(validated, now);
    const notes = validated.filter((note) => replacingIds.has(note.id));
    const saves: SaveResult[] = [];
    for (const note of notes) saves.push(await repo.saveKnowledgeNote(note, reason));
    const indexSave = await repo.saveKnowledgeGraphIndex(index);
    return { notes, saves, index_save: indexSave, index };
  });
}

function mergePromotedKnowledgeNote(
  existing: KnowledgeNote | undefined,
  input: UpsertKnowledgeNoteInput,
  now: string,
): KnowledgeNote {
  const relationMap = new Map(
    (existing?.relations ?? []).map((relation) => [`${relation.type}\u0000${relation.target_id}`, relation]),
  );
  for (const relation of input.relations ?? []) {
    const key = `${relation.type}\u0000${relation.target_id}`;
    const previous = relationMap.get(key);
    relationMap.set(key, {
      ...previous,
      ...relation,
    });
  }
  return {
    id: input.id,
    title: input.title || existing?.title || input.id,
    type: input.type,
    aliases: uniqueStrings([...(existing?.aliases ?? []), ...(input.aliases ?? [])]),
    tags: uniqueStrings([...(existing?.tags ?? []), ...(input.tags ?? [])]),
    summary: input.summary?.trim() || existing?.summary || "",
    evidence: mergeEvidence(existing?.evidence, input.evidence),
    relations: [...relationMap.values()],
    created_at: existing?.created_at || now,
    updated_at: now,
    body: mergeBodies(existing?.body, input.body),
  };
}

function mergeEvidence(existing: KnowledgeEvidence[] | undefined, incoming: KnowledgeEvidence[]): KnowledgeEvidence[] {
  const evidence = new Map<string, KnowledgeEvidence>();
  for (const item of [...(existing ?? []), ...incoming]) evidence.set(JSON.stringify(item), item);
  return [...evidence.values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function mergeBodies(existing: string | undefined, incoming: string | undefined): string {
  const current = existing?.trim() ?? "";
  const addition = incoming?.trim() ?? "";
  if (!current) return addition;
  if (!addition || current.includes(addition)) return current;
  return `${current}\n\n${addition}`;
}

/** Rebuilds and persists the derived index exclusively from canonical notes. 正規ノートのみから派生索引を再構築して保存します。 */
export async function rebuildKnowledgeGraph(repo: Repository): Promise<{
  index: KnowledgeGraphIndex;
  save: SaveResult;
}> {
  const index = buildKnowledgeGraphIndex(await repo.loadKnowledgeNotes());
  const save = await repo.saveKnowledgeGraphIndex(index);
  return { index, save };
}

/** Searches the current canonical graph without trusting a potentially stale derived index. 古い可能性のある派生索引を信頼せず、現在の正規グラフを検索します。 */
export async function searchKnowledge(repo: Repository, input: KnowledgeSearchInput): Promise<KnowledgeGraphResult> {
  return searchKnowledgeGraph(buildKnowledgeGraphIndex(await repo.loadKnowledgeNotes()), input);
}

/** Loads one note and a bounded graph neighborhood around it. 1件のノートとその周辺グラフを範囲制限付きで読み込みます。 */
export async function getKnowledgeNote(
  repo: Repository,
  id: string,
  depth = 1,
  limit = 25,
): Promise<{ note: KnowledgeNote; graph: KnowledgeGraphResult }> {
  const note = await repo.loadKnowledgeNote(id);
  if (!note) throw new Error(`Knowledge note not found: ${id}`);
  const index = buildKnowledgeGraphIndex(await repo.loadKnowledgeNotes());
  const graph = searchKnowledgeGraph(index, { query: id, depth, limit });
  return { note, graph };
}
