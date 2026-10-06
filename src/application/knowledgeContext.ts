/**
 * Builds bounded task-relevant Knowledge Graph context for LLM workflows.
 * Responsibility: This module derives search terms, builds a current in-memory graph from canonical notes, and returns a compact merged neighborhood.
 * Non-responsibility: This module does not mutate knowledge notes, rebuild indexes, or decide whether generated facts are true.
 *
 * LLMワークフロー向けに、タスクと関連する範囲制限済みKnowledge Graphコンテキストを構築します。
 * 責務: 検索語の導出、正規ノートからの最新インメモリグラフ構築、簡潔な近傍結果の統合を担当します。
 * 非責務: Knowledgeノートの変更、索引再構築、生成された事実の真偽判定は担当しません。
 *
 * @packageDocumentation
 */
import { buildKnowledgeGraphIndex, searchKnowledgeGraph } from "#domain/knowledge/graph";
import type { Repository } from "#infra/repository/repository";
import type { KnowledgeGraphEdge, KnowledgeGraphResult, KnowledgeIndexNode } from "#shared/types";

export interface RelevantKnowledgeOptions {
  depth?: number;
  limit?: number;
}

/** Loads a compact graph neighborhood matching the supplied task-derived seeds. タスク由来の検索語に一致する簡潔なグラフ近傍を読み込みます。 */
export async function loadRelevantKnowledge(
  repo: Repository,
  seeds: unknown[],
  options: RelevantKnowledgeOptions = {},
): Promise<KnowledgeGraphResult> {
  const depth = Math.max(0, Math.min(2, options.depth ?? 1));
  const limit = Math.max(1, Math.min(30, options.limit ?? 12));
  const index = buildKnowledgeGraphIndex(await repo.loadKnowledgeNotes());
  if (index.nodes.length === 0) return emptyResult(depth, limit);

  const terms = knowledgeSearchTerms(seeds);
  if (terms.length === 0) return emptyResult(depth, limit);
  const nodes = new Map<string, KnowledgeIndexNode>();
  const edges = new Map<string, KnowledgeGraphEdge>();
  let truncated = false;
  for (const query of terms) {
    const result = searchKnowledgeGraph(index, { query, depth, limit });
    truncated ||= result.truncated;
    for (const node of result.nodes) {
      if (nodes.size >= limit && !nodes.has(node.id)) continue;
      nodes.set(node.id, node);
    }
    for (const edge of result.edges) edges.set(edgeKey(edge), edge);
    if (nodes.size >= limit) break;
  }
  const selected = new Set(nodes.keys());
  return {
    query: terms.join(" | "),
    depth,
    limit,
    truncated,
    nodes: [...nodes.values()],
    edges: [...edges.values()].filter((edge) => selected.has(edge.source_id) && selected.has(edge.target_id)),
  };
}

function knowledgeSearchTerms(seeds: unknown[]): string[] {
  const values = seeds.flatMap(stringSeeds);
  const terms: string[] = [];
  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    terms.push(normalized.slice(0, 160));
    terms.push(
      ...normalized
        .split(/[\s/／,，、:：()（）[\]【】]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
        .slice(0, 6),
    );
  }
  return [...new Set(terms)].slice(0, 16);
}

function stringSeeds(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringSeeds);
  return [];
}

function emptyResult(depth: number, limit: number): KnowledgeGraphResult {
  return { depth, limit, truncated: false, nodes: [], edges: [] };
}

function edgeKey(edge: KnowledgeGraphEdge): string {
  return `${edge.source_id}\u0000${edge.type}\u0000${edge.target_id}\u0000${edge.label ?? ""}`;
}
