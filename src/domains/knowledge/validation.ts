/**
 * Validates and normalizes canonical Knowledge Graph notes.
 * Responsibility: This module enforces safe identifiers, supported enums, self-contained evidence, alias uniqueness, and edge integrity.
 * Non-responsibility: This module does not read files, write indexes, search graphs, or invoke an LLM.
 *
 * 正規Knowledge Graphノートを検証および正規化します。
 * 責務: このモジュールは、安全な識別子、対応enum、自己完結した根拠形式、別名一意性、および辺の整合性を保証します。
 * 非責務: このモジュールは、ファイル読み込み、索引書き込み、グラフ検索、LLM呼び出しを担当しません。
 *
 * @packageDocumentation
 */

import type {
  KnowledgeEvidence,
  KnowledgeNodeType,
  KnowledgeNote,
  KnowledgeRelation,
  KnowledgeRelationType,
} from "#shared/types";

/** Supported node categories. サポート対象のノードカテゴリです。 */
export const KNOWLEDGE_NODE_TYPES = [
  "concept",
  "system",
  "technology",
  "organization",
  "person",
  "decision",
  "document",
] as const satisfies readonly KnowledgeNodeType[];

/** Supported relation categories. サポート対象の関係カテゴリです。 */
export const KNOWLEDGE_RELATION_TYPES = [
  "uses",
  "depends_on",
  "replaces",
  "related_to",
  "owned_by",
  "documented_by",
  "derived_from",
  "supports",
  "applies_to",
] as const satisfies readonly KnowledgeRelationType[];

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const nodeTypes = new Set<string>(KNOWLEDGE_NODE_TYPES);
const relationTypes = new Set<string>(KNOWLEDGE_RELATION_TYPES);

/** Returns whether a value is a safe canonical note identifier. 値が安全な正規ノート識別子かを返します。 */
export function isSafeKnowledgeId(value: string): boolean {
  return SAFE_ID.test(value);
}

/** Normalizes one note and validates fields that do not depend on other nodes. 他ノードに依存しないフィールドを検証し、1件のノートを正規化します。 */
export function normalizeKnowledgeNote(note: KnowledgeNote): KnowledgeNote {
  const id = note.id.trim();
  if (!isSafeKnowledgeId(id)) throw new Error(`Unsafe knowledge note id: ${note.id}`);
  const title = note.title.trim();
  if (!title) throw new Error(`Knowledge note title is required: ${id}`);
  if (!nodeTypes.has(note.type)) throw new Error(`Unsupported knowledge node type: ${String(note.type)}`);
  const aliases = note.aliases.map((value) => value.trim()).filter(Boolean);
  const aliasKeys = aliases.map(identityKey);
  if (new Set(aliasKeys).size !== aliasKeys.length) throw new Error(`Duplicate aliases in knowledge note: ${id}`);
  const tags = [...new Set(note.tags.map((value) => value.trim()).filter(Boolean))].sort();
  const summary = note.summary.trim();
  const body = note.body.trim();
  if (!summary) throw new Error(`Knowledge note summary is required: ${id}`);
  if (!body) throw new Error(`Knowledge note body is required: ${id}`);
  if (/^##\s+(?:根拠|Evidence)\s*$/imu.test(body)) {
    throw new Error(`Knowledge note body must not duplicate the structured evidence section: ${id}`);
  }
  if (!Array.isArray(note.evidence) || note.evidence.length === 0) {
    throw new Error(`Knowledge note evidence is required: ${id}`);
  }
  const evidence = note.evidence.map((item, index) => normalizeEvidence(item, id, index));
  const relations = note.relations.map((relation) => normalizeRelation(relation, id));
  const relationKeys = relations.map((relation) => `${relation.type}\u0000${relation.target_id}`);
  if (new Set(relationKeys).size !== relationKeys.length)
    throw new Error(`Duplicate relations in knowledge note: ${id}`);
  if (!isIsoTimestamp(note.created_at) || !isIsoTimestamp(note.updated_at)) {
    throw new Error(`Knowledge note timestamps must be ISO-8601 values: ${id}`);
  }
  return {
    ...note,
    id,
    title,
    aliases,
    tags,
    summary,
    evidence,
    relations,
    body,
  };
}

/** Validates graph-wide aliases and outgoing relations, returning normalized notes. グラフ全体の別名と出辺を検証し、正規化済みノートを返します。 */
export function validateKnowledgeGraph(notes: KnowledgeNote[]): KnowledgeNote[] {
  const normalized = notes.map(normalizeKnowledgeNote);
  const ids = new Set(normalized.map((note) => note.id));
  if (ids.size !== normalized.length) throw new Error("Duplicate knowledge note ids were found.");
  const identities = new Map<string, string>();
  for (const note of normalized) {
    registerIdentity(identities, note.id, note.id);
    for (const alias of note.aliases) registerIdentity(identities, alias, note.id);
  }
  for (const note of normalized) {
    for (const relation of note.relations) {
      if (relation.target_id === note.id) throw new Error(`Self relation is not allowed: ${note.id}`);
      if (!ids.has(relation.target_id)) {
        throw new Error(`Unknown knowledge relation target: ${note.id} -> ${relation.target_id}`);
      }
    }
  }
  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeRelation(relation: KnowledgeRelation, sourceId: string): KnowledgeRelation {
  if (!relationTypes.has(relation.type))
    throw new Error(`Unsupported knowledge relation type: ${String(relation.type)}`);
  const targetId = relation.target_id.trim();
  if (!isSafeKnowledgeId(targetId)) throw new Error(`Unsafe relation target from ${sourceId}: ${targetId}`);
  const label = relation.label?.trim();
  return {
    type: relation.type,
    target_id: targetId,
    ...(label ? { label } : {}),
  };
}

function normalizeEvidence(evidence: KnowledgeEvidence, noteId: string, index: number): KnowledgeEvidence {
  const statement = evidence.statement?.trim();
  const rationale = evidence.rationale?.trim();
  if (!statement || !rationale)
    throw new Error(`Knowledge evidence requires statement and rationale: ${noteId}[${index}]`);
  const applicability = evidence.applicability?.trim();
  const limitations = evidence.limitations?.trim();
  return {
    statement,
    rationale,
    ...(applicability ? { applicability } : {}),
    ...(limitations ? { limitations } : {}),
  };
}

function identityKey(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function registerIdentity(identities: Map<string, string>, value: string, owner: string): void {
  const key = identityKey(value);
  const existing = identities.get(key);
  if (existing) throw new Error(`Duplicate knowledge id or alias '${value}' is owned by ${existing} and ${owner}.`);
  identities.set(key, owner);
}

function isIsoTimestamp(value: string): boolean {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}
