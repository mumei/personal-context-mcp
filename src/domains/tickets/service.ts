/**
 * Owns parent-scoped ticket persistence, optimistic concurrency and lifecycle rules.
 * Uses repository transactions/backups; never creates top-level tasks or modifies memory.
 * 親タスク配下の小チケットの保存・競合制御・状態遷移を担当します。
 * Repositoryのトランザクションとバックアップを利用し、TaskやMemoryは変更しません。
 * @packageDocumentation
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Repository } from "#infra/repository/repository";
import { isTaskDeleted } from "#domain/tasks/state";

export const ticketStatus = z.enum(["todo", "inProgress", "waiting", "blocked", "discarded", "done"]);
const text = z.string().trim().min(1).max(4000);
export const ticketFields = z.object({
  title: text,
  description: z.string().max(20000).default(""),
  acceptance: z
    .array(z.object({ text, done: z.boolean().default(false) }))
    .min(1)
    .max(50),
  priority: z.number().int().min(1).max(5).default(3),
  order: z.number().int().min(0).default(0),
  depends_on: z.array(z.string().uuid()).max(50).default([]),
  assignee: z.object({ name: text, thread_id: z.string().max(200).optional() }).optional(),
  evidence: z.array(text).max(100).default([]),
});
const ticketSchema = ticketFields.extend({
  ticket_id: z.string().uuid(),
  task_id: text,
  status: ticketStatus,
  revision: z.number().int().positive(),
  created_at: text,
  updated_at: text,
  completed_at: text.optional(),
  stop_reason: text.optional(),
  discard_reason: text.optional(),
  idempotency_key: text,
  creation_payload: z.string(),
});
export type Ticket = z.infer<typeof ticketSchema>;
const documentSchema = z.object({ version: z.literal(1), tickets: z.array(ticketSchema) });
export const ticketPatch = z
  .object({
    title: text.optional(),
    description: z.string().max(20000).optional(),
    acceptance: ticketFields.shape.acceptance.optional(),
    priority: z.number().int().min(1).max(5).optional(),
    order: z.number().int().min(0).optional(),
    depends_on: z.array(z.string().uuid()).max(50).optional(),
    assignee: ticketFields.shape.assignee,
    evidence: z.array(text).max(100).optional(),
    status: ticketStatus.optional(),
    stop_reason: text.nullable().optional(),
    discard_reason: text.nullable().optional(),
  })
  .strict();

async function load(repo: Repository) {
  return documentSchema.parse(await repo.loadYaml({ version: 1, tickets: [] }, repo.layoutName("tickets")));
}
async function parent(repo: Repository, id: string) {
  const task = (await repo.loadTasks()).tasks.find((task) => task.id === id);
  if (!task || isTaskDeleted(task)) throw new Error("Parent task not found");
  return task;
}
function publicTicket({ creation_payload: _payload, idempotency_key: _key, ...ticket }: Ticket) {
  return ticket;
}

/** Lists only one parent's tickets in deterministic priority/order sequence.
 * 1親タスクのチケットのみを優先度・表示順で取得します。 */
export async function listTickets(repo: Repository, taskId: string) {
  await parent(repo, taskId);
  return (await load(repo)).tickets
    .filter((t) => t.task_id === taskId)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.order - b.order ||
        a.created_at.localeCompare(b.created_at) ||
        a.ticket_id.localeCompare(b.ticket_id),
    )
    .map(publicTicket);
}

/** Reads the cross-task board; deleted parents are excluded. 削除済み親を除外した横断ボードを取得します。 */
export async function ticketBoard(repo: Repository) {
  const tasks = (await repo.loadTasks()).tasks.filter((t) => !isTaskDeleted(t));
  return (await load(repo)).tickets.flatMap((ticket) => {
    const task = tasks.find((t) => t.id === ticket.task_id);
    return task ? [{ ...publicTicket(ticket), parent_title: task.title, project: task.project ?? "" }] : [];
  });
}

async function record(repo: Repository, ticket: Ticket, all: Ticket[], date?: string) {
  if (!date) return;
  const doc = await repo.loadActivity(date);
  const siblings = all.filter((t) => t.task_id === ticket.task_id && t.status !== "discarded");
  const summary = `小チケット: ${siblings.filter((t) => t.status === "done").length}/${siblings.length}完了、進行中${siblings.filter((t) => t.status === "inProgress").length}、外部待ち${siblings.filter((t) => t.status === "waiting").length}、ブロック${siblings.filter((t) => t.status === "blocked").length}`;
  const statusReason = ticket.status === "discarded" ? ticket.discard_reason : ticket.stop_reason;
  doc.entries.push({
    activity_id: randomUUID(),
    task_id: ticket.task_id,
    ticket_id: ticket.ticket_id,
    occurred_at: ticket.updated_at,
    recorded_at: ticket.updated_at,
    ticket_progress: summary,
    ...(ticket.status === "done"
      ? { done: [`${ticket.title}: 完了`], sources: ticket.evidence }
      : ticket.status === "discarded"
        ? { notes: [`${ticket.title}: 廃棄 (${ticket.discard_reason})`] }
        : { next: [`${ticket.title}: ${ticket.status}${statusReason ? ` (${statusReason})` : ""}`] }),
  });
  await repo.saveActivity(date, doc, "ticket-progress");
}

