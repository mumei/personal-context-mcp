/**
 * Adapts canonical Knowledge Graph domain results for the read-only Web audit interface.
 * Responsibility: This module owns Web edge identifiers, graph statistics, and Markdown note rendering.
 * Non-responsibility: This module does not persist notes, search the graph, or mutate Knowledge data.
 *
 * 正規Knowledge Graphのドメイン結果を、読み取り専用Web監査画面向けに変換します。
 * 責務: このモジュールは、Web用の辺ID、グラフ統計、およびMarkdownノート表示を担当します。
 * 非責務: このモジュールは、ノートの永続化、グラフ検索、Knowledgeデータの更新を担当しません。
 *
 * @packageDocumentation
 */

import type { KnowledgeGraphResult, KnowledgeNote } from "#shared/types";
import { renderMarkdownBody } from "#web/markdown";

/** Read-only graph shape consumed by the Vue audit page. Vue監査画面が使用する読み取り専用グラフ形式です。 */
export interface KnowledgeGraphView {
  nodes: Array<KnowledgeGraphResult["nodes"][number] & { body_html?: string }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    label?: string;
  }>;
  warnings: Array<{ code: string; message: string; node_id?: string }>;
  stats: { nodes: number; edges: number; orphans: number };
}

/** Converts a bounded domain graph into a stable Web audit response. 範囲制限付きドメイングラフを安定したWeb監査レスポンスへ変換します。 */
export function knowledgeGraphView(graph: KnowledgeGraphResult, selectedNote?: KnowledgeNote): KnowledgeGraphView {
  const nodes = graph.nodes.map((node) =>
    selectedNote?.id === node.id ? { ...node, body_html: renderMarkdownBody(selectedNote.body) } : node,
  );
  const edges = graph.edges.map((edge, index) => ({
    id: `${edge.source_id}:${edge.type}:${edge.target_id}:${index}`,
    source: edge.source_id,
    target: edge.target_id,
    type: edge.type,
    ...(edge.label ? { label: edge.label } : {}),
  }));
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  return {
    nodes,
    edges,
    warnings: graph.truncated
      ? [{ code: "result_truncated", message: `表示上限${graph.limit}件までの部分グラフです。` }]
      : [],
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      orphans: nodes.filter((node) => !connected.has(node.id)).length,
    },
  };
}
