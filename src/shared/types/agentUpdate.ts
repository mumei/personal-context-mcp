/**
 * Defines shared agent-update domain contracts.
 * Responsibility: This module owns agent update states, confidence levels, update records, and dated update documents.
 * Non-responsibility: This module does not own update ingestion, review decisions, or application workflows.
 *
 * 共通のエージェント更新ドメイン契約を定義します。
 * 責務: このモジュールは、エージェント更新の状態、信頼度、更新レコード、日付付き更新文書を担当します。
 * 非責務: このモジュールは、更新の取り込み、レビュー判断、適用ワークフローを担当しません。
 *
 * @packageDocumentation
 */

import type { TaskStatus } from "#shared/types/task";

/**
 * Defines confidence levels available to an agent update.
 *
 * エージェント更新で利用できる信頼度を定義します。
 */
export type Confidence = "low" | "medium" | "high";

/**
 * Defines review and application states available to an agent update.
 *
 * エージェント更新で利用できるレビューおよび適用状態を定義します。
 */
export type AgentUpdateStatus = "pending" | "applied" | "rejected" | "needs_review";

/**
 * Defines one update received from an agent session.
 *
 * エージェントセッションから受信した1件の更新を定義します。
 */
export interface AgentUpdate {
  update_id: string;
  session_id: string;
  source: string;
  status: AgentUpdateStatus;
  received_at: string;
  summary: string;
  task_id?: string;
  project?: string;
  title?: string;
  done?: string[];
  next?: string[];
  confirm?: string[];
  status_suggestion?: TaskStatus;
  context_updates?: string[];
  sources?: string[];
  confidence?: Confidence;
  occurred_at?: string;
  applied_at?: string;
  applied_to?: string[];
  warnings?: string[];
  [key: string]: unknown;
}

/**
 * Defines a dated collection of agent updates.
 *
 * 日付に紐づくエージェント更新のコレクションを定義します。
 */
export interface AgentUpdatesDocument {
  date: string;
  updates: AgentUpdate[];
  [key: string]: unknown;
}
