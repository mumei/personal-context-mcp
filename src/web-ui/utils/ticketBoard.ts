/**
 * Provides deterministic presentation rules for the ticket board.
 * 作業ボード向けの決定的な表示ルールを提供します。
 *
 * @packageDocumentation
 */
import type { BoardTicket } from "#webUi/composables/useTickets";

export type TicketParentStyle = {
  "--ticket-parent-accent": string;
  "--ticket-parent-border": string;
  "--ticket-parent-surface": string;
};

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Returns a stable hue identifier derived only from the parent task ID. */
export function ticketParentColorKey(taskId: string): number {
  return stableHash(taskId) % 360;
}

/** Returns subtle card colors that preserve the board's text and status colors. */
export function ticketParentStyle(taskId: string): TicketParentStyle {
  const hue = ticketParentColorKey(taskId);
  return {
    "--ticket-parent-accent": `hsl(${hue} 42% 42%)`,
    "--ticket-parent-border": `hsl(${hue} 28% 76%)`,
    "--ticket-parent-surface": `hsl(${hue} 38% 97%)`,
  };
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** Sorts newest updates first and uses stable identity fields for equal timestamps. */
export function compareTicketsByRecency(a: BoardTicket, b: BoardTicket): number {
  return (
    timestamp(b.updated_at) - timestamp(a.updated_at) ||
    a.task_id.localeCompare(b.task_id) ||
    a.ticket_id.localeCompare(b.ticket_id)
  );
}
