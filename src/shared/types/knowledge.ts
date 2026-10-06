/**
 * Defines task-independent Knowledge Graph contracts.
 * Responsibility: This module owns canonical note, embedded evidence, relation, index, and bounded graph result shapes.
 * Non-responsibility: This module does not parse Markdown, validate graph integrity, persist files, or invoke an LLM.
 *
 * タスク非依存Knowledge Graphの契約を定義します。
 * 責務: このモジュールは、正規ノート、内包された根拠、関係、索引、および範囲制限されたグラフ結果の形式を担当します。
 * 非責務: このモジュールは、Markdown解析、グラフ整合性検証、ファイル永続化、LLM呼び出しを担当しません。
 *
 * @packageDocumentation
 */

/** Supported semantic categories for knowledge nodes. Knowledgeノードでサポートする意味カテゴリです。 */
export type KnowledgeNodeType =
  "concept" | "system" | "technology" | "organization" | "person" | "decision" | "document";

/** Supported directed relation types between knowledge nodes. Knowledgeノード間でサポートする有向関係種別です。 */
export type KnowledgeRelationType =
  | "uses"
  | "depends_on"
  | "replaces"
  | "related_to"
  | "owned_by"
  | "documented_by"
  | "derived_from"
  | "supports"
  | "applies_to";

/** Stores self-contained evidence for one reusable knowledge claim. 再利用可能な知識の主張を支える自己完結した根拠を保持します。 */
export interface KnowledgeEvidence {
  statement: string;
  rationale: string;
  applicability?: string;
  limitations?: string;
}

/** Defines one complete outgoing edge owned by a knowledge note. Knowledgeノートが所有する完全な出辺を定義します。 */
export interface KnowledgeRelation {
  type: KnowledgeRelationType;
  target_id: string;
  label?: string;
}

/** Defines the canonical Markdown-backed knowledge note. Markdownを正本とするKnowledgeノートを定義します。 */
export interface KnowledgeNote {
  id: string;
  title: string;
  type: KnowledgeNodeType;
  aliases: string[];
  tags: string[];
  summary: string;
  evidence: KnowledgeEvidence[];
  relations: KnowledgeRelation[];
  created_at: string;
  updated_at: string;
  body: string;
}

/** Defines the compact node representation stored in the rebuildable graph index. 再構築可能なグラフ索引に保存する簡潔なノード表現です。 */
export type KnowledgeIndexNode = Omit<KnowledgeNote, "body" | "relations">;

/** Defines one indexed graph edge with its source node made explicit. 始点ノードを明示した索引済みグラフ辺です。 */
export interface KnowledgeGraphEdge extends KnowledgeRelation {
  source_id: string;
}

/** Defines the derived graph index rebuilt exclusively from canonical notes. 正規ノートのみから再構築される派生グラフ索引です。 */
export interface KnowledgeGraphIndex {
  version: 2;
  generated_at: string;
  nodes: KnowledgeIndexNode[];
  edges: KnowledgeGraphEdge[];
}

/** Defines a bounded search result suitable for MCP and Web consumers. MCPおよびWeb利用者向けの範囲制限された検索結果です。 */
export interface KnowledgeGraphResult {
  query?: string;
  depth: number;
  limit: number;
  truncated: boolean;
  nodes: KnowledgeIndexNode[];
  edges: KnowledgeGraphEdge[];
}
