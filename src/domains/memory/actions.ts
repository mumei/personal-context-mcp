/**
 * Provides actions capabilities for the domain layer.
 * Responsibility: This module owns the actions behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * domain層のactions機能を提供します。
 * 責務: このモジュールは、ここで宣言するactionsの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import { dateDaysAgo, nowIso } from "#shared/date";
import type { Repository } from "#infra/repository/repository";
import type {
  GlobalMemoryDocument,
  MemoryMindMap,
  MemoryMindMapNode,
  MemorySourceRef,
  ReportSummaryDocument,
  SaveResult,
  Task,
  TaskMemoryDocument,
} from "#shared/types";
import { isTaskDeleted } from "#domain/tasks/state";

/**
 * Defines the public `MemoryUpdateMode` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`MemoryUpdateMode`を定義します。
 */
export type MemoryUpdateMode = "replace" | "append" | "delete";

/**
 * Defines the public `UpdateTaskMemoryInput` data contract exposed by this module.
 *
 * このモジュールが公開する`UpdateTaskMemoryInput`データ契約を定義します。
 */
export interface UpdateTaskMemoryInput {
  task_id: string;
  mode: MemoryUpdateMode;
  summary?: string[];
  facts?: string[];
  decisions?: string[];
  risks?: string[];
  next?: string[];
  sources?: MemorySourceRef[];
}

/**
 * Defines the public `UpdateGlobalMemoryInput` data contract exposed by this module.
 *
 * このモジュールが公開する`UpdateGlobalMemoryInput`データ契約を定義します。
 */
export interface UpdateGlobalMemoryInput {
  mode: MemoryUpdateMode;
  summary?: string[];
  preferences?: string[];
  rules?: string[];
  sources?: MemorySourceRef[];
}

/**
 * Defines the public `UpdateReportSummaryInput` data contract exposed by this module.
 *
 * このモジュールが公開する`UpdateReportSummaryInput`データ契約を定義します。
 */
export interface UpdateReportSummaryInput {
  mode: MemoryUpdateMode;
  headline?: string;
  done?: string[];
  next?: string[];
  confirm?: string[];
  risks?: string[];
  notes?: string[];
  sources?: MemorySourceRef[];
}

/**
 * Defines the public `MemorySaveResult` data contract exposed by this module.
 *
 * このモジュールが公開する`MemorySaveResult`データ契約を定義します。
 */
export interface MemorySaveResult<T> {
  document: T;
  save: SaveResult;
}

/**
 * Defines the public `TaskMemoryPromotionInput` data contract exposed by this module.
 *
 * このモジュールが公開する`TaskMemoryPromotionInput`データ契約を定義します。
 */
export interface TaskMemoryPromotionInput {
  task_id: string;
  lookback_days?: number;
  force?: boolean;
}

/**
 * Defines the public `TaskMemoryPromotionSources` data contract exposed by this module.
 *
 * このモジュールが公開する`TaskMemoryPromotionSources`データ契約を定義します。
 */
export interface TaskMemoryPromotionSources {
  task?: Task;
  existing_memory: Omit<TaskMemoryDocument, "input_hash" | "applied_at" | "updated_at">;
  task_context: {
    path: string;
    frontmatter: Record<string, unknown>;
    body: { text: string; truncated: boolean; original_length: number };
  };
  inputs: Array<{ date: string; items: unknown[] }>;
  activities: Array<{ date: string; entries: unknown[] }>;
}

/**
 * Defines the public `TaskMemoryPromotionPromptResult` data contract exposed by this module.
 *
 * このモジュールが公開する`TaskMemoryPromotionPromptResult`データ契約を定義します。
 */
export interface TaskMemoryPromotionPromptResult {
  date: string;
  task_id: string;
  input_hash: string;
  sources: TaskMemoryPromotionSources;
  prompt?: string;
  skipped: boolean;
  skip_reason?: "duplicate_input";
}

/**
 * Defines the public `TaskMemoryPromotionOutput` data contract exposed by this module.
 *
 * このモジュールが公開する`TaskMemoryPromotionOutput`データ契約を定義します。
 */
export interface TaskMemoryPromotionOutput {
  summary?: string[];
  facts?: string[];
  decisions?: string[];
  risks?: string[];
  next?: string[];
  mindmap?: MemoryMindMap;
  sources?: MemorySourceRef[];
}

