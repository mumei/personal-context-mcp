/**
 * Provides api capabilities for the web UI layer.
 * Responsibility: This module owns the api behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * Web UI層のapi機能を提供します。
 * 責務: このモジュールは、ここで宣言するapiの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import type { ActivityEntry } from "#shared/types/activity";

/**
 * Defines the public `TaskStatus` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`TaskStatus`を定義します。
 */
export type TaskStatus = "todo" | "inProgress" | "waiting" | "blocked" | "done";

/**
 * Defines the public `Task` data contract exposed by this module.
 *
 * このモジュールが公開する`Task`データ契約を定義します。
 */
export interface Task {
  id: string;
  title: string;
  project?: string;
  status: TaskStatus;
  tier?: number;
  compact_summary?: string[];
  report_exclude?: boolean;
}

/**
 * Defines the public `MorningBriefSection` data contract exposed by this module.
 *
 * このモジュールが公開する`MorningBriefSection`データ契約を定義します。
 */
export interface MorningBriefSection {
  number: number;
  title: string;
  available: boolean;
  preview?: string;
  items: string[];
  paragraphs: string[];
  table?: { headers: string[]; rows: string[][] };
}

/**
 * Defines the public `Overview` data contract exposed by this module.
 *
 * このモジュールが公開する`Overview`データ契約を定義します。
 */
export interface Overview {
  root: string;
  date: string;
  today: string;
  counts: Record<TaskStatus, number>;
  tasks: Task[];
  task_last_updated: Record<string, string>;
  global_memory: Record<string, unknown>;
  unresolved_agent_updates: Array<{ date: string; update: Record<string, unknown> }>;
  morning_brief: { available: boolean; sections: MorningBriefSection[] };
  morning_task_progress: Record<string, Record<string, unknown>>;
}

/**
 * Defines the public `TaskDetail` data contract exposed by this module.
 *
 * このモジュールが公開する`TaskDetail`データ契約を定義します。
 */
export interface TaskDetail {
  task: Task;
  context: { body?: string; data?: Record<string, unknown> };
  context_body_html?: string;
  memory?: Record<string, unknown>;
  activity?: { entries?: Array<Record<string, unknown>> };
  latest_activity?: ActivityEntry;
  latest_activity_date?: string;
  latest_next_activity?: ActivityEntry;
  latest_next_activity_date?: string;
  current_status?: { summary: string[]; risks: string[]; next: string[] };
  operational_range?: { label?: string };
}

/** One immutable Activity event projected for calendar display. カレンダー表示用に投影された不変Activityイベントです。 */
export interface ActivityCalendarEvent {
  id: string;
  operational_date: string;
  occurred_at?: string;
  recorded_at?: string;
  started_at?: string;
  ended_at?: string;
  task_id: string;
  project: string;
  title: string;
  status?: string;
  summary: string;
  done: string[];
  next: string[];
}

/** Activity calendar API response for one bounded date range. 期間を限定したActivityカレンダーAPIレスポンスです。 */
export interface ActivityCalendarResponse {
  from: string;
  to: string;
  timezone: string;
  rollover_hour: number;
  events: ActivityCalendarEvent[];
  daily_counts: Record<string, number>;
  projects: string[];
}

/**
 * Defines the public `ReportOutputs` data contract exposed by this module.
 *
 * このモジュールが公開する`ReportOutputs`データ契約を定義します。
 */
export interface ReportOutputs {
  date?: string;
  sync?: {
    date: string;
    pending_count: number;
    tasks: Array<{
      task_id: string;
      title: string;
      manual_override: boolean;
      pending_activity_count: number;
      total_activity_count: number;
      last_generated_at?: string;
    }>;
  };
  text?: { text?: string } | string;
  markdown?: { text?: string; html?: string } | string;
}

/**
 * Describes one durable, task-independent knowledge note shown in the graph audit UI.
 *
 * グラフ監査UIに表示する、タスクに依存しない永続的な知識ノートを表します。
 */
