/** Exposes parent-scoped ticket operations without creating top-level tasks.
 * 親タスク配下の小チケット操作を公開し、トップレベルTaskは作成しません。
 * @packageDocumentation */
import { z } from "zod";
import { createTicket, listTickets, updateTicket, ticketFields, ticketPatch } from "#domain/tickets/service";
import type { ToolRegistrationContext } from "#mcp/tools/context";
import { jsonText } from "#mcp/protocol/result";
import { resolveDate } from "#shared/date";

export function registerTicketTools({ server, repo, config }: ToolRegistrationContext) {
  const identity = { task_id: z.string(), ticket_id: z.string().uuid() };
  server.registerTool(
    "ticket_create_item",
    {
      description:
        "Create an independently completable work ticket under an existing task. Before delegating substantial work, create it in todo and pass it to the worker without starting it. The worker calls ticket_start_item only at actual work start. Never ticket every utterance or command. Choose IDs internally; do not ask the user for them. Reuse idempotency_key for retries.",
      inputSchema: ticketFields.extend({ task_id: z.string(), idempotency_key: z.string().min(1) }),
    },
    async ({ task_id, idempotency_key, ...fields }) =>
      jsonText(await createTicket(repo, task_id, idempotency_key, fields, resolveDate(undefined, config))),
  );
  server.registerTool(
    "ticket_list_items",
    {
      description: "List a parent's tickets. Existing Codex tasks may handle multiple tickets sequentially.",
      inputSchema: z.object({ task_id: z.string() }),
    },
    async ({ task_id }) => jsonText({ tickets: await listTickets(repo, task_id) }),
  );
  server.registerTool(
    "ticket_get_item",
    { description: "Read a ticket and its revision before updating.", inputSchema: z.object(identity) },
    async ({ task_id, ticket_id }) => {
      const ticket = (await listTickets(repo, task_id)).find((t) => t.ticket_id === ticket_id);
      if (!ticket) throw new Error("Ticket not found");
      return jsonText(ticket);
    },
  );
  server.registerTool(
    "ticket_update_item",
    {
      description:
        "Update ticket fields/order or lifecycle with optimistic revision. waiting means an external response, dependency, or date is expected before work resumes; blocked means a concrete obstruction prevents progress. Both require stop_reason. Use discarded with discard_reason only when duplicate, superseded, or no longer needed work will not be done. Discarded tickets remain auditable and may be restored to todo/inProgress; they are not physically deleted. Done requires checked acceptance and evidence. Completed tickets are immutable.",
      inputSchema: z.object({ ...identity, revision: z.number().int().positive(), patch: ticketPatch }),
    },
    async ({ task_id, ticket_id, revision, patch }) =>
      jsonText(await updateTicket(repo, task_id, ticket_id, revision, patch, resolveDate(undefined, config))),
  );
  server.registerTool(
    "ticket_start_item",
    {
      description:
        "The receiving worker calls this only when actually starting work, with the latest revision and its own human-readable assignee. Receipt alone leaves a delegated ticket in todo; the sender must not start it on the worker's behalf. A stale competing claim is rejected.",
      inputSchema: z.object({
        ...identity,
        revision: z.number().int().positive(),
        assignee: z.object({ name: z.string().min(1), thread_id: z.string().optional() }),
      }),
    },
    async ({ task_id, ticket_id, revision, assignee }) =>
      jsonText(
        await updateTicket(
          repo,
          task_id,
          ticket_id,
          revision,
          { status: "inProgress", assignee },
          resolveDate(undefined, config),
        ),
      ),
  );
}