/**
 * Defines the public `ApplyTaskMemoryPromotionInput` data contract exposed by this module.
 *
 * このモジュールが公開する`ApplyTaskMemoryPromotionInput`データ契約を定義します。
 */
export interface ApplyTaskMemoryPromotionInput extends TaskMemoryPromotionOutput {
  task_id: string;
  input_hash: string;
}

const TASK_MEMORY_FIELDS = ["summary", "facts", "decisions", "risks", "next"] as const;
const TASK_MEMORY_PROMOTION_POLICY_VERSION = 2;
const MAX_MINDMAP_LABEL_LENGTH = 32;
const MAX_MINDMAP_CHILDREN = 7;
const MAX_MINDMAP_DEPTH = 6;

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Task memory promotion response did not contain a JSON object.");
  }
  return candidate.slice(start, end + 1);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map((item) => String(item).trim()).filter((item) => item.length > 0);
  return values.length > 0 ? [...new Set(values)] : undefined;
}

function sourceRefs(value: unknown): MemorySourceRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = value
    .filter(
      (item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item),
    )
    .map((item) => ({
      ...(typeof item.path === "string" ? { path: item.path } : {}),
      ...(typeof item.date === "string" ? { date: item.date } : {}),
      ...(typeof item.task_id === "string" ? { task_id: item.task_id } : {}),
      ...(typeof item.section === "string" ? { section: item.section } : {}),
    }));
  return refs.length > 0 ? normalizedSources(refs) : undefined;
}

function mindMapNode(value: unknown, depth: number): MemoryMindMapNode | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.label !== "string") return undefined;
  const label = record.label.trim().slice(0, MAX_MINDMAP_LABEL_LENGTH);
  if (!label) return undefined;
  const children =
    depth < MAX_MINDMAP_DEPTH && Array.isArray(record.children)
      ? record.children
          .map((child) => mindMapNode(child, depth + 1))
          .filter((child): child is MemoryMindMapNode => Boolean(child))
          .slice(0, MAX_MINDMAP_CHILDREN)
      : [];
  return { label, ...(children.length > 0 ? { children } : {}) };
}

/**
 * Performs the public `normalizeMemoryMindMap` operation provided by this module.
 *
 * このモジュールが提供する公開操作`normalizeMemoryMindMap`を実行します。
 */
export function normalizeMemoryMindMap(value: unknown): MemoryMindMap | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.root !== "string") return undefined;
  const root = record.root.trim().slice(0, MAX_MINDMAP_LABEL_LENGTH);
  if (!root) return undefined;
  const children = Array.isArray(record.paths)
    ? mindMapPaths(record.paths)
    : Array.isArray(record.children)
      ? record.children
          .map((child) => mindMapNode(child, 1))
          .filter((child): child is MemoryMindMapNode => Boolean(child))
          .slice(0, MAX_MINDMAP_CHILDREN)
      : [];
  return { root, children };
}

function mindMapPaths(value: unknown[]): MemoryMindMapNode[] {
  const roots: MemoryMindMapNode[] = [];
  for (const candidate of value.slice(0, 24)) {
    if (!Array.isArray(candidate)) continue;
    const labels = candidate
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, MAX_MINDMAP_LABEL_LENGTH))
      .filter(Boolean)
      .slice(0, MAX_MINDMAP_DEPTH);
    let level = roots;
    for (const label of labels) {
      let node = level.find((item) => item.label === label);
      if (!node) {
        if (level.length >= MAX_MINDMAP_CHILDREN) break;
        node = { label };
        level.push(node);
      }
      node.children ??= [];
      level = node.children;
    }
  }
  const stripEmptyChildren = (nodes: MemoryMindMapNode[]): MemoryMindMapNode[] =>
    nodes.map((node) => ({
      label: node.label,
      ...(node.children && node.children.length > 0 ? { children: stripEmptyChildren(node.children) } : {}),
    }));
  return stripEmptyChildren(roots);
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean; original_length: number } {
  if (text.length <= maxChars) return { text, truncated: false, original_length: text.length };
  return {
    text: `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`,
    truncated: true,
    original_length: text.length,
  };
}

function appendUnique(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  const merged = [...(existing ?? [])];
  for (const item of incoming ?? []) {
    if (!merged.includes(item)) merged.push(item);
  }
  return merged.length > 0 ? merged : undefined;
}

