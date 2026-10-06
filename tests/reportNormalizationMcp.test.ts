import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { buildReportEntriesPrompt, parseGeneratedReportEntries, preserveProposedUpdateUrls } from "#server";
import { createTempRepo } from "./helpers.ts";

describe("report normalization MCP behavior", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("exposes append-only activities and persistent report overrides", async () => {
    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "tool-list-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);
    const activityTool = listed.tools.find((tool) => tool.name === "activity_append_entry");
    const reportTool = listed.tools.find((tool) => tool.name === "report_update_entry");
    const visibilityTool = listed.tools.find((tool) => tool.name === "report_set_task_visibility");

    await client.close();
    await server.close();

    expect(toolNames).toContain("session_finish_task");
    expect(toolNames).toContain("activity_append_entry");
    expect(toolNames).toContain("report_set_task_visibility");
    expect(toolNames).not.toContain("compact_pending_agent_updates");
    expect(toolNames).not.toContain("upsert_activity_entry");
    expect(toolNames).not.toContain("compact_daily_task_history");
    expect(toolNames).not.toContain("compact_agent_updates");
    expect(JSON.stringify(activityTool?.inputSchema)).not.toContain("activity_id");
    expect(JSON.stringify(activityTool?.inputSchema)).not.toContain("mode");
    expect(activityTool?.description).toContain("cannot replace, delete, compact, or shorten");
    expect(reportTool?.description).toContain("persistent per-date report override");
    expect(JSON.stringify(reportTool?.inputSchema)).toContain("clear_override");
    expect(visibilityTool?.description).toContain("without deleting its task data");
    expect(JSON.stringify(visibilityTool?.inputSchema)).toContain("visible");
  });
});

describe("LLM report entry normalization", () => {
  it("restores user-facing URLs omitted by the LLM", () => {
    const tasks = [
      {
        task_id: "task-1",
        memory_update: { summary: [], facts: [], decisions: [], risks: [], next: [], sources: [] },
        report_entry: { done: ["公開レポートを更新した。"], next: [] },
        task_summary: [],
      },
    ];

    preserveProposedUpdateUrls(tasks, [
      {
        session_id: "session-1",
        source: "codex",
        summary: "Published a report",
        task_id: "task-1",
        done: ["公開レポート: https://example.com/report"],
      },
    ]);

    expect(tasks[0]?.report_entry.done).toContain("公開レポート: https://example.com/report");
  });

  it("instructs LLM providers to output one entry per task id", async () => {
    const { repo } = await createTempRepo();

    const prompt = await buildReportEntriesPrompt(repo, "2026-07-04");

    expect(prompt.prompt).toContain("Output exactly one report entry for each `task_id`");
  });

  it("does not send logically deleted duplicate tasks to report generation", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          { id: "current", title: "Current task", status: "inProgress" },
          { id: "duplicate", title: "Deleted duplicate", status: "inProgress", deleted: true },
        ],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [
          { task_id: "current", done: ["Current result"] },
          { task_id: "duplicate", done: ["Duplicate result"] },
        ],
      },
      "seed",
    );

    const prompt = await buildReportEntriesPrompt(repo, "2026-07-04");

    expect(prompt.source_activity_count).toBe(1);
    expect(prompt.prompt).toContain("Current task");
    expect(prompt.prompt).not.toContain("Deleted duplicate");
    expect(prompt.prompt).not.toContain("Duplicate result");
  });

  it("merges duplicate task ids before report entries are saved", () => {
    const entries = parseGeneratedReportEntries(
      JSON.stringify({
        entries: [
          { task_id: "task-1", done: ["first", "shared"], next: ["follow up"] },
          { task_id: " task-1 ", done: ["shared", "latest"], next: ["follow up", "confirm result"] },
          { task_id: "task-2", done: ["separate"] },
        ],
      }),
    );

    expect(entries).toEqual([
      { task_id: "task-1", done: ["shared", "latest", "first"], next: ["follow up", "confirm result"] },
      { task_id: "task-2", done: ["separate"] },
    ]);
  });

  it("keeps duplicate LLM entries within report field limits", () => {
    const entries = parseGeneratedReportEntries(
      JSON.stringify({
        entries: [
          {
            task_id: "task-1",
            done: ["d1", "d2", "d3"],
            next: ["n1", "n2"],
            confirm: ["c1"],
            external_summary: ["e1"],
          },
          {
            task_id: "task-1",
            done: ["d4", "d5"],
            next: ["n3", "n4"],
            confirm: ["c2", "c3"],
            external_summary: ["e2", "e3"],
          },
        ],
      }),
    );

    expect(entries).toEqual([
      {
        task_id: "task-1",
        done: ["d4", "d5", "d1", "d2"],
        next: ["n3", "n4", "n1"],
      },
    ]);
  });
});

