/**
 * Provides read-only task Current Status projection helpers.
 * Responsibility: derives display state from persisted task, context, memory, and Activity records.
 * Non-responsibility: does not write, consolidate, or otherwise mutate canonical records.
 *
 * タスクの現在状況を読み取り専用で投影する補助関数を提供します。
 * 責務: 保存済みのTask、Context、Memory、Activityから表示状態を導出します。
 * 非責務: 正本データの書き込み、統合、その他の変更は行いません。
 *
 * @packageDocumentation
 */

import type { ActivityEntry } from "#shared/types/activity";

/** Represents one Activity together with its immutable operational date. Activityと格納先の運用日を表します。 */
export interface DatedActivityEntry {
  entry: ActivityEntry;
  operational_date: string;
  order: number;
}

/** Persisted sources used for the display projection. 表示用の投影で参照する保存済み情報です。 */
export interface CurrentStatusInput {
  task_compact_summary?: unknown;
  context_compact_summary?: unknown;
  memory?: Record<string, unknown>;
  latest_activity?: ActivityEntry;
  latest_activity_date?: string;
  latest_next_activity?: ActivityEntry;
  latest_next_activity_date?: string;
}

/** Display-only status, separate from durable Memory. 永続Memoryから分離した表示専用の状況です。 */
export interface CurrentStatus {
  summary: string[];
  risks: string[];
  next: string[];
}

/** Converts display lists to normalized, unique, non-blank lines. 表示リストを空白除去・重複排除した行へ変換します。 */
export function textList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [
    ...new Set(
      values
        .filter((item): item is string => typeof item === "string")
        .map(normalizeText)
        .filter(Boolean),
    ),
  ];
}

/** Finds the newest dated Activity, preferring valid event timestamps over document date/order. 有効なイベント時刻を優先して最新の日時付きActivityを探します。 */
export function latestDatedActivity(entries: DatedActivityEntry[]): DatedActivityEntry | undefined {
  return entries.reduce<DatedActivityEntry | undefined>((latest, candidate) => {
    if (!latest || compareActivities(candidate, latest) > 0) return candidate;
    return latest;
  }, undefined);
}

/** Finds the newest Activity that explicitly supplied `next`, including an explicit empty list. 明示的な空配列を含め、`next`を指定した最新Activityを探します。 */
export function latestDatedNextActivity(entries: DatedActivityEntry[]): DatedActivityEntry | undefined {
  return latestDatedActivity(entries.filter((candidate) => Object.hasOwn(candidate.entry, "next")));
}

/** Projects display-only current status without mutating task, memory, or Activity data. Task、Memory、Activityを変更せず表示専用の現在状況を投影します。 */
export function deriveCurrentStatus(input: CurrentStatusInput): CurrentStatus {
  const memory = input.memory ?? {};
  const summary = firstNonempty(
    input.task_compact_summary,
    input.context_compact_summary,
    memory.summary,
    input.latest_activity?.compact_summary,
  );
  const nextActivity = input.latest_next_activity ?? input.latest_activity;
  const next = chooseNext(nextActivity, input.latest_next_activity_date ?? input.latest_activity_date, memory);
  return { summary, risks: textList(memory.risks), next };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstNonempty(...values: unknown[]): string[] {
  for (const value of values) {
    const normalized = textList(value);
    if (normalized.length > 0) return normalized;
  }
  return [];
}

function chooseNext(
  activity: ActivityEntry | undefined,
  activityDate: string | undefined,
  memory: Record<string, unknown>,
): string[] {
  if (!activity || !Object.hasOwn(activity, "next")) return textList(memory.next);
  if (!Object.hasOwn(memory, "next")) return textList(activity.next);
  const activityTime = activityTimestamp(activity) ?? parseTimestamp(activityDate);
  const memoryTime = parseTimestamp(memory.updated_at);
  if (memoryTime !== undefined && (activityTime === undefined || memoryTime > activityTime))
    return textList(memory.next);
  return textList(activity.next);
}

function compareActivities(left: DatedActivityEntry, right: DatedActivityEntry): number {
  const leftTime = activityTimestamp(left.entry) ?? parseTimestamp(left.operational_date) ?? Number.NEGATIVE_INFINITY;
  const rightTime =
    activityTimestamp(right.entry) ?? parseTimestamp(right.operational_date) ?? Number.NEGATIVE_INFINITY;
  return (
    leftTime - rightTime || left.operational_date.localeCompare(right.operational_date) || left.order - right.order
  );
}

function activityTimestamp(entry: ActivityEntry): number | undefined {
  return parseTimestamp(entry.occurred_at) ?? parseTimestamp(entry.recorded_at);
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}