export interface KnowledgeNode {
  id: string;
  title: string;
  type: string;
  summary?: string;
  tags?: string[];
  aliases?: string[];
  body_html?: string;
  evidence?: Array<{
    statement: string;
    rationale: string;
    applicability?: string;
    limitations?: string;
  }>;
  created_at?: string;
  updated_at?: string;
}

/**
 * Describes a typed relationship between two knowledge notes.
 *
 * 2つの知識ノート間にある型付きの関係を表します。
 */
export interface KnowledgeEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string;
}

/**
 * Describes an integrity or freshness warning reported by the knowledge index.
 *
 * Knowledge索引が報告する整合性または鮮度の警告を表します。
 */
export interface KnowledgeWarning {
  code: string;
  message: string;
  node_id?: string;
}

/**
 * Defines the complete read-only graph response returned by the Knowledge API.
 *
 * Knowledge APIが返す読み取り専用グラフレスポンス全体を定義します。
 */
export interface KnowledgeGraphResponse {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  warnings: KnowledgeWarning[];
  stats: { nodes: number; edges: number; orphans: number };
}

/**
 * Defines the selected-note response, including its bounded neighborhood.
 *
 * 選択したノートと範囲制限された近傍グラフを含むレスポンスを定義します。
 */
export interface KnowledgeNoteResponse {
  note?: KnowledgeNode;
  graph?: KnowledgeGraphResponse;
  nodes?: KnowledgeNode[];
  edges?: KnowledgeEdge[];
  warnings?: KnowledgeWarning[];
  stats?: { nodes: number; edges: number; orphans: number };
}

/** One privacy-bounded record showing Knowledge delivery or LLM prompt injection. Knowledgeの返却またはLLM入力への注入を示す、内容を含まない監査記録です。 */
export interface KnowledgeUsageEvent {
  timestamp: string;
  workflow: string;
  stage: "delivered_to_client" | "injected_to_llm";
  date?: string;
  task_ids: string[];
  matched_count: number;
  injected_count: number;
  knowledge_ids: string[];
  knowledge_by_task: Array<{ task_id: string; knowledge_ids: string[] }>;
  provider?: string;
  model?: string;
}

/** Aggregated proof of recent Knowledge retrieval and LLM injection. 最近のKnowledge検索・LLM注入証跡の集計です。 */
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

export interface PersonFact {
  id: string;
  category: string;
  value: string;
  basis: "confirmed" | "observed" | "inferred";
  sensitivity: "private" | "sensitive";
  confidence?: number;
  source_note?: string;
  updated_at: string;
}

export interface PersonProfile {
  id: string;
  display_name: string;
  aliases: string[];
  organizations: Array<{ name: string; role?: string; department?: string }>;
  contacts: Array<{ type: string; value: string; label?: string; sensitivity: "private" | "sensitive" }>;
  roles: string[];
  relationship_type?: string;
  relationship_status: "active" | "inactive";
  preferred_channels: string[];
  languages: string[];
  timezone?: string;
  facts: PersonFact[];
  notes: string[];
  created_at: string;
  updated_at: string;
  deleted?: boolean;
  merged_into?: string;
  merged_at?: string;
  merged_from?: string[];
}

export interface PersonRelationship {
  id: string;
  from_person_id: string;
  to_person_id: string;
  type: string;
  label?: string;
  status: "active" | "inactive";
  notes: string[];
  created_at: string;
  updated_at: string;
}

export interface PersonInteraction {
  interaction_id: string;
  person_ids: string[];
  occurred_at: string;
  recorded_at: string;
  channel?: string;
  summary: string;
  outcomes: string[];
  follow_ups: string[];
  task_ids: string[];
  sensitivity: "private" | "sensitive";
}

export interface PeopleListResponse {
  count: number;
  profiles: PersonProfile[];
}

export interface PersonDetailResponse {
  profile: PersonProfile;
  relationships: PersonRelationship[];
  interactions: PersonInteraction[];
}