describe("scoped session summary persistence", () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnvironment };
    vi.resetModules();
  });

  function configureCopilot(response: unknown, expected: string) {
    process.env.TASK_MCP_LLM_PROVIDER = "copilot_cli";
    process.env.TASK_MCP_COPILOT_COMMAND = process.execPath;
    process.env.TASK_MCP_COPILOT_ARGS = fileURLToPath(new URL("./fixtures/fakeCopilot.mjs", import.meta.url));
    process.env.TASK_MCP_COPILOT_MODEL = "test-model";
    process.env.TASK_MCP_TEST_LLM_RESPONSE = JSON.stringify(response);
    process.env.TASK_MCP_TEST_LLM_EXPECT_CONTAINS = expected;
  }

  it("stores the generated summary and incorporates new activity while retaining the manual override marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-scoped-summary-"));
    process.env.TASK_MCP_DATA_ROOT = root;
    process.env.TASK_MCP_TIMEZONE = "UTC";
    configureCopilot(
      {
        tasks: [
          {
            task_id: "task-1",
            report_entry: { done: ["LLM generated done"], next: ["LLM generated next"] },
            task_summary: ["現在の安定した状態", "次の確認事項"],
          },
        ],
      },
      "Preserve user-facing URLs",
    );
    vi.resetModules();

    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "scoped-summary-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      await client.callTool({
        name: "task_create_item",
        arguments: {
          id: "task-1",
          title: "Canonical task title",
          project: "Canonical project",
          tier: 2,
          status: "inProgress",
        },
      });
      await client.callTool({
        name: "report_update_entry",
        arguments: {
          date: "2026-07-12",
          task_id: "task-1",
          mode: "replace",
          done: ["Manual done"],
          next: ["Manual next"],
        },
      });
      const result = await client.callTool({
        name: "session_finish_task",
        arguments: {
          date: "2026-07-12",
          backfill: true,
          session_id: "summary-session",
          source: "test",
          summary: "Finish scoped session",
          task_id: "task-1",
          title: "Untrusted session title",
          project: "Untrusted session project",
          done: ["Session work"],
          status_suggestion: "waiting",
          apply_task_state: true,
          global_memory_updates: {
            preferences: ["Prefer concise reports"],
            rules: ["Preserve user-facing URLs"],
          },
          formats: [],
        },
      });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
      await server.close();
    }

    const tasks = YAML.parse(await readFile(join(root, "tasks.yaml"), "utf8")) as {
      tasks: Array<Record<string, unknown>>;
    };
    const report = YAML.parse(await readFile(join(root, "reports", "2026-07-12.yaml"), "utf8")) as {
      entries: Array<Record<string, unknown>>;
    };
    const task = tasks.tasks.find((item) => item.id === "task-1");
    const entry = report.entries.find((item) => item.task_id === "task-1");

    expect(task?.compact_summary).toEqual(["現在の安定した状態", "次の確認事項"]);
    expect(entry).toMatchObject({
      manual_override: true,
      done: ["LLM generated done"],
      next: ["LLM generated next"],
      source_activity_revision: expect.any(String),
      task_snapshot: {
        title: "Canonical task title",
        project: "Canonical project",
        tier: 2,
        status: "waiting",
        summary: ["現在の安定した状態", "次の確認事項"],
      },
    });
    expect(entry).not.toHaveProperty("task_summary");
    await expect(readFile(join(root, "task_memory", "task-1.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const globalMemory = YAML.parse(await readFile(join(root, "global_memory.yaml"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(globalMemory).toMatchObject({
      preferences: ["Prefer concise reports"],
      rules: ["Preserve user-facing URLs"],
      sources: [{ date: "2026-07-12", task_id: "task-1", section: "session_finish_task" }],
    });
  });

  it("generates a report without creating or replacing task memory", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-report-memory-isolation-"));
    process.env.TASK_MCP_DATA_ROOT = root;
    process.env.TASK_MCP_TIMEZONE = "UTC";
    configureCopilot(
      {
        tasks: [
          {
            task_id: "task-1",
            report_entry: { done: ["作業結果"], next: ["次の確認"] },
            task_summary: ["現在の表示状態"],
          },
        ],
      },
      "Do not produce or modify task memory",
    );
    vi.resetModules();

    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "report-memory-isolation-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      await client.callTool({ name: "task_create_item", arguments: { id: "task-1", title: "Task" } });
      await client.callTool({
        name: "task_memory_update_state",
        arguments: { task_id: "task-1", mode: "replace", facts: ["変更してはいけない長期記憶"] },
      });
      const memoryBefore = await readFile(join(root, "task_memory", "task-1.yaml"));
      await client.callTool({
        name: "activity_append_entry",
        arguments: { date: "2026-07-12", backfill: true, task_id: "task-1", done: ["作業結果"] },
      });
      const result = await client.callTool({
        name: "report_generate_output",
        arguments: { date: "2026-07-12", format: "text" },
      });
      expect(result.isError).not.toBe(true);
      expect(await readFile(join(root, "task_memory", "task-1.yaml"))).toEqual(memoryBefore);
    } finally {
      await client.close();
      await server.close();
    }

    await expect(readFile(join(root, "reports", "2026-07-12.yaml"), "utf8")).resolves.toContain("現在の表示状態");
  });

  it("promotes durable memory only when session_finish_task explicitly requests it", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-explicit-memory-promotion-"));
    process.env.TASK_MCP_DATA_ROOT = root;
    process.env.TASK_MCP_TIMEZONE = "UTC";
    configureCopilot(
      {
        tasks: [
          {
            task_id: "task-1",
            memory_update: {
              summary: ["再利用可能な現行方針"],
              facts: ["安定した事実"],
              decisions: [],
              risks: [],
              next: [],
              mindmap: { root: "Task", paths: [["方針", "現行", "安定", "再利用可能"]] },
              sources: [],
            },
            report_entry: { done: ["当日の作業"], next: [] },
            task_summary: ["現在の表示状態"],
          },
        ],
      },
      "complete durable memory update||never store dated work logs",
    );
    vi.resetModules();

    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "explicit-memory-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      await client.callTool({ name: "task_create_item", arguments: { id: "task-1", title: "Task" } });
      const result = await client.callTool({
        name: "session_finish_task",
        arguments: {
          date: "2026-07-12",
          backfill: true,
          session_id: "durable-session",
          source: "test",
          summary: "Durable update",
          task_id: "task-1",
          done: ["当日の作業"],
          promote_memory: true,
          formats: [],
        },
      });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
      await server.close();
    }

    await expect(readFile(join(root, "task_memory", "task-1.yaml"), "utf8")).resolves.toContain("安定した事実");
  });
});
