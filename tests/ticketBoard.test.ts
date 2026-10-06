import { describe, expect, it } from "vitest";
import type { BoardTicket } from "#webUi/composables/useTickets";
import { compareTicketsByRecency, ticketParentColorKey, ticketParentStyle } from "#webUi/utils/ticketBoard";

function ticket(ticketId: string, taskId: string, updatedAt: string): BoardTicket {
  return {
    ticket_id: ticketId,
    task_id: taskId,
    title: ticketId,
    description: "",
    parent_title: taskId,
    project: "Project",
    status: "todo",
    acceptance: [],
    priority: 1,
    order: 0,
    depends_on: [],
    evidence: [],
    revision: 1,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

describe("ticket board presentation", () => {
  it("derives the same parent colors from the same task ID", () => {
    expect(ticketParentColorKey("parent-a")).toBe(ticketParentColorKey("parent-a"));
    expect(ticketParentStyle("parent-a")).toEqual(ticketParentStyle("parent-a"));
  });

  it("derives distinguishable stable colors from different task IDs", () => {
    expect(ticketParentColorKey("parent-a")).not.toBe(ticketParentColorKey("parent-b"));
    expect(ticketParentStyle("parent-a")).not.toEqual(ticketParentStyle("parent-b"));
  });

  it("sorts by newest update and uses task and ticket IDs as stable tie breakers", () => {
    const sorted = [
      ticket("b", "parent-b", "2026-09-19T10:00:00Z"),
      ticket("b", "parent-a", "2026-09-20T10:00:00Z"),
      ticket("a", "parent-a", "2026-09-20T10:00:00Z"),
      ticket("invalid", "parent-a", "invalid"),
    ].sort(compareTicketsByRecency);

    expect(sorted.map((item) => item.ticket_id)).toEqual(["a", "b", "b", "invalid"]);
  });
});
