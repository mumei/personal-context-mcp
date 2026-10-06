/**
 * Builds and queries the derived Knowledge Graph index.
 * Responsibility: This module converts validated notes to an index and performs bounded text, filter, and neighborhood search.
 * Non-responsibility: This module does not persist canonical notes, mutate graph data, or invoke an LLM.
 *
 * 派生Knowledge Graph索引を構築および検索します。
 * 責務: このモジュールは、検証済みノートの索引化と、範囲制限されたテキスト・フィルター・近傍検索を担当します。
 * 非責務: このモジュールは、正規ノートの永続化、グラフデータ変更、LLM呼び出しを担当しません。
 *
 * @packageDocumentation
 */

import type { KnowledgeGraphIndex, KnowledgeGraphResult, KnowledgeNodeType, KnowledgeNote } from "#shared/types";
import { validateKnowledgeGraph } from "#domain/knowledge/validation";

/** Search options accepted by the Knowledge Graph domain. Knowledge Graphドメインが受け付ける検索オプションです。 */
export interface KnowledgeSearchInput {
  query?: string;
  type?: KnowledgeNodeType;
  tags?: string[];
  depth?: number;
  limit?: number;
}

/** Builds a complete derived index from canonical notes. 正規ノートから完全な派生索引を構築します。 */
export function buildKnowledgeGraphIndex(notes: KnowledgeNote[], now = new Date().toISOString()): KnowledgeGraphIndex {
  const validated = validateKnowledgeGraph(notes);
  return {
    version: 2,
    generated_at: now,
    nodes: validated.map(({ body: _body, relations: _relations, ...node }) => node),
    edges: validated.flatMap((note) => note.relations.map((relation) => ({ source_id: note.id, ...relation }))),
  };
}

/** Searches matching nodes and includes a bounded neighborhood around them. 一致ノードを検索し、その周辺を範囲制限付きで含めます。 */
export function searchKnowledgeGraph(index: KnowledgeGraphIndex, input: KnowledgeSearchInput): KnowledgeGraphResult {
  const depth = Math.max(0, Math.min(3, input.depth ?? 1));
  const limit = Math.max(1, Math.min(250, input.limit ?? 25));
  const query = input.query?.trim().toLocaleLowerCase();
  const tags = (input.tags ?? []).map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean);
  const ranked = index.nodes
    .filter((node) => !input.type || node.type === input.type)
    .filter((node) => tags.every((tag) => node.tags.some((candidate) => candidate.toLocaleLowerCase() === tag)))
    .map((node) => ({ node, score: matchScore(node, query) }))
    .filter(({ score }) => !query || score > 0)
    .sort((left, right) => right.score - left.score || left.node.title.localeCompare(right.node.title));
  const selected = new Set(ranked.slice(0, limit).map(({ node }) => node.id));
  let frontier = new Set(selected);
  for (let level = 0; level < depth && selected.size < limit; level += 1) {
    const next = new Set<string>();
    for (const edge of index.edges) {
      const neighbor = frontier.has(edge.source_id)
        ? edge.target_id
        : frontier.has(edge.target_id)
          ? edge.source_id
          : undefined;
      if (neighbor && !selected.has(neighbor)) next.add(neighbor);
    }
    for (const id of [...next].sort()) {
      if (selected.size >= limit) break;
      selected.add(id);
    }
    frontier = next;
  }
  const nodes = index.nodes.filter((node) => selected.has(node.id));
  const edges = index.edges.filter((edge) => selected.has(edge.source_id) && selected.has(edge.target_id));
  return {
    ...(input.query?.trim() ? { query: input.query.trim() } : {}),
    depth,
    limit,
    truncated: ranked.length > limit || index.nodes.length > nodes.length,
    nodes,
    edges,
  };
}

function matchScore(node: KnowledgeGraphIndex["nodes"][number], query?: string): number {
  if (!query) return 1;
  const normalizedQuery = normalizeSearchText(query);
  const title = normalizeSearchText(node.title);
  const id = normalizeSearchText(node.id);
  const aliases = node.aliases.map(normalizeSearchText);
  const tags = node.tags.map(normalizeSearchText);
  const searchable = [
    title,
    id,
    ...aliases,
    ...tags,
    normalizeSearchText(node.summary),
    ...node.evidence.flatMap((item) =>
      [item.statement, item.rationale, item.applicability, item.limitations]
        .filter((value): value is string => Boolean(value))
        .map(normalizeSearchText),
    ),
  ];
  if (id === normalizedQuery || title === normalizedQuery) return 100;
  if (aliases.some((alias) => alias === normalizedQuery)) return 90;
  if (title.includes(normalizedQuery) || id.includes(normalizedQuery)) return 70;
  if (aliases.some((alias) => alias.includes(normalizedQuery))) return 60;
  if (tags.some((tag) => tag.includes(normalizedQuery))) return 40;
  if (normalizeSearchText(node.summary).includes(normalizedQuery)) return 20;
  if (searchable.slice(5).some((value) => value.includes(normalizedQuery))) return 15;

  const tokens = searchTokens(normalizedQuery);
  if (tokens.length === 0) return 0;
  const matched = tokens.filter((token) => searchable.some((value) => value.includes(token))).length;
  // A multi-concept request needs at least two independent signals. This avoids
  // returning every Japanese note that merely shares one common two-character term.
  if (matched < Math.min(2, tokens.length)) return 0;
  return 10 + matched * 5;
}

/** Normalizes compatibility characters and case before deterministic text matching. */
function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

/**
 * Extracts Latin/number words and overlapping Japanese character pairs. Japanese
 * generally has no whitespace word boundaries, so pairs make compound queries
 * such as "認証基盤 Keycloak" match evidence split across fields.
 */
function searchTokens(query: string): string[] {
  const tokens = new Set<string>();
  for (const part of query.match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[\p{Script=Latin}\p{Number}]+/gu,
  ) ?? []) {
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(part)) {
      for (let index = 0; index < part.length - 1; index += 1) tokens.add(part.slice(index, index + 2));
    } else if (part.length >= 2) {
      tokens.add(part);
    }
  }
  return [...tokens];
}
