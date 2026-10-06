import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, it, expect } from "vitest";
import { registerTicketTools } from "#mcp/tools/tickets";
import { registerSystemTools } from "#mcp/tools/system";
import { createTaskMcpWebServer } from "#webServer";
import { updateTicket } from "#domain/tickets/service";
import { createTempRepo } from "./helpers.ts";

describe("ticket MCP / Web integration", () => {
  it("shares the board, rejects stale updates and sends full snapshots on SSE reconnect", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "parent", title: "Readable parent", project: "Project" }] }, "seed");
    const mcp = new McpServer({ name: "ticket-test", version: "1" });
    registerTicketTools({ server: mcp, repo, config });
    registerSystemTools({ server: mcp, repo, config });
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(a), mcp.connect(b)]);
    const web = createTaskMcpWebServer(repo, config);
    web.listen(0, "127.0.0.1");
    await once(web, "listening");
    const base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
    const abort = new AbortController();
    try {
      const guide = await client.callTool({ name: "system_get_usage_guide", arguments: {} });
      expect(JSON.stringify(guide)).toContain("sender creates a ticket in todo");
      const toolList = await client.listTools();
      expect(toolList.tools.find((tool) => tool.name === "ticket_start_item")?.description).toContain(
        "receiving worker",
      );
      expect(toolList.tools.find((tool) => tool.name === "ticket_update_item")?.description).toContain(
        "Use discarded with discard_reason",
      );
      const response = await client.callTool({
        name: "ticket_create_item",
        arguments: { task_id: "parent", idempotency_key: "mcp", title: "Work", acceptance: [{ text: "Verified" }] },
      });
      expect(response.isError).not.toBe(true);
      const board = await (await fetch(`${base}/api/tickets`)).json();
      const ticket = board.tickets[0];
      expect(ticket.parent_title).toBe("Readable parent");
      expect(ticket.status).toBe("todo");
      const claimed = await client.callTool({
        name: "ticket_start_item",
        arguments: {
          task_id: "parent",
          ticket_id: ticket.ticket_id,
          revision: 1,
          assignee: { name: "Worker" },
        },
      });
      expect(claimed.isError).not.toBe(true);
      const conflict = await client.callTool({
        name: "ticket_start_item",
        arguments: {
          task_id: "parent",
          ticket_id: ticket.ticket_id,
          revision: 1,
          assignee: { name: "Competing worker" },
        },
      });
      expect(conflict.isError).toBe(true);
      const detail = await fetch(`${base}/api/tickets/detail?task_id=parent&ticket_id=${ticket.ticket_id}`);
      expect(detail.status).toBe(200);
      expect((await detail.json()).history.length).toBeGreaterThan(0);
      expect((await fetch(`${base}/api/tickets/detail?task_id=parent&ticket_id=invalid`)).status).toBe(400);
      const stream = await fetch(`${base}/api/tickets/events`, { signal: abort.signal });
      const reader = stream.body!.getReader();
      expect(stream.headers.get("content-type")).toBe("text/event-stream");
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(ticket.ticket_id);
      await updateTicket(repo, "parent", ticket.ticket_id, 2, { description: "Latest detail" });
      let chunk = "";
      while (!chunk.includes('"revision":3')) chunk += new TextDecoder().decode((await reader.read()).value);
      expect(chunk).toContain('"revision":3');
      const failed = await fetch(`${base}/api/tickets`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: "parent",
          ticket_id: ticket.ticket_id,
          revision: 1,
          patch: { status: "waiting", stop_reason: "Access" },
        }),
      });
      expect(failed.status).toBe(409);
      const missingDiscardReason = await fetch(`${base}/api/tickets`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: "parent",
          ticket_id: ticket.ticket_id,
          revision: 3,
          patch: { status: "discarded" },
        }),
      });
      expect(missingDiscardReason.status).toBe(409);
      const discarded = await fetch(`${base}/api/tickets`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: "parent",
          ticket_id: ticket.ticket_id,
          revision: 3,
          patch: { status: "discarded", discard_reason: "Superseded by another ticket" },
        }),
      });
      expect(discarded.status).toBe(200);
      expect(await discarded.json()).toMatchObject({
        status: "discarded",
        revision: 4,
        discard_reason: "Superseded by another ticket",
      });
      await reader.cancel();
      const reconnected = await fetch(`${base}/api/tickets/events`, { signal: abort.signal });
      const rereader = reconnected.body!.getReader();
      const reconnectSnapshot = new TextDecoder().decode((await rereader.read()).value);
      expect(reconnectSnapshot).toContain('"revision":4');
      expect(reconnectSnapshot).toContain('"status":"discarded"');
      await rereader.cancel();
    } finally {
      abort.abort();
      web.closeAllConnections();
      await new Promise<void>((resolve) => web.close(() => resolve()));
      await client.close();
      await mcp.close();
    }
  }, 15000);
});
