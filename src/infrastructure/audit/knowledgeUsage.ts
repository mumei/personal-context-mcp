/**
 * Records and summarizes privacy-bounded Knowledge usage evidence.
 * Responsibility: This module records which Knowledge note IDs were delivered to an AI client or injected into an
 * internal LLM workflow, without storing prompts, note bodies, evidence text, or generated output.
 * Non-responsibility: It does not search Knowledge, invoke an LLM, or claim that an LLM semantically followed a note.
 *
 * プライバシーを制限したKnowledge利用証跡を記録・集計します。
 * 責務: prompt、ノート本文、根拠文、生成結果を保存せず、AIクライアントへ返却または内部LLMへ注入した
 * KnowledgeノートIDを記録します。
 * 非責務: Knowledge検索、LLM呼び出し、LLMがノート内容に意味的に従ったという判定は行いません。
 *
 * @packageDocumentation
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeRequestLog } from "#infra/audit/requestLog";
import type { Repository } from "#infra/repository/repository";
import type { KnowledgeGraphResult, TaskMcpConfig } from "#shared/types";

export type KnowledgeUsageStage = "delivered_to_client" | "injected_to_llm";

export interface KnowledgeUsageContext {
  task_id?: string;
  knowledge: KnowledgeGraphResult;
}

export interface KnowledgeUsageInput {
  workflow: string;
  stage: KnowledgeUsageStage;
  date?: string;
  contexts: KnowledgeUsageContext[];
  provider?: string;
  model?: string;
}

export interface KnowledgeUsageEvent {
  timestamp: string;
  workflow: string;
  stage: KnowledgeUsageStage;
  date?: string;
  task_ids: string[];
  matched_count: number;
  injected_count: number;
  knowledge_ids: string[];
  knowledge_by_task: Array<{ task_id: string; knowledge_ids: string[] }>;
  provider?: string;
  model?: string;
}

export interface KnowledgeUsageSummary {
  stored_note_count: number;
  accumulation_event_count: number;
  accumulated_note_write_count: number;
  last_accumulated_at?: string;
  event_count: number;
  matched_event_count: number;
  injected_event_count: number;
  injected_note_count: number;
  last_injected_at?: string;
  workflows: Record<
    string,
    { event_count: number; matched_event_count: number; injected_event_count: number; injected_note_count: number }
  >;
  recent_events: KnowledgeUsageEvent[];
}

function usageEvent(input: KnowledgeUsageInput, timestamp: string): KnowledgeUsageEvent {
  const knowledgeIds = [
    ...new Set(input.contexts.flatMap(({ knowledge }) => knowledge.nodes.map((node) => node.id))),
  ].sort();
  const taskIds = [...new Set(input.contexts.flatMap(({ task_id }) => (task_id ? [task_id] : [])))].sort();
  return {
    timestamp,
    workflow: input.workflow,
    stage: input.stage,
    ...(input.date ? { date: input.date } : {}),
    task_ids: taskIds,
    matched_count: knowledgeIds.length,
    injected_count: input.stage === "injected_to_llm" ? knowledgeIds.length : 0,
    knowledge_ids: knowledgeIds,
    knowledge_by_task: input.contexts
      .filter((context): context is KnowledgeUsageContext & { task_id: string } => Boolean(context.task_id))
      .map((context) => ({
        task_id: context.task_id,
        knowledge_ids: [...new Set(context.knowledge.nodes.map((node) => node.id))].sort(),
      })),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
  };
}

/** Records one successful Knowledge delivery or LLM injection event. Knowledge返却またはLLM注入の成功を1件記録します。 */
export async function recordKnowledgeUsage(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone">,
  input: KnowledgeUsageInput,
): Promise<KnowledgeUsageEvent> {
  const timestamp = new Date().toISOString();
  const event = usageEvent(input, timestamp);
  await writeRequestLog(repo, config, {
    tool: "knowledge_usage",
    status: "ok",
    duration_ms: 0,
    arguments_summary: {
      workflow: event.workflow,
      stage: event.stage,
      date: event.date,
      task_ids: event.task_ids,
      provider: event.provider,
      model: event.model,
    },
    result_summary: {
      matched_count: event.matched_count,
      injected_count: event.injected_count,
      knowledge_ids: event.knowledge_ids,
      knowledge_by_task: event.knowledge_by_task,
    },
  });
  return event;
}