function validate(ticket: Ticket, all: Ticket[]) {
  if (new Set(ticket.depends_on).size !== ticket.depends_on.length) throw new Error("Duplicate dependencies");
  for (const id of ticket.depends_on) {
    const dependency = all.find((t) => t.ticket_id === id && t.task_id === ticket.task_id);
    if (!dependency || id === ticket.ticket_id) throw new Error("Invalid dependency for parent task");
    const visited = new Set<string>();
    const walk = (current: Ticket): boolean => {
      if (current.ticket_id === ticket.ticket_id) return true;
      if (visited.has(current.ticket_id)) return false;
      visited.add(current.ticket_id);
      return current.depends_on.some((next) => {
        const node = all.find((t) => t.ticket_id === next);
        return node ? walk(node) : false;
      });
    };
    if (walk(dependency)) throw new Error("Dependency cycle");
    if (["inProgress", "done"].includes(ticket.status) && dependency.status !== "done")
      throw new Error("Dependency is not complete");
  }
  if (["waiting", "blocked"].includes(ticket.status) && !ticket.stop_reason) throw new Error("Stop reason is required");
  if (ticket.status === "discarded" && !ticket.discard_reason) throw new Error("Discard reason is required");
  if (ticket.status === "done" && (!ticket.acceptance.every((item) => item.done) || !ticket.evidence.length))
    throw new Error("Completion requires all acceptance criteria and evidence");
}

/** Creates a ticket once per parent/idempotency key; conflicting retries fail.
 * 親と冪等キー単位で作成し、内容の違う再試行は拒否します。 */
export async function createTicket(
  repo: Repository,
  taskId: string,
  key: string,
  raw: z.input<typeof ticketFields>,
  date?: string,
) {
  const fields = ticketFields.parse(raw);
  text.parse(key);
  return repo.withTransaction(async () => {
    await parent(repo, taskId);
    const doc = await load(repo);
    const payload = JSON.stringify(fields);
    const existing = doc.tickets.find((t) => t.task_id === taskId && t.idempotency_key === key);
    if (existing) {
      if (existing.creation_payload !== payload) throw new Error("Idempotency key conflict");
      return publicTicket(existing);
    }
    const now = new Date().toISOString();
    const ticket: Ticket = {
      ...fields,
      task_id: taskId,
      ticket_id: randomUUID(),
      status: "todo",
      revision: 1,
      created_at: now,
      updated_at: now,
      idempotency_key: key,
      creation_payload: payload,
    };
    validate(ticket, doc.tickets);
    doc.tickets.push(ticket);
    await repo.saveYaml(repo.layoutPath("tickets"), doc, "ticket-create");
    await record(repo, ticket, doc.tickets, date);
    return publicTicket(ticket);
  });
}

const transitions: Record<Ticket["status"], Ticket["status"][]> = {
  todo: ["inProgress", "waiting", "blocked", "discarded"],
  inProgress: ["waiting", "blocked", "discarded", "done"],
  waiting: ["todo", "inProgress", "blocked", "discarded"],
  blocked: ["todo", "inProgress", "waiting", "discarded"],
  discarded: ["todo", "inProgress", "waiting", "blocked"],
  done: [],
};

/** Updates with a required revision; terminal tickets cannot be reopened accidentally.
 * 必須の版番号で競合を検出し、完了済みチケットの意図しない再開を防ぎます。 */
export async function updateTicket(
  repo: Repository,
  taskId: string,
  id: string,
  revision: number,
  raw: z.input<typeof ticketPatch>,
  date?: string,
) {
  const patch = ticketPatch.parse(raw);
  return repo.withTransaction(async () => {
    await parent(repo, taskId);
    const doc = await load(repo);
    const index = doc.tickets.findIndex((t) => t.ticket_id === id && t.task_id === taskId);
    const previous = doc.tickets[index];
    if (!previous) throw new Error("Ticket not found");
    if (previous.revision !== revision) throw new Error("Ticket revision conflict; reload before retry");
    if (
      previous.status === "inProgress" &&
      patch.assignee &&
      JSON.stringify(patch.assignee) !== JSON.stringify(previous.assignee)
    )
      throw new Error("Ticket already claimed; pause before reassignment");
    if (patch.status && patch.status !== previous.status && !transitions[previous.status].includes(patch.status))
      throw new Error("Invalid ticket state transition");
    const candidate = {
      ...previous,
      ...patch,
      stop_reason: patch.stop_reason === null ? undefined : (patch.stop_reason ?? previous.stop_reason),
      discard_reason: patch.discard_reason === null ? undefined : (patch.discard_reason ?? previous.discard_reason),
    };
    if (!["waiting", "blocked"].includes(candidate.status)) delete candidate.stop_reason;
    if (candidate.status !== "discarded") delete candidate.discard_reason;
    if (JSON.stringify(candidate) === JSON.stringify(previous)) return publicTicket(previous);
    if (previous.status === "done") throw new Error("Completed ticket is immutable");
    const now = new Date().toISOString();
    const ticket: Ticket = {
      ...candidate,
      revision: previous.revision + 1,
      updated_at: now,
      ...(candidate.status === "done" ? { completed_at: now } : {}),
    };
    validate(ticket, doc.tickets);
    doc.tickets[index] = ticket;
    await repo.saveYaml(repo.layoutPath("tickets"), doc, "ticket-update");
    await record(repo, ticket, doc.tickets, date);
    return publicTicket(ticket);
  });
}