function normalizeSourceRef(source: MemorySourceRef): MemorySourceRef {
  return {
    ...(source.path !== undefined ? { path: source.path } : {}),
    ...(source.date !== undefined ? { date: source.date } : {}),
    ...(source.task_id !== undefined ? { task_id: source.task_id } : {}),
    ...(source.section !== undefined ? { section: source.section } : {}),
  };
}

function sourceKey(source: MemorySourceRef): string {
  return JSON.stringify(normalizeSourceRef(source));
}

function normalizedSources(sources: MemorySourceRef[] | undefined): MemorySourceRef[] | undefined {
  const byKey = new Map<string, MemorySourceRef>();
  for (const source of sources ?? []) {
    const normalized = normalizeSourceRef(source);
    byKey.set(sourceKey(normalized), normalized);
  }
  const result = [...byKey.values()].sort((left, right) => sourceKey(left).localeCompare(sourceKey(right)));
  return result.length > 0 ? result : undefined;
}

function appendSources(
  existing: MemorySourceRef[] | undefined,
  incoming: MemorySourceRef[] | undefined,
): MemorySourceRef[] | undefined {
  return normalizedSources([...(existing ?? []), ...(incoming ?? [])]);
}

function arrayField<T extends Record<string, unknown>>(
  doc: T,
  key: keyof T,
  values: string[] | undefined,
  mode: MemoryUpdateMode,
): void {
  if (mode === "delete") {
    delete doc[key];
    return;
  }
  if (values === undefined) return;
  doc[key] = (mode === "replace" ? values : appendUnique(doc[key] as string[] | undefined, values)) as T[keyof T];
}

