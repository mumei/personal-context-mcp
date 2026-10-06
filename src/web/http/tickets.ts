/** Serves canonical ticket reads/mutations and snapshot-based SSE across MCP processes.
 * 正本の小チケットAPIと、MCP別プロセスの変更も検出するスナップショットSSEを担当します。
 * @packageDocumentation */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Repository } from "#infra/repository/repository";
import { ticketBoard, updateTicket, ticketPatch } from "#domain/tickets/service";
import { json, readJsonBody } from "#web/http/response";
import { ticketHistory } from "#domain/tickets/detail";

/** Serves a scoped, read-only ticket journal. 対象チケット限定の読み取り専用履歴APIです。 */
export async function ticketDetailApi(req: IncomingMessage, res: ServerResponse, repo: Repository, url: URL) {
  if (req.method !== "GET") {
    json(res, { error: "Method not allowed" }, 405);
    return;
  }
  const parsed = z
    .object({ task_id: z.string().min(1), ticket_id: z.string().uuid() })
    .safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    json(res, { error: "Invalid ticket identity" }, 400);
    return;
  }
  const result = await ticketHistory(repo, parsed.data.task_id, parsed.data.ticket_id);
  json(res, result ?? { error: "Ticket not found" }, result ? 200 : 404);
}

export async function ticketApi(
  req: IncomingMessage,
  res: ServerResponse,
  repo: Repository,
  events: boolean,
  date: string,
) {
  if (req.method === "PUT" && !events) {
    const input = z
      .object({
        task_id: z.string(),
        ticket_id: z.string().uuid(),
        revision: z.number().int().positive(),
        patch: ticketPatch,
      })
      .parse(await readJsonBody(req));
    try {
      json(res, await updateTicket(repo, input.task_id, input.ticket_id, input.revision, input.patch, date));
    } catch (error) {
      json(res, { error: error instanceof Error ? error.message : String(error) }, 409);
    }
    return;
  }
  if (req.method !== "GET") {
    json(res, { error: "Method not allowed" }, 405);
    return;
  }
  if (!events) {
    json(res, { tickets: await ticketBoard(repo) });
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  let closed = false;
  let previous = "";
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    try {
      const data = JSON.stringify({ tickets: await ticketBoard(repo) });
      const hash = createHash("sha256").update(data).digest("hex");
      if (!closed) {
        const writable = hash !== previous ? res.write(`id: ${hash}\ndata: ${data}\n\n`) : res.write(": heartbeat\n\n");
        previous = hash;
        if (!writable) {
          closed = true;
          res.end();
          return;
        }
      }
    } catch {
      if (!closed) {
        closed = true;
        res.end();
      }
    }
    if (!closed) timer = setTimeout(() => void poll(), 2000);
  };
  res.on("close", () => {
    closed = true;
    clearTimeout(timer);
  });
  await poll();
}
