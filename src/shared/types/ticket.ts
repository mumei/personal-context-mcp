/** Client-safe public ticket contract; excludes persistence-only idempotency data.
 * 保存専用の冪等データを含まない、クライアント共通の小チケット契約です。
 * @packageDocumentation */
export interface PublicTicket {
  ticket_id: string;
  task_id: string;
  title: string;
  description: string;
  status: "todo" | "inProgress" | "waiting" | "blocked" | "discarded" | "done";
  acceptance: { text: string; done: boolean }[];
  priority: number;
  order: number;
  depends_on: string[];
  assignee?: { name: string; thread_id?: string };
  evidence: string[];
  revision: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  stop_reason?: string;
  discard_reason?: string;
}

/** Public journal projection for the ticket drawer. チケット詳細用の公開履歴です。 */
export interface TicketHistoryEntry {
  date: string;
  activity_id?: string;
  occurred_at?: string;
  done: string[];
  next: string[];
  notes: string[];
  sources: string[];
}
