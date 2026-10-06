import { describe, expect, it, vi } from "vitest";
import { createTicket, listTickets, updateTicket, ticketBoard } from "#domain/tickets/service";
import { appendActivityEntry } from "#domain/activities/actions";
import { prepareWork } from "#app/workPreparation";
import { buildTextReportTasks } from "#domain/reports/render/data";
import { compactTaskSummary } from "#domain/reports/render/policy";
import { createTempRepo } from "./helpers.ts";
const fields = { title: "Independent work", acceptance: [{ text: "Tests pass", done: false }] };
const date = "2026-09-13";
async function setup() {
  const { repo, config } = await createTempRepo();
  await repo.saveTasks(
    {
      tasks: [
        { id: "parent", title: "Parent", status: "inProgress" },
        { id: "other", title: "Other" },
      ],
    },
    "seed",
  );
  return { repo, config };
}
describe("tickets", () => {
  it("rolls back the registry if the Activity write fails", async () => {
    const { repo } = await setup();
    const before = await repo.loadTasks();
    const failure = vi.spyOn(repo, "saveActivity").mockRejectedValueOnce(new Error("disk failure"));
    await expect(createTicket(repo, "parent", "rollback", fields, date)).rejects.toThrow("disk failure");
    failure.mockRestore();
    expect(await listTickets(repo, "parent")).toEqual([]);
    expect(await repo.loadTasks()).toEqual(before);
  });
  it("is additive, idempotent, revision protected and records parent report progress", async () => {
    const { repo } = await setup();
    expect(await listTickets(repo, "parent")).toEqual([]);
    const ticket = await createTicket(repo, "parent", "key", fields, date);
    expect(await createTicket(repo, "parent", "key", fields, date)).toEqual(ticket);
    await expect(createTicket(repo, "parent", "key", { ...fields, title: "Different" })).rejects.toThrow("conflict");
    const claims = await Promise.allSettled(
      ["A", "B"].map((name) =>
        updateTicket(repo, "parent", ticket.ticket_id, 1, { status: "inProgress", assignee: { name } }, date),
      ),
    );
    expect(claims.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    let current = (await listTickets(repo, "parent"))[0];
    await expect(updateTicket(repo, "parent", ticket.ticket_id, current.revision, { status: "done" })).rejects.toThrow(
      "Completion requires",
    );
    current = await updateTicket(
      repo,
      "parent",
      ticket.ticket_id,
      current.revision,
      { status: "done", acceptance: [{ text: "Tests pass", done: true }], evidence: ["test results"] },
      date,
    );
    expect(current.completed_at).toBeTruthy();
    expect(await updateTicket(repo, "parent", ticket.ticket_id, current.revision, { status: "done" }, date)).toEqual(
      current,
    );
    await expect(updateTicket(repo, "parent", ticket.ticket_id, current.revision, { status: "todo" })).rejects.toThrow(
      "Invalid",
    );
    expect((await repo.loadTasks()).tasks).toHaveLength(2);
    expect((await repo.loadActivity(date)).entries).toHaveLength(3);
    const models = await buildTextReportTasks(repo, date);
    expect(models).toHaveLength(2);
    expect(compactTaskSummary(models.find((t) => t.id === "parent")!)[0]).toContain("1/1完了");
    expect((await buildTextReportTasks(repo, "2026-09-12")).some((t) => t.ticket_progress)).toBe(false);
  });
  it("validates dependencies, cycles, parent identity and activity links", async () => {
    const { repo } = await setup();
    await expect(createTicket(repo, "missing", "key", fields)).rejects.toThrow("Parent");
    const a = await createTicket(repo, "parent", "a", fields);
    const b = await createTicket(repo, "parent", "b", { ...fields, depends_on: [a.ticket_id] });
    await expect(updateTicket(repo, "parent", b.ticket_id, 1, { status: "inProgress" })).rejects.toThrow(
      "not complete",
    );
    await expect(updateTicket(repo, "parent", a.ticket_id, 1, { depends_on: [b.ticket_id] })).rejects.toThrow("cycle");
    await expect(updateTicket(repo, "parent", a.ticket_id, 1, { status: "blocked" })).rejects.toThrow("Stop reason");
    await updateTicket(repo, "parent", a.ticket_id, 1, { status: "blocked", stop_reason: "Awaiting access" });
    await expect(
      appendActivityEntry(repo, date, { task_id: "other", ticket_id: a.ticket_id, done: ["bad"] }),
    ).rejects.toThrow("does not belong");
    await appendActivityEntry(repo, date, { task_id: "parent", ticket_id: a.ticket_id, done: ["checkpoint"] });
    const prepared = await prepareWork(repo, {
      taskId: "parent",
      query: "work",
      date,
      lookbackDays: 7,
      knowledgeDepth: 0,
      knowledgeLimit: 5,
      includeContextBody: false,
    });
    expect(prepared.open_tickets).toEqual(
      expect.arrayContaining([expect.objectContaining({ ticket_id: a.ticket_id, stop_reason: "Awaiting access" })]),
    );
    expect((await ticketBoard(repo)).every((t) => t.parent_title === "Parent")).toBe(true);
  });
  it("discards obsolete work with a reason, excludes it from active progress, and restores it", async () => {
    const { repo } = await setup();
    const obsolete = await createTicket(repo, "parent", "obsolete", fields, date);
    const active = await createTicket(repo, "parent", "active", { ...fields, title: "Active work" }, date);

    await expect(
      updateTicket(repo, "parent", obsolete.ticket_id, obsolete.revision, { status: "discarded" }, date),
    ).rejects.toThrow("Discard reason is required");
    const discarded = await updateTicket(
      repo,
      "parent",
      obsolete.ticket_id,
      obsolete.revision,
      { status: "discarded", discard_reason: "Requirement was replaced by the active ticket" },
      date,
    );
    expect(discarded).toMatchObject({
      status: "discarded",
      discard_reason: "Requirement was replaced by the active ticket",
    });
    const prepared = await prepareWork(repo, {
      taskId: "parent",
      query: "work",
      date,
      lookbackDays: 7,
      knowledgeDepth: 0,
      knowledgeLimit: 5,
      includeContextBody: false,
    });
    expect(prepared.open_tickets?.map((ticket) => ticket.ticket_id)).toEqual([active.ticket_id]);
    const activity = await repo.loadActivity(date);
    expect(activity.entries.at(-1)).toMatchObject({
      ticket_id: obsolete.ticket_id,
      ticket_progress: "小チケット: 0/1完了、進行中0、外部待ち0、ブロック0",
    });
    expect(activity.entries.at(-1)?.notes).toContain(
      "Independent work: 廃棄 (Requirement was replaced by the active ticket)",
    );
    expect(activity.entries.at(-1)?.next).toBeUndefined();
    await expect(
      updateTicket(repo, "parent", obsolete.ticket_id, obsolete.revision, { status: "todo" }, date),
    ).rejects.toThrow("revision conflict");
    const restored = await updateTicket(
      repo,
      "parent",
      obsolete.ticket_id,
      discarded.revision,
      { status: "todo" },
      date,
    );
    expect(restored.status).toBe("todo");
    expect(restored.discard_reason).toBeUndefined();
  });
});
