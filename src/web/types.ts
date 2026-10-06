/**
 * Defines transport-neutral contracts shared by the Web monitor application and HTTP adapter.
 * Webモニターのapplication層とHTTPアダプターで共有する転送方式非依存の契約を定義します。
 *
 * @remarks
 * This module contains type contracts only and does not load data or render the user interface.
 * このモジュールは型契約だけを保持し、データ読込やUI描画は担当しません。
 *
 * @packageDocumentation
 */
import type { OperationalDateRange } from "#shared/date";
import type { AgentUpdate, Task, TaskStatus } from "#shared/types";
import type { ReportActivitySyncState } from "#domain/reports/activitySync";

/** Runtime options for the Web monitor server. Webモニターサーバの実行時オプションです。 */
export interface WebServerOptions {
  host: string;
  port: number;
  allowRemote: boolean;
  token?: string;
}

/** Aggregated data returned to the audit dashboard. 監査ダッシュボードへ返す集約データです。 */
export interface OverviewModel {
  root: string;
  date: string;
  today: string;
  operational_range: OperationalDateRange;
  counts: Record<TaskStatus, number>;
  tasks: Task[];
  dates: {
    inputs: string[];
    activities: string[];
    reports: string[];
    report_summaries: string[];
    memory_summaries: string[];
    agent_updates: string[];
  };
  global_memory: unknown;
  report_summary: unknown;
  memory_summaries: unknown;
  agent_updates: unknown;
  user_situation: unknown;
  unresolved_agent_updates: Array<{ date: string; update: AgentUpdate }>;
  morning_brief: MorningBriefDocument;
  morning_task_progress: Record<string, MorningTaskProgress>;
  task_last_updated: Record<string, string>;
  report_sync: ReportActivitySyncState;
}

/** Progress assessment for one task in a briefing. ブリーフィング内の1タスクに対する進捗評価です。 */
export interface MorningTaskProgress {
  status: TaskStatus;
  updated_on_date: boolean;
  completed: boolean;
  alignment_state?: MorningProgressState;
  assessment?: string;
  evidence?: string[];
  checked_at?: string;
}

/** Supported alignment states for briefing progress. ブリーフィング進捗で利用する整合状態です。 */
export type MorningProgressState = "not_started" | "in_progress" | "aligned" | "completed" | "waiting" | "blocked";

/** Persisted AI progress assessment for a briefing date. ブリーフィング日付ごとに保存するAI進捗評価です。 */
export interface MorningProgressDocument {
  date: string;
  checked_at: string;
  items: Array<{
    task_id: string;
    state: MorningProgressState;
    assessment: string;
    evidence: string[];
  }>;
}

/** Tabular content embedded in a briefing section. ブリーフィング項目に含まれる表形式データです。 */
export interface MorningBriefTable {
  headers: string[];
  rows: string[][];
}

/** One numbered section of a briefing document. ブリーフィング文書の番号付き項目です。 */
export interface MorningBriefSection {
  number: number;
  title: string;
  available: boolean;
  preview?: string;
  items: string[];
  paragraphs: string[];
  table?: MorningBriefTable;
}

/** Parsed briefing document exposed to Web clients. Webクライアントへ公開する解析済みブリーフィング文書です。 */
export interface MorningBriefDocument {
  date: string;
  title: string;
  available: boolean;
  sections: MorningBriefSection[];
}

/** AI-generated actionable sections appended to a briefing. ブリーフィングへ追加するAI生成の実行項目です。 */
export interface GeneratedMorningTaskSections {
  attention: string[];
  task_table: Array<{
    priority: string;
    task_id: string;
    task_name: string;
    today_action: string;
    today_goal: string;
  }>;
  recommendation: string;
}