function parseEvent(value: unknown): KnowledgeUsageEvent | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (entry.tool !== "knowledge_usage" || entry.status !== "ok" || typeof entry.timestamp !== "string") return null;
  const args = entry.arguments_summary as Record<string, unknown> | undefined;
  const result = entry.result_summary as Record<string, unknown> | undefined;
  if (!args || !result || typeof args.workflow !== "string") return null;
  const stage = args.stage;
  if (stage !== "delivered_to_client" && stage !== "injected_to_llm") return null;
  return {
    timestamp: entry.timestamp,
    workflow: args.workflow,
    stage,
    ...(typeof args.date === "string" ? { date: args.date } : {}),
    task_ids: Array.isArray(args.task_ids)
      ? args.task_ids.filter((item): item is string => typeof item === "string")
      : [],
    matched_count: typeof result.matched_count === "number" ? result.matched_count : 0,
    injected_count: typeof result.injected_count === "number" ? result.injected_count : 0,
    knowledge_ids: Array.isArray(result.knowledge_ids)
      ? result.knowledge_ids.filter((item): item is string => typeof item === "string")
      : [],
    knowledge_by_task: Array.isArray(result.knowledge_by_task)
      ? result.knowledge_by_task.filter(
          (item): item is { task_id: string; knowledge_ids: string[] } =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as { task_id?: unknown }).task_id === "string" &&
            Array.isArray((item as { knowledge_ids?: unknown }).knowledge_ids),
        )
      : [],
    ...(typeof args.provider === "string" ? { provider: args.provider } : {}),
    ...(typeof args.model === "string" ? { model: args.model } : {}),
  };
}

/** Summarizes recent Knowledge usage events from local request logs. ローカルrequest logから最近のKnowledge利用を集計します。 */
export async function getKnowledgeUsageSummary(
  repo: Repository,
  options: { days?: number; limit?: number } = {},
): Promise<KnowledgeUsageSummary> {
  const days = Math.max(1, Math.min(365, options.days ?? 30));
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const root = repo.layoutPath("requestLogs");
  let names: string[] = [];
  try {
    names = (await readdir(root))
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort()
      .slice(-days);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const events: KnowledgeUsageEvent[] = [];
  let accumulationEventCount = 0;
  let accumulatedNoteWriteCount = 0;
  let lastAccumulatedAt: string | undefined;
  for (const name of names) {
    const text = await readFile(join(root, name), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const event = parseEvent(parsed);
        if (event) events.push(event);
        if (parsed.status === "ok" && typeof parsed.timestamp === "string") {
          const result = (parsed.result_summary ?? {}) as Record<string, unknown>;
          const created = typeof result.knowledge_created_count === "number" ? result.knowledge_created_count : 0;
          const updated = typeof result.knowledge_updated_count === "number" ? result.knowledge_updated_count : 0;
          const promoted = typeof result.notes_count === "number" ? result.notes_count : 0;
          const directUpsert = parsed.tool === "knowledge_upsert_note" ? 1 : 0;
          const writes = created + updated + promoted + directUpsert;
          if (writes > 0) {
            accumulationEventCount += 1;
            accumulatedNoteWriteCount += writes;
            lastAccumulatedAt = parsed.timestamp;
          }
        }
      } catch {
        // Ignore malformed historical audit lines and continue with valid records.
      }
    }
  }
  events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const workflows: KnowledgeUsageSummary["workflows"] = {};
  for (const event of events) {
    const workflow = (workflows[event.workflow] ??= {
      event_count: 0,
      matched_event_count: 0,
      injected_event_count: 0,
      injected_note_count: 0,
    });
    workflow.event_count += 1;
    if (event.matched_count > 0) workflow.matched_event_count += 1;
    if (event.stage === "injected_to_llm") {
      workflow.injected_event_count += 1;
      workflow.injected_note_count += event.injected_count;
    }
  }
  const injected = events.filter((event) => event.stage === "injected_to_llm");
  const storedNotes = await repo.loadKnowledgeNotes();
  return {
    stored_note_count: storedNotes.length,
    accumulation_event_count: accumulationEventCount,
    accumulated_note_write_count: accumulatedNoteWriteCount,
    ...(lastAccumulatedAt ? { last_accumulated_at: lastAccumulatedAt } : {}),
    event_count: events.length,
    matched_event_count: events.filter((event) => event.matched_count > 0).length,
    injected_event_count: injected.length,
    injected_note_count: injected.reduce((sum, event) => sum + event.injected_count, 0),
    ...(injected.at(-1) ? { last_injected_at: injected.at(-1)?.timestamp } : {}),
    workflows,
    recent_events: events.slice(-limit).reverse(),
  };
}
