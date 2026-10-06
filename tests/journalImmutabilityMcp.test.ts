import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

function toolText(result: unknown): string {
  const record = result as { content?: Array<{ type?: string; text?: string }> };
  const first = record.content?.[0];
  return first?.type === "text" && typeof first.text === "string" ? first.text : "{}";
}

describe("MCP activity journal immutability", () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnvironment };
    vi.resetModules();
  });

  it("keeps the journal unchanged and does not emit a report when LLM generation is unavailable", async () => {
    const date = "2026-07-10";
    const taskId = "journal-task";
    const root = await mkdtemp(join(tmpdir(), "task-mcp-journal-immutability-"));
    process.env.TASK_MCP_DATA_ROOT = root;
    process.env.TASK_MCP_TIMEZONE = "UTC";
    process.env.TASK_MCP_LLM_PROVIDER = "copilot_cli";
    process.env.TASK_MCP_COPILOT_COMMAND = process.execPath;
    process.env.TASK_MCP_COPILOT_ARGS = fileURLToPath(new URL("./fixtures/fakeCopilot.mjs", import.meta.url));
    process.env.TASK_MCP_TEST_LLM_FAIL = "true";
    vi.resetModules();

    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "journal-immutability-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).not.toContain("compact_daily_task_history");

      await client.callTool({
        name: "task_create_item",
        arguments: { id: taskId, title: "Journal aggregation" },
      });
      await client.callTool({
        name: "activity_append_entry",
        arguments: {
          date,
          backfill: true,
          task_id: taskId,
          idempotency_key: "journal-session-1",
          done: ["Investigated the source journal"],
          next: ["Review the aggregation"],
        },
      });
      await client.callTool({
        name: "activity_append_entry",
        arguments: {
          date,
          backfill: true,
          task_id: taskId,
          idempotency_key: "journal-session-2",
          done: ["Implemented report generation"],
          next: ["Keep the journal append-only"],
        },
      });

      const activityPath = join(root, "activities", `${date}.yaml`);
      const activityBeforeReports = await readFile(activityPath);
      const failedReport = await client.callTool({
        name: "report_generate_output",
        arguments: { date, format: "text", write: true },
      });
      const activityAfterReports = await readFile(activityPath);

      expect(activityAfterReports).toEqual(activityBeforeReports);
      expect(failedReport.isError).toBe(true);
      expect(toolText(failedReport)).toContain("Copilot CLI exited with code 5");
      await expect(readFile(join(root, "reports", `${date}.yaml`), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(root, "outputs", "text", `${date}.txt`), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
