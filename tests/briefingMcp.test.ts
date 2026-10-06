import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "#infra/config/config";
import { Repository } from "#infra/repository/repository";
import { resolveDate } from "#shared/date";
import { registerBriefingTools } from "#mcp/tools/briefing";

function toolPayload(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === "text")?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

describe("briefing MCP tools", () => {
  it("generates today's briefing, hides persistence paths, and returns the Web URL", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-briefing-"));
    const config = loadConfig([], { TASK_MCP_DATA_ROOT: root, TASK_MCP_TIMEZONE: "UTC" });
    const repo = new Repository(config);
    const server = new McpServer({ name: "briefing-test", version: "0.0.0" });
    const generate = vi.fn(async (date: string) => ({
      document: { date, available: true },
      llm_provider: "copilot_cli",
      save: { path: `${root}/outputs/morning/${date}.md` },
    }));
    registerBriefingTools({ server, repo, config }, generate);
    const client = new Client({ name: "briefing-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const result = await client.callTool({
        name: "briefing_generate_daily",
        arguments: {},
      });
      const today = resolveDate(undefined, config);
      expect(generate).toHaveBeenCalledWith(today);
      expect(toolPayload(result)).toMatchObject({
        document: { date: today, available: true },
        llm_provider: "copilot_cli",
        web_url: `http://127.0.0.1:8787/summary?date=${today}`,
      });
      expect(toolPayload(result)).not.toHaveProperty("save");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
