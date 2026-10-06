/**
 * Registers the public task-independent Knowledge Graph MCP tools.
 * Responsibility: This module owns public tool names and schemas while delegating domain behavior, usage-audit
 * retrieval, and LLM promotion.
 * Non-responsibility: This module does not implement persistence, graph validation, provider selection, or Web UI behavior.
 *
 * 公開タスク非依存Knowledge Graph MCPツールを登録します。
 * 責務: 公開ツール名とスキーマを担当し、ドメイン処理、利用監査取得、LLM昇格を委譲します。
 * 非責務: このモジュールは、永続化、グラフ検証、Provider選択、Web UI処理を実装しません。
 *
 * @packageDocumentation
 */

import * as z from "zod/v4";
import {
  getKnowledgeNote,
  rebuildKnowledgeGraph,
  searchKnowledge,
  upsertKnowledgeNote,
} from "#domain/knowledge/actions";
import { KNOWLEDGE_NODE_TYPES, KNOWLEDGE_RELATION_TYPES } from "#domain/knowledge/validation";
import { getKnowledgeUsageSummary, recordKnowledgeUsage } from "#infra/audit/knowledgeUsage";
import { jsonText } from "#mcp/protocol/result";
import type { ToolRegistrationContext } from "#mcp/tools/context";

export const knowledgeEvidenceSchema = z.object({
  statement: z.string().min(1),
  rationale: z.string().min(1),
  applicability: z.string().min(1).optional(),
  limitations: z.string().min(1).optional(),
});

export const knowledgeRelationSchema = z.object({
  type: z.enum(KNOWLEDGE_RELATION_TYPES),
  target_id: z.string(),
  label: z.string().optional(),
});

const knowledgeSelectionGuidance =
  "Store only domain knowledge reusable across multiple tasks: the note must remain meaningful after removing the originating task name and date, and must explain why the claim holds, where it applies, and relevant limitations. Do not store dated work, progress, transient observations, or one-task state here; use Activity or Task Memory. Do not store user-wide preferences or operating rules here; use Global Memory. If the content cannot be generalized beyond one task, do not create a Knowledge note.";

/** Complete validated input for one canonical Knowledge note. 1件の正規Knowledgeノート用の完全な検証済み入力です。 */
export const knowledgeNoteInputSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(KNOWLEDGE_NODE_TYPES),
  aliases: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  summary: z.string().min(1),
  evidence: z.array(knowledgeEvidenceSchema).min(1),
  relations: z.array(knowledgeRelationSchema).default([]),
  body: z.string().min(1),
});

/** LLM workflow required by explicit Task Memory promotion. 明示的Task Memory昇格に必要なLLMワークフローです。 */
export interface KnowledgeToolWorkflows {
  promote(input: { taskId: string; maxNotes: number; maxTokens: number }): Promise<unknown>;
}

/** Registers public Knowledge Graph and usage-audit tools. 公開Knowledge Graphおよび利用監査ツールを登録します。 */
export function registerKnowledgeTools(
  { server, repo, config }: ToolRegistrationContext,
  workflows: KnowledgeToolWorkflows,
): void {
  server.registerTool(
    "knowledge_search_graph",
    {
      description:
        "Search self-contained, task-independent reusable knowledge by text, node type, tags, and embedded evidence, then return a bounded graph neighborhood. Call this before planning, making a decision, recommending an approach, designing a solution, or drafting content when reusable domain knowledge may be relevant. Follow useful matches with knowledge_get_note and apply their evidence, applicability, and limitations.",
      inputSchema: z.object({
        query: z.string().optional(),
        type: z.enum(KNOWLEDGE_NODE_TYPES).optional(),
        tags: z.array(z.string()).default([]),
        depth: z.number().int().min(0).max(3).default(1),
        limit: z.number().int().positive().max(100).default(25),
      }),
    },
    async (input) => {
      const knowledge = await searchKnowledge(repo, input);
      await recordKnowledgeUsage(repo, config, {
        workflow: "knowledge_search_graph",
        stage: "delivered_to_client",
        contexts: [{ knowledge }],
      }).catch((error: unknown) => console.error("Failed to write Knowledge usage log:", error));
      return jsonText(knowledge);
    },
  );

  server.registerTool(
    "knowledge_get_note",
    {
      description:
        "Get one canonical self-contained Knowledge Markdown note, its embedded evidence, and a bounded neighborhood around it. Use this after knowledge_search_graph and consider the note's rationale, applicability, and limitations instead of relying only on its title or summary.",
      inputSchema: z.object({
        id: z.string(),
        depth: z.number().int().min(0).max(3).default(1),
        limit: z.number().int().positive().max(100).default(25),
      }),
    },
    async ({ id, depth, limit }) => {
      const result = await getKnowledgeNote(repo, id, depth, limit);
      await recordKnowledgeUsage(repo, config, {
        workflow: "knowledge_get_note",
        stage: "delivered_to_client",
        contexts: [{ knowledge: result.graph }],
      }).catch((error: unknown) => console.error("Failed to write Knowledge usage log:", error));
      return jsonText(result);
    },
  );

  server.registerTool(
    "knowledge_get_usage",
    {
      description:
        "Audit whether Knowledge is accumulated, delivered to AI clients, or injected into internal LLM prompts. Returns storage and usage counts plus note IDs used for retrieval; prompts, note bodies, evidence text, and generated output are never logged. injected_to_llm proves prompt inclusion, not that the model semantically followed the note.",
      inputSchema: z.object({
        days: z.number().int().positive().max(365).default(30),
        limit: z.number().int().positive().max(200).default(50),
      }),
      annotations: {
        title: "Audit Knowledge Usage",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => jsonText(await getKnowledgeUsageSummary(repo, input)),
  );

  server.registerTool(
    "knowledge_upsert_note",
    {
      description: `Create or completely update one self-contained, task-independent Markdown knowledge note. ${knowledgeSelectionGuidance} Put reusable claims, rationale, applicability, and limitations only in structured evidence; do not duplicate an Evidence or 根拠 section in body. Never use task ids, activity ids, local paths, URLs, or external references as a substitute for evidence. Relations are complete outgoing edges and must target existing notes.`,
      inputSchema: knowledgeNoteInputSchema,
    },
    async (input) => jsonText(await upsertKnowledgeNote(repo, input)),
  );

  server.registerTool(
    "knowledge_promote_task_memory",
    {
      description: `Explicitly generalize already-consolidated durable Task Memory into self-contained task-independent Knowledge notes. ${knowledgeSelectionGuidance} Return no notes when no content qualifies. Every note embeds its reusable claim and rationale; local paths and source references are never stored. Activity is never sent or promoted.`,
      annotations: {
        title: "Promote Task Memory to Knowledge",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: z.object({
        task_id: z.string(),
        allow_llm_data_sharing: z.literal(true),
        max_notes: z.number().int().positive().max(10).default(3),
        max_tokens: z.number().int().positive().max(8000).default(2400),
      }),
    },
    async ({ task_id, max_notes, max_tokens }) =>
      jsonText(await workflows.promote({ taskId: task_id, maxNotes: max_notes, maxTokens: max_tokens })),
  );

  server.registerTool(
    "knowledge_rebuild_graph",
    {
      description:
        "Validate all canonical Knowledge Markdown notes and atomically rebuild the derived graph-index.json file.",
      inputSchema: z.object({}),
    },
    async () => jsonText(await rebuildKnowledgeGraph(repo)),
  );
}
