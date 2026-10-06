/**
 * Defines shared user-situation contracts.
 * Responsibility: This module owns source references, situation items, and the assembled user situation view.
 * Non-responsibility: This module does not own situation analysis, task mutation, or agent update resolution.
 *
 * 共通のユーザー状況契約を定義します。
 * 責務: このモジュールは、情報源参照、状況項目、集約されたユーザー状況ビューを担当します。
 * 非責務: このモジュールは、状況分析、タスク変更、エージェント更新の解決を担当しません。
 *
 * @packageDocumentation
 */

import type { AgentUpdate } from "#shared/types/agentUpdate";
import type { GlobalMemoryDocument } from "#shared/types/memory";
import type { Task } from "#shared/types/task";

/**
 * Defines a source reference used to support situation output.
 *
 * 状況出力の根拠として使用する情報源への参照を定義します。
 */
export interface SourceRef {
  task_id?: string;
  path?: string;
  date?: string;
  section?: string;
}

/**
 * Defines one evidence-backed item in a user situation.
 *
 * ユーザー状況に含まれる根拠付きの1項目を定義します。
 */
export interface SituationItem {
  task_id?: string;
  title?: string;
  text: string;
  source_refs: SourceRef[];
}

/** A reason why one active task needs handoff attention. アクティブタスクの引き継ぎ確認が必要な理由です。 */
export type HandoffAttentionReason =
  | "overdue"
  | "missing_compact_summary"
  | "no_recent_activity"
  | "missing_next_action"
  | "missing_task_memory"
  | "missing_decision";

/** One bounded handoff-health warning for an active task. アクティブタスク1件の引き継ぎ健全性に関する警告です。 */
export interface HandoffAttentionItem {
  task_id: string;
  title: string;
  status?: Task["status"];
  due?: string | null;
  latest_activity_date?: string;
  reasons: HandoffAttentionReason[];
  source_refs: SourceRef[];
}

/** Coverage and attention summary for cross-conversation handoff. 会話をまたぐ引き継ぎの充足状況です。 */
export interface HandoffHealth {
  active_count: number;
  with_compact_summary_count: number;
  with_recent_activity_count: number;
  with_next_action_count: number;
  with_task_memory_count: number;
  with_decision_count: number;
  overdue_count: number;
  attention_count: number;
  attention: HandoffAttentionItem[];
}

/**
 * Defines the assembled view of a user's current task situation.
 *
 * ユーザーの現在のタスク状況を集約したビューを定義します。
 */
export interface UserSituation {
  date: string;
  summary: string;
  active_tasks: Task[];
  waiting_or_blocked: Task[];
  recent_done: SituationItem[];
  next_actions: SituationItem[];
  decisions: SituationItem[];
  confirmations: SituationItem[];
  pending_agent_updates: AgentUpdate[];
  global_memory: GlobalMemoryDocument;
  context_notes: SituationItem[];
  handoff_health: HandoffHealth;
  source_refs: SourceRef[];
}
