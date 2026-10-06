/**
 * Prepares bounded Personal Context MCP context for an AI client before substantive work begins.
 * Responsibility: This module assembles cross-task situation, durable memory, optional task context,
 * and relevant reusable Knowledge into one read-only response.
 * Non-responsibility: This module does not mutate task data, infer an LLM query, or generate user-facing content.
 *
 * AIクライアントが実作業を始める前に、範囲制限されたPersonal Context MCPコンテキストを準備します。
 * 責務: 横断状況、永続メモリ、任意のタスクコンテキスト、関連する再利用可能Knowledgeを、
 * 1つの読み取り専用レスポンスへまとめます。
 * 非責務: タスクデータの変更、LLM検索語の推論、ユーザー向け文章の生成は行いません。
 *
 * @packageDocumentation
 */

import { getUserSituation } from "#app/situation";
import { searchKnowledge } from "#domain/knowledge/actions";
import { isTaskDeleted } from "#domain/tasks/state";
import type { Repository } from "#infra/repository/repository";
import { buildKnowledgeGraphIndex } from "#domain/knowledge/graph";
import { listTickets } from "#domain/tickets/service";

/** Input accepted by the work-preparation use case. 作業準備ユースケースの入力です。 */
export interface PrepareWorkInput {
  date: string;
  query: string;
  taskId?: string;
  lookbackDays: number;
  knowledgeDepth: number;
  knowledgeLimit: number;
  includeContextBody: boolean;
  scope?: "strict" | "global";
  includeGlobalSituation?: boolean;
  includeGlobalMemory?: boolean;
  knowledgeIds?: string[];
}

/**
 * Assembles the initial context an AI needs for planning, decisions, recommendations, design, or drafting.
 *
 * 計画、判断、提案、設計、文章作成に必要な初期コンテキストを組み立てます。
 */
export async function prepareWork(repo: Repository, input: PrepareWorkInput) {
  const strict = (input.scope ?? (input.taskId ? "strict" : "global")) === "strict";
  if (strict && !input.taskId) throw new Error("scope=strict requires task_id");
  if (strict && input.includeGlobalSituation) throw new Error("Global situation requires scope=global");
  const globalSituation = !strict && input.includeGlobalSituation === true;
  const [situation, knowledge, tasksDoc] = await Promise.all([
    globalSituation || input.taskId
      ? getUserSituation(repo, input.date, input.lookbackDays, input.taskId, {
          ...(!globalSituation ? { taskId: input.taskId! } : {}),
          includeGlobalMemory: input.includeGlobalMemory === true,
        })
      : Promise.resolve(undefined),
    strict
      ? repo.loadKnowledgeNotes().then((notes) => {
          const ids = new Set(input.knowledgeIds ?? []);
          const index = buildKnowledgeGraphIndex(notes);
          const nodes = index.nodes.filter((node) => ids.has(node.id)).slice(0, input.knowledgeLimit);
          const selected = new Set(nodes.map((node) => node.id));
          return {
            query: input.query,
            depth: 0,
            limit: input.knowledgeLimit,
            truncated: ids.size > nodes.length,
            nodes,
            edges: index.edges.filter((edge) => selected.has(edge.source_id) && selected.has(edge.target_id)),
          };
        })
      : searchKnowledge(repo, {
          query: input.query,
          depth: input.knowledgeDepth,
          limit: input.knowledgeLimit,
        }),
    input.taskId ? repo.loadTasks() : Promise.resolve(undefined),
  ]);

  let taskContext: unknown;
  if (input.taskId) {
    const task = tasksDoc?.tasks.find((candidate) => candidate.id === input.taskId);
    if (!task || isTaskDeleted(task)) throw new Error(`Task not found: ${input.taskId}`);
    const [context, memory] = await Promise.all([repo.loadTaskContext(task), repo.loadTaskMemory(task.id)]);
    taskContext = {
      task,
      context_frontmatter: context.data,
      ...(input.includeContextBody ? { context_body: context.body } : {}),
      task_memory: memory,
    };
  }

  return {
    date: input.date,
    query: input.query,
    scope: strict ? "strict" : "global",
    situation,
    ...(input.includeGlobalMemory === true ? { global_memory: await repo.loadGlobalMemory() } : {}),
    ...(taskContext ? { task_context: taskContext } : {}),
    ...(input.taskId
      ? {
          open_tickets: (await listTickets(repo, input.taskId))
            .filter((t) => !["done", "discarded"].includes(t.status))
            .slice(0, 30)
            .map((t) => ({
              ticket_id: t.ticket_id,
              title: t.title,
              status: t.status,
              revision: t.revision,
              stop_reason: t.stop_reason,
              depends_on: t.depends_on,
            })),
        }
      : {}),
    knowledge,
    source_policy:
      "Only task_context and scoped situation establish task facts. Knowledge is reusable guidance, not evidence of task requirements. Do not introduce entities or requirements absent from task sources. Related tasks must be retrieved explicitly; no same-project or keyword-based expansion is performed.",
    knowledge_usage:
      knowledge.nodes.length > 0
        ? "Use relevant nodes as reusable guidance. Consider each node's evidence, applicability, and limitations before applying it."
        : "No matching reusable Knowledge was found. Do not infer Knowledge from unrelated task history.",
  };
}
