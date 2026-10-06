import { expect, it } from "vitest";
import { ticketHistory } from "#domain/tickets/detail";
import { createTicket } from "#domain/tickets/service";
import { getUsageGuide } from "#app/usageGuide";
import { createTempRepo } from "./helpers.ts";

it("returns only matching parent/ticket journal entries, newest first, with bounded output", async () => {
  const { repo } = await createTempRepo();
  await repo.saveTasks(
    {
      tasks: [
        { id: "parent", title: "Parent" },
        { id: "other", title: "Other" },
      ],
    },
    "seed",
  );
  const ticket = await createTicket(repo, "parent", "history", { title: "Work", acceptance: [{ text: "Verified" }] });
  await repo.saveActivity(
    "2026-09-13",
    {
      date: "2026-09-13",
      entries: [
        { task_id: "other", ticket_id: ticket.ticket_id, done: ["Wrong parent"] },
        { task_id: "parent", done: ["No ticket"] },
        { task_id: "parent", ticket_id: ticket.ticket_id, done: ["Old"] },
      ],
    },
    "seed",
  );
  await repo.saveActivity(
    "2026-09-14",
    {
      date: "2026-09-14",
      entries: [
        {
          task_id: "parent",
          ticket_id: ticket.ticket_id,
          occurred_at: "2026-09-14T10:00:00Z",
          done: ["Latest"],
          notes: ["Discarded because the requirement was superseded"],
          private_field: "Hidden",
        },
      ],
    },
    "seed",
  );
  const result = await ticketHistory(repo, "parent", ticket.ticket_id);
  expect(result?.history.map((item) => item.done)).toEqual([["Latest"], ["Old"]]);
  expect(result?.history[0]?.notes).toEqual(["Discarded because the requirement was superseded"]);
  expect(JSON.stringify(result)).not.toContain("Hidden");
  expect(await ticketHistory(repo, "other", ticket.ticket_id)).toBeNull();
  await repo.saveActivity(
    "2026-09-15",
    {
      date: "2026-09-15",
      entries: Array.from({ length: 201 }, () => ({ task_id: "parent", ticket_id: ticket.ticket_id, done: ["More"] })),
    },
    "seed",
  );
  const bounded = await ticketHistory(repo, "parent", ticket.ticket_id);
  expect(bounded?.truncated).toBe(true);
  expect(bounded?.history).toHaveLength(200);
});

it("documents sender todo / worker start as the canonical handoff policy", () => {
  const guide = getUsageGuide().split("## Small work tickets")[1].split("## Data flow")[0];
  expect(guide).toContain("sender creates a ticket in todo");
  expect(guide).toContain("Receipt alone leaves it todo");
  expect(guide).toContain("receiving worker read the latest revision and call ticket_start_item");
  expect(guide).toContain("single commands and conversation are not ticketed");
});
