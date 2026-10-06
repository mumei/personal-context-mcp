/** Reads ticket-linked journal entries without exposing other tasks or persistence metadata.
 * チケットに紐づく履歴を読み取り、別タスクや保存内部メタデータは公開しません。
 * @packageDocumentation */
import type { Repository } from "#infra/repository/repository";
import type { TicketHistoryEntry } from "#shared/types/ticket";
import { listTickets } from "#domain/tickets/service";

export async function ticketHistory(repo: Repository, taskId: string, ticketId: string) {
  if (!(await listTickets(repo, taskId)).some((ticket) => ticket.ticket_id === ticketId)) return null;
  const history: TicketHistoryEntry[] = [];
  const dates = (await repo.listYamlDates(repo.layoutName("activities"))).sort().reverse();
  for (const date of dates) {
    const entries = (await repo.loadActivity(date)).entries
      .filter((entry) => entry.task_id === taskId && entry.ticket_id === ticketId)
      .sort((a, b) => (b.occurred_at ?? b.recorded_at ?? "").localeCompare(a.occurred_at ?? a.recorded_at ?? ""));
    for (const entry of entries) {
      history.push({
        date,
        activity_id: entry.activity_id,
        occurred_at: entry.occurred_at ?? entry.recorded_at,
        done: entry.done ?? [],
        next: entry.next ?? [],
        notes: [
          ...(entry.notes ?? []),
          ...(entry.confirm ?? []),
          ...(entry.external_summary ?? []),
          ...(entry.compact_summary ?? []),
        ],
        sources: entry.sources ?? [],
      });
      if (history.length > 200) return { history: history.slice(0, 200), truncated: true };
    }
  }
  return { history, truncated: false };
}