function sourceField(
  doc: Record<string, unknown>,
  sources: MemorySourceRef[] | undefined,
  mode: MemoryUpdateMode,
): void {
  if (mode === "delete") {
    delete doc.sources;
    return;
  }
  if (sources === undefined) return;
  doc.sources =
    mode === "replace"
      ? normalizedSources(sources)
      : appendSources(doc.sources as MemorySourceRef[] | undefined, sources);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function promotionInputHash(sources: TaskMemoryPromotionSources): string {
  const { task, task_context, inputs, activities } = sources;
  return createHash("sha256")
    .update(
      JSON.stringify(
        stableValue({
          policy_version: TASK_MEMORY_PROMOTION_POLICY_VERSION,
          task,
          task_context,
          inputs,
          activities,
        }),
      ),
    )
    .digest("hex");
}

function taskMemoryForPrompt(
  memory: TaskMemoryDocument,
): Omit<TaskMemoryDocument, "input_hash" | "applied_at" | "updated_at"> {
  const state = { ...memory };
  delete state.input_hash;
  delete state.applied_at;
  delete state.updated_at;
  return state;
}

/**
 * Performs the public `parseTaskMemoryPromotion` operation provided by this module.
 *
 * このモジュールが提供する公開操作`parseTaskMemoryPromotion`を実行します。
 */
export function parseTaskMemoryPromotion(text: string, taskId: string): TaskMemoryPromotionOutput {
  const parsed = JSON.parse(extractJsonObject(text)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Task memory promotion response must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.task_id === "string" && record.task_id.trim().length > 0 && record.task_id.trim() !== taskId) {
    throw new Error(`Task memory promotion response is for ${record.task_id.trim()}, not ${taskId}.`);
  }
  return {
    summary: stringArray(record.summary),
    facts: stringArray(record.facts),
    decisions: stringArray(record.decisions),
    risks: stringArray(record.risks),
    next: stringArray(record.next),
    mindmap: normalizeMemoryMindMap(record.mindmap),
    sources: sourceRefs(record.sources),
  };
}

/**
 * Performs the public `updateTaskMemory` operation provided by this module.
 *
 * このモジュールが提供する公開操作`updateTaskMemory`を実行します。
 */
export async function updateTaskMemory(
  repo: Repository,
  input: UpdateTaskMemoryInput,
): Promise<MemorySaveResult<TaskMemoryDocument>> {
  return repo.withTransaction(async () => {
    const existing = await repo.loadTaskMemory(input.task_id);
    const doc: TaskMemoryDocument =
      input.mode === "replace"
        ? {
            task_id: input.task_id,
            ...(existing.input_hash ? { input_hash: existing.input_hash } : {}),
            ...(existing.applied_at ? { applied_at: existing.applied_at } : {}),
          }
        : existing;
    arrayField(doc, "summary", input.summary, input.mode);
    arrayField(doc, "facts", input.facts, input.mode);
    arrayField(doc, "decisions", input.decisions, input.mode);
    arrayField(doc, "risks", input.risks, input.mode);
    arrayField(doc, "next", input.next, input.mode);
    sourceField(doc, input.sources, input.mode);
    doc.updated_at = nowIso();
    const save = await repo.saveTaskMemory(input.task_id, doc, `${input.mode}-task-memory`);
    return { document: doc, save };
  });
}

/**
 * Performs the public `updateTaskMemoryMindMap` operation provided by this module.
 *
 * このモジュールが提供する公開操作`updateTaskMemoryMindMap`を実行します。
 */
export async function updateTaskMemoryMindMap(
  repo: Repository,
  taskId: string,
  mindmap: MemoryMindMap,
): Promise<MemorySaveResult<TaskMemoryDocument>> {
  return repo.withTransaction(async () => {
    const document = await repo.loadTaskMemory(taskId);
    document.mindmap = normalizeMemoryMindMap(mindmap);
    document.updated_at = nowIso();
    const save = await repo.saveTaskMemory(taskId, document, "update-task-memory-mindmap");
    return { document, save };
  });
}

/**
 * Performs the public `updateGlobalMemory` operation provided by this module.
 *
 * このモジュールが提供する公開操作`updateGlobalMemory`を実行します。
 */
export async function updateGlobalMemory(
  repo: Repository,
  input: UpdateGlobalMemoryInput,
): Promise<MemorySaveResult<GlobalMemoryDocument>> {
  return repo.withTransaction(async () => {
    const doc = input.mode === "replace" ? {} : await repo.loadGlobalMemory();
    arrayField(doc, "summary", input.summary, input.mode);
    arrayField(doc, "preferences", input.preferences, input.mode);
    arrayField(doc, "rules", input.rules, input.mode);
    sourceField(doc, input.sources, input.mode);
    doc.updated_at = nowIso();
    const save = await repo.saveGlobalMemory(doc, `${input.mode}-global-memory`);
    return { document: doc, save };
  });
}

/**
 * Performs the public `updateReportSummary` operation provided by this module.
 *
 * このモジュールが提供する公開操作`updateReportSummary`を実行します。
 */
export async function updateReportSummary(
  repo: Repository,
  date: string,
  input: UpdateReportSummaryInput,
): Promise<MemorySaveResult<ReportSummaryDocument>> {
  return repo.withTransaction(async () => {
    const doc = input.mode === "replace" ? { date } : await repo.loadReportSummary(date);
    if (input.mode === "delete") {
      delete doc.headline;
    } else if (input.headline !== undefined) {
      doc.headline = input.headline;
    }
    arrayField(doc, "done", input.done, input.mode);
    arrayField(doc, "next", input.next, input.mode);
    arrayField(doc, "confirm", input.confirm, input.mode);
    arrayField(doc, "risks", input.risks, input.mode);
    arrayField(doc, "notes", input.notes, input.mode);
    sourceField(doc, input.sources, input.mode);
    doc.updated_at = nowIso();
    const save = await repo.saveReportSummary(date, doc, `${input.mode}-report-summary`);
    return { document: doc, save };
  });
}

/**
 * Performs the public `buildTaskMemoryPromotionPrompt` operation provided by this module.
 *
 * このモジュールが提供する公開操作`buildTaskMemoryPromotionPrompt`を実行します。
 */
export async function buildTaskMemoryPromotionPrompt(
  repo: Repository,
  date: string,
  input: TaskMemoryPromotionInput,
): Promise<TaskMemoryPromotionPromptResult> {
  const lookbackDays = input.lookback_days ?? 7;
  const start = dateDaysAgo(date, lookbackDays);
  const maxContextBodyChars = 12000;
  const [tasks, existingMemory] = await Promise.all([repo.loadTasks(), repo.loadTaskMemory(input.task_id)]);
  const task = tasks.tasks.find((item) => item.id === input.task_id);
  if (!task || isTaskDeleted(task)) {
    throw new Error(`Task not found: ${input.task_id}`);
  }
  const [activityDates, inputDates] = await Promise.all([
    repo.listYamlDates(repo.layoutName("activities")),
    repo.listYamlDates(repo.layoutName("inputs")),
  ]);
  const relevantActivityDates = activityDates.filter((item) => item >= start && item <= date);
  const relevantInputDates = inputDates.filter((item) => item >= start && item <= date);
  const [activities, inputs, context] = await Promise.all([
    Promise.all(
      relevantActivityDates.map(async (activityDate) => {
        const activity = await repo.loadActivity(activityDate);
        return { date: activityDate, entries: activity.entries.filter((entry) => entry.task_id === input.task_id) };
      }),
    ),
    Promise.all(
      relevantInputDates.map(async (inputDate) => {
        const inputsDoc = await repo.loadInputs(inputDate);
        return { date: inputDate, items: inputsDoc.items.filter((item) => item.related_task_id === input.task_id) };
      }),
    ),
    repo.loadTaskContext(task),
  ]);
  const sources: TaskMemoryPromotionSources = {
    task,
    existing_memory: taskMemoryForPrompt(existingMemory),
    task_context: {
      path: task?.context ?? `${repo.layoutName("contexts")}/${input.task_id}.md`,
      frontmatter: context.data,
      body: truncateText(context.body, maxContextBodyChars),
    },
    inputs,
    activities,
  };
  const inputHash = promotionInputHash(sources);
  if (existingMemory.input_hash === inputHash && !input.force) {
    return {
      date,
      task_id: input.task_id,
      input_hash: inputHash,
      sources,
      skipped: true,
      skip_reason: "duplicate_input",
    };
  }
  const prompt = [
    "You promote short-term Personal Context MCP activity into durable task memory.",
    `Target task_id: ${input.task_id}`,
    "Use existing_memory as the current state, then integrate the task context, related inputs, and recent activities.",
    "Return the complete latest task-memory state, not a patch. Remove duplicate, superseded, and stale items.",
    "Keep only reusable facts, settled decisions, ongoing risks, and context needed in a future session.",
    "Never store dated work logs, one-time completion statements, monitoring snapshots, transient counts or percentages, report prose, commands, PIDs, or file paths in summary/facts/decisions/risks/next/mindmap.",
    "A date is allowed only when it is itself durable knowledge, such as a deadline, scheduled event, contract period, or historical decision date.",
    "Return one JSON object only. Allowed fields: task_id, summary, facts, decisions, risks, next, mindmap, sources.",
    "Use short de-duplicated arrays. Omit an empty field. sources may contain only source references present in the supplied data.",
    "mindmap is a compact conceptual index: {root, paths:[[level1, level2, ..., concrete_leaf], ...]}.",
    "Use meaningful 4-6 level paths when the source supports them. Group by scope, concern, subject, and state before the leaf.",
    "Every leaf must express a concrete current state, settled decision, active risk, or next action. Avoid vague labels such as 状況, 対応, 確認, or 次 without a subject or outcome.",
    "Keep labels concise Japanese phrases under 32 characters. Do not copy full memory bullets verbatim.",
    "",
    JSON.stringify(sources, null, 2),
  ].join("\n");
  return { date, task_id: input.task_id, input_hash: inputHash, sources, prompt, skipped: false };
}

/**
 * Performs the public `applyTaskMemoryPromotion` operation provided by this module.
 *
 * このモジュールが提供する公開操作`applyTaskMemoryPromotion`を実行します。
 */
export async function applyTaskMemoryPromotion(
  repo: Repository,
  input: ApplyTaskMemoryPromotionInput,
): Promise<MemorySaveResult<TaskMemoryDocument>> {
  return repo.withTransaction(async () => {
    const existing = await repo.loadTaskMemory(input.task_id);
    const document = buildPromotedTaskMemory(existing, input);
    const save = await repo.saveTaskMemory(input.task_id, document, "promote-task-memory-activity");
    return { document, save };
  });
}

/**
 * Performs the public `buildPromotedTaskMemory` operation provided by this module.
 *
 * このモジュールが提供する公開操作`buildPromotedTaskMemory`を実行します。
 */
export function buildPromotedTaskMemory(
  existing: TaskMemoryDocument,
  input: ApplyTaskMemoryPromotionInput,
): TaskMemoryDocument {
  const document: TaskMemoryDocument = { ...existing, task_id: input.task_id };
  for (const field of TASK_MEMORY_FIELDS) delete document[field];
  delete document.mindmap;
  delete document.sources;
  for (const field of TASK_MEMORY_FIELDS) {
    if (input[field]) document[field] = input[field];
  }
  if (input.mindmap) document.mindmap = normalizeMemoryMindMap(input.mindmap);
  const sources = normalizedSources(input.sources);
  if (sources) document.sources = sources;
  document.input_hash = input.input_hash;
  document.applied_at = nowIso();
  document.updated_at = document.applied_at;
  return document;
}
