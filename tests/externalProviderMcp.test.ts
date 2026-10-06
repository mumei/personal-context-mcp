import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
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

describe("task memory promotion MCP tool", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    vi.resetModules();
  });

  async function seedRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-promotion-"));
    await mkdir(join(root, "activities"), { recursive: true });
    await mkdir(join(root, "task_memory"), { recursive: true });
    await writeFile(
      join(root, "tasks.yaml"),
      "tasks:\n  - id: task-1\n    title: Task\n    status: inProgress\n",
      "utf8",
    );
    await writeFile(join(root, "task_memory", "task-1.yaml"), "task_id: task-1\nfacts:\n  - 旧方式を利用\n", "utf8");
    await writeFile(
      join(root, "activities", "2026-07-04.yaml"),
      "date: 2026-07-04\nentries:\n  - task_id: task-1\n    done:\n      - 新方式へ移行\n",
      "utf8",
    );
    return root;
  }

  function configureCopilot(response: unknown, expected = "", rejected = "") {
    process.env.TASK_MCP_LLM_PROVIDER = "copilot_cli";
    process.env.TASK_MCP_COPILOT_COMMAND = process.execPath;
    process.env.TASK_MCP_COPILOT_ARGS = fileURLToPath(new URL("./fixtures/fakeCopilot.mjs", import.meta.url));
    process.env.TASK_MCP_COPILOT_MODEL = "test-model";
    process.env.TASK_MCP_TEST_LLM_RESPONSE = JSON.stringify(response);
    process.env.TASK_MCP_TEST_LLM_EXPECT_CONTAINS = expected;
    process.env.TASK_MCP_TEST_LLM_EXPECT_NOT_CONTAINS = rejected;
  }

  it("combines existing memory and activity, then replaces the durable task state", async () => {
    const root = await seedRoot();
    process.env.TASK_MCP_DATA_ROOT = root;
    process.env.TASK_MCP_TIMEZONE = "UTC";
    configureCopilot(
      {
        task_id: "task-1",
        summary: ["新方式への移行が完了"],
        facts: ["新方式を利用"],
        decisions: [],
        risks: [],
        next: ["本番確認"],
        sources: [],
      },
      "旧方式を利用||新方式へ移行||Never store dated work logs",
    );
    vi.resetModules();
    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "promotion-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({
      name: "task_memory_promote_activity",
      arguments: { date: "2026-07-04", task_id: "task-1" },
    });
    await client.close();
    await server.close();

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(toolText(result)) as {
      llm_provider: string;
      applied: { document: { facts: string[]; input_hash: string } };
    };
    expect(payload.llm_provider).toBe("copilot_cli");
    expect(payload.applied.document.facts).toEqual(["新方式を利用"]);
    const memory = await readFile(join(root, "task_memory", "task-1.yaml"), "utf8");
    expect(memory).toContain("新方式を利用");
    expect(memory).not.toContain("旧方式を利用");
    await expect(access(join(root, "memory_summaries", "2026-07-04.yaml"))).rejects.toThrow();
    const logDates = await readdir(join(root, "request_logs"));
    expect(await readFile(join(root, "request_logs", logDates[0] ?? ""), "utf8")).toContain(
      "task_memory_promote_activity",
    );
  });

  it("skips the LLM call when the promotion input has not changed", async () => {
    const root = await seedRoot();
    process.env.TASK_MCP_DATA_ROOT = root;
    process.env.TASK_MCP_TIMEZONE = "UTC";
    const countFile = join(root, "copilot-calls.txt");
    process.env.TASK_MCP_TEST_LLM_COUNT_FILE = countFile;
    configureCopilot({
      task_id: "task-1",
      summary: [],
      facts: ["新方式を利用"],
      decisions: [],
      risks: [],
      next: [],
      sources: [],
    });
    vi.resetModules();
    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "dedupe-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await client.callTool({
      name: "task_memory_promote_activity",
      arguments: { date: "2026-07-04", task_id: "task-1" },
    });
    const duplicate = await client.callTool({
      name: "task_memory_promote_activity",
      arguments: { date: "2026-07-04", task_id: "task-1" },
    });
    const forced = await client.callTool({
      name: "task_memory_promote_activity",
      arguments: { date: "2026-07-04", task_id: "task-1", force: true },
    });
    await client.close();
    await server.close();

    expect((await readFile(countFile, "utf8")).trim().split("\n")).toHaveLength(2);
    expect(JSON.parse(toolText(duplicate))).toMatchObject({
      fallback: { skipped: true, skip_reason: "duplicate_input" },
    });
    expect(JSON.parse(toolText(forced))).toMatchObject({ applied: { document: { facts: ["新方式を利用"] } } });
  });

  it("generates only the mind map from minimized memory fields after explicit consent", async () => {
    const root = await seedRoot();
    await writeFile(
      join(root, "task_memory", "task-1.yaml"),
      [
        "task_id: task-1",
        "summary:",
        "  - 移行作業中",
        "facts:",
        "  - 新方式を利用",
        "sources:",
        "  - path: /private/workspace/source.md",
        "input_hash: checkpoint",
        "",
      ].join("\n"),
      "utf8",
    );
    process.env.TASK_MCP_DATA_ROOT = root;
    process.env.TASK_MCP_TIMEZONE = "UTC";
    configureCopilot(
      { mindmap: { root: "Task", paths: [["移行", "実装", "新方式", "利用中"]] } },
      "移行作業中||新方式を利用",
      "新方式へ移行||/private/workspace/source.md",
    );
    vi.resetModules();
    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "mindmap-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({
      name: "task_memory_generate_mindmap",
      arguments: { task_id: "task-1", allow_llm_data_sharing: true },
    });
    await client.close();
    await server.close();

    expect(result.isError).not.toBe(true);
    const memory = await readFile(join(root, "task_memory", "task-1.yaml"), "utf8");
    expect(memory).toContain("新方式を利用");
    expect(memory).toContain("/private/workspace/source.md");
    expect(memory).toContain("mindmap:");
    expect(memory).toContain("利用中");
  });

  it("does not expose memory history, queue, finalization, or import tools", async () => {
    process.env.TASK_MCP_DATA_ROOT = await mkdtemp(join(tmpdir(), "task-mcp-tools-"));
    vi.resetModules();
    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "tool-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    await client.close();
    await server.close();

    for (const removed of [
      "list_memory_summaries",
      "optimize_memory_summaries",
      "list_memory_summary_backups",
      "restore_memory_summary_backup",
      "delete_memory_summary_backup",
      "submit_agent_update",
      "list_agent_updates",
      "update_agent_update_status",
      "apply_agent_updates",
      "compact_pending_agent_updates",
      "finalize_daily",
      "import_task_directory",
    ])
      expect(names).not.toContain(removed);
  });
});
