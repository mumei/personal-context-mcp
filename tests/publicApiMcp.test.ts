import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

function toolText(result: unknown): string {
  const record = result as { content?: Array<{ type?: string; text?: string }> };
  const first = record.content?.[0];
  return first?.type === "text" && typeof first.text === "string" ? first.text : "{}";
}

describe("public MCP API", () => {
  const originalDataRoot = process.env.TASK_MCP_DATA_ROOT;
  const originalTimezone = process.env.TASK_MCP_TIMEZONE;

  afterEach(() => {
    if (originalDataRoot === undefined) delete process.env.TASK_MCP_DATA_ROOT;
    else process.env.TASK_MCP_DATA_ROOT = originalDataRoot;
    if (originalTimezone === undefined) delete process.env.TASK_MCP_TIMEZONE;
    else process.env.TASK_MCP_TIMEZONE = originalTimezone;
    vi.resetModules();
  });

  it("exposes the renamed and separated report APIs with restricted mutation schemas", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-public-api-"));
    await writeFile(
      join(root, "tasks.yaml"),
      "tasks:\n  - id: report-task\n    title: Report task\n    status: inProgress\n",
      "utf8",
    );
    process.env.TASK_MCP_DATA_ROOT = root;
    process.env.TASK_MCP_TIMEZONE = "UTC";
    vi.resetModules();
    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "public-api-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const listed = await client.listTools();
      const tools = new Map(listed.tools.map((tool) => [tool.name, tool]));

      expect(client.getInstructions()).toContain("call system_prepare_work");
      expect(client.getInstructions()).toContain("Apply Knowledge evidence, applicability, and limitations");
      expect(client.getInstructions()).toContain("Use People proactively");
      expect(tools.has("task_memory_promote_activity")).toBe(true);
      expect(tools.has("task_memory_generate_mindmap")).toBe(true);
      expect(tools.has("report_render_output")).toBe(true);
      expect(tools.has("report_set_task_visibility")).toBe(true);
      expect(tools.has("report_generate_weekly")).toBe(true);
      expect(tools.has("report_get_weekly")).toBe(true);
      expect(tools.size).toBe(62);
      for (const name of [
        "ticket_create_item",
        "ticket_list_items",
        "ticket_get_item",
        "ticket_update_item",
        "ticket_start_item",
      ])
        expect(tools.has(name)).toBe(true);
      expect(tools.get("report_set_task_visibility")?.inputSchema.required).toEqual(
        expect.arrayContaining(["task_id", "visible"]),
      );
      expect(tools.get("report_set_task_visibility")?.description).toContain("unreflected-Activity warnings");
      const excluded = JSON.parse(
        toolText(
          await client.callTool({
            name: "report_set_task_visibility",
            arguments: { task_id: "report-task", visible: false },
          }),
        ),
      ) as Record<string, unknown>;
      expect(excluded).toMatchObject({
        task: { id: "report-task", report_exclude: true },
        visible: false,
      });
      expect(await readFile(join(root, "tasks.yaml"), "utf8")).toContain("report_exclude: true");
      expect(tools.has("system_prepare_work")).toBe(true);
      expect(tools.get("system_prepare_work")?.inputSchema.required).toContain("query");
      expect(tools.get("system_prepare_work")?.description).toContain("concise reusable domain concepts");
      const prepared = JSON.parse(
        toolText(
          await client.callTool({
            name: "system_prepare_work",
            arguments: {
              query: "sales decision support",
              knowledge_limit: 5,
              scope: "global",
              include_global_situation: true,
              include_global_memory: true,
            },
          }),
        ),
      ) as Record<string, unknown>;
      expect(prepared).toMatchObject({
        query: "sales decision support",
        situation: expect.any(Object),
        global_memory: expect.any(Object),
        knowledge: expect.any(Object),
      });
      for (const tool of [
        "knowledge_search_graph",
        "knowledge_get_note",
        "knowledge_get_usage",
        "knowledge_upsert_note",
        "knowledge_promote_task_memory",
        "knowledge_rebuild_graph",
      ])
        expect(tools.has(tool)).toBe(true);
      for (const tool of [
        "people_list_profiles",
        "people_get_profile",
        "people_find_duplicates",
        "people_capture_update",
        "people_upsert_profile",
        "people_merge_profiles",
        "people_record_interaction",
        "people_list_interactions",
        "people_upsert_relationship",
        "people_delete_profile",
        "people_restore_profile",
      ])
        expect(tools.has(tool)).toBe(true);
      expect(tools.get("people_upsert_profile")?.description).toContain("never convert an inference");
      expect(tools.get("people_capture_update")?.description).toContain("Use proactively");
      expect(tools.get("people_find_duplicates")?.description).toContain("never trigger an automatic merge");
      expect(tools.get("people_merge_profiles")?.description).toContain("immutable interaction journals");
      expect(tools.get("people_record_interaction")?.description).toContain("immutable dated interaction");
      await client.callTool({
        name: "people_upsert_profile",
        arguments: {
          id: "tanaka-taro",
          display_name: "田中 太郎",
          facts: [
            {
              id: "preferred-channel",
              category: "communication",
              value: "Slack",
              basis: "confirmed",
              sensitivity: "private",
            },
          ],
        },
      });
      const person = JSON.parse(
        toolText(
          await client.callTool({
            name: "people_get_profile",
            arguments: { person_id: "tanaka-taro" },
          }),
        ),
      ) as Record<string, unknown>;
      expect(person).toMatchObject({ profile: { id: "tanaka-taro", facts: [{ basis: "confirmed" }] } });
      const captured = await client.callTool({
        name: "people_capture_update",
        arguments: {
          profiles: [{ id: "self", display_name: "Current user", relationship_type: "self" }],
          relationships: [
            {
              relationship_id: "self-to-tanaka",
              from_person_id: "self",
              to_person_id: "tanaka-taro",
              type: "client",
            },
          ],
          interactions: [
            {
              person_ids: ["self", "tanaka-taro"],
              date: "2026-08-13",
              backfill: true,
              idempotency_key: "public-api-people-capture",
              summary: "Confirmed the relationship",
            },
          ],
        },
      });
      expect(captured.isError).not.toBe(true);
      const capturedPerson = JSON.parse(
        toolText(await client.callTool({ name: "people_get_profile", arguments: { person_id: "tanaka-taro" } })),
      ) as Record<string, unknown>;
      expect(capturedPerson).toMatchObject({
        relationships: [{ id: "self-to-tanaka" }],
        interactions: [{ summary: "Confirmed the relationship" }],
      });
      expect(tools.get("knowledge_promote_task_memory")?.inputSchema.required).toContain("allow_llm_data_sharing");
      expect(tools.get("knowledge_upsert_note")?.inputSchema.required).toEqual(
        expect.arrayContaining(["id", "title", "type", "summary", "evidence", "body"]),
      );
      expect(tools.get("knowledge_upsert_note")?.inputSchema.properties).not.toHaveProperty("sources");
      expect(tools.get("knowledge_upsert_note")?.description).toContain("Never use task ids");
      expect(tools.get("knowledge_upsert_note")?.description).toContain("removing the originating task name and date");
      expect(tools.get("knowledge_search_graph")?.description).toContain("Call this before planning");
      expect(tools.get("knowledge_search_graph")?.description).toContain("knowledge_get_note");
      expect(tools.get("knowledge_get_note")?.description).toContain("rationale, applicability, and limitations");
      expect(tools.get("knowledge_get_usage")?.description).toContain("injected_to_llm");
      await client.callTool({ name: "knowledge_search_graph", arguments: { query: "sales" } });
      const usage = JSON.parse(
        toolText(await client.callTool({ name: "knowledge_get_usage", arguments: { days: 30, limit: 10 } })),
      ) as Record<string, unknown>;
      expect(usage).toMatchObject({
        event_count: 2,
        injected_event_count: 0,
        workflows: {
          system_prepare_work: { event_count: 1 },
          knowledge_search_graph: { event_count: 1 },
        },
      });
      expect(tools.get("knowledge_promote_task_memory")?.description).toContain(
        "Return no notes when no content qualifies",
      );
      expect(tools.has("briefing_generate_daily")).toBe(true);
      expect(tools.get("briefing_generate_daily")?.inputSchema.required ?? []).not.toContain("allow_llm_data_sharing");
      expect(tools.get("briefing_generate_daily")?.description).toContain("sections 1-3 stay local");
      expect(tools.has("task_delete_item")).toBe(true);
      expect(tools.has("task_restore_item")).toBe(true);
      expect(tools.get("task_memory_generate_mindmap")?.inputSchema.required).toContain("allow_llm_data_sharing");
      expect(tools.get("session_finish_task")?.inputSchema.required).toContain("task_id");
      expect(tools.get("session_finish_task")?.inputSchema.properties).toHaveProperty("memory_policy");
      expect(tools.get("session_finish_task")?.inputSchema.properties).toHaveProperty("processing_policy");
      expect(tools.get("cleanup_run_retention")?.inputSchema.properties?.dry_run).toMatchObject({ default: true });
      expect(tools.get("session_finish_task")?.inputSchema.properties).toHaveProperty("global_memory_updates");
      expect(tools.get("session_finish_task")?.inputSchema.properties).toHaveProperty("knowledge_updates");
      expect(tools.get("session_finish_task")?.inputSchema.properties).toHaveProperty("people_updates");
      expect(tools.get("report_generate_output")?.description).toContain("never modifies it");
      expect(tools.get("report_generate_output")?.description).toContain("web_url");
      expect(tools.get("system_get_user_situation")?.description).toContain("web_url");
      expect(tools.get("input_upsert_item")?.inputSchema.properties).toHaveProperty("input_id");
      expect(tools.get("activity_append_entry")?.inputSchema.properties).toHaveProperty("idempotency_key");
      expect(tools.get("activity_append_entry")?.inputSchema.properties).toHaveProperty("backfill");
      expect(tools.get("session_finish_task")?.inputSchema.properties).toHaveProperty("backfill");
      expect(tools.get("cleanup_archive_candidates")?.inputSchema.properties?.dry_run).toMatchObject({ default: true });
      for (const removed of [
        "generate_memory_summary",
        "list_memory_summaries",
        "optimize_memory_summaries",
        "submit_agent_update",
        "apply_agent_updates",
        "finalize_daily",
        "import_task_directory",
      ])
        expect(tools.has(removed)).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("renders without an LLM and keeps cleanup dry-run read-only", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-public-dry-run-"));
    await mkdir(join(root, "outputs", "legacy"), { recursive: true });
    await writeFile(
      join(root, "tasks.yaml"),
      "tasks:\n  - id: task-1\n    title: Rendered task\n    status: inProgress\n",
      "utf8",
    );
    await writeFile(join(root, "outputs", "legacy", "old.txt"), "old output", "utf8");
    process.env.TASK_MCP_DATA_ROOT = root;
    process.env.TASK_MCP_TIMEZONE = "UTC";
    vi.resetModules();
    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "public-dry-run-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const rendered = await client.callTool({
        name: "report_render_output",
        arguments: { date: "2026-07-12", format: "text", write: false },
      });
      const situation = await client.callTool({
        name: "system_get_user_situation",
        arguments: { date: "2026-07-12", lookback_days: 7 },
      });
      const cleanup = await client.callTool({
        name: "cleanup_archive_candidates",
        arguments: { target: "outputs", dry_run: true, keep_output_dirs: [] },
      });

      expect(rendered.isError).not.toBe(true);
      expect(JSON.parse(toolText(rendered))).toMatchObject({
        date: "2026-07-12",
        renderer: "text",
        text: expect.any(String),
        web_url: "http://127.0.0.1:8787/report/text?date=2026-07-12",
      });
      expect(JSON.parse(toolText(rendered))).not.toHaveProperty("path");
      expect(JSON.parse(toolText(rendered))).not.toHaveProperty("save");
      expect(JSON.parse(toolText(situation))).toMatchObject({
        date: "2026-07-12",
        web_url: "http://127.0.0.1:8787/summary?date=2026-07-12",
        web_links: {
          summary: "http://127.0.0.1:8787/summary?date=2026-07-12",
          report_text: "http://127.0.0.1:8787/report/text?date=2026-07-12",
          report_markdown: "http://127.0.0.1:8787/report/markdown?date=2026-07-12",
        },
      });
      expect(cleanup.isError).not.toBe(true);
      expect(JSON.parse(toolText(cleanup))).toMatchObject({ dry_run: true });
      await expect(readFile(join(root, "outputs", "legacy", "old.txt"), "utf8")).resolves.toBe("old output");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("logically deletes and restores tasks through the public MCP API", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-public-delete-"));
    process.env.TASK_MCP_DATA_ROOT = root;
    process.env.TASK_MCP_TIMEZONE = "UTC";
    vi.resetModules();
    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "public-delete-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      await client.callTool({ name: "task_create_item", arguments: { id: "duplicate", title: "Duplicate" } });
      const deleted = await client.callTool({ name: "task_delete_item", arguments: { task_id: "duplicate" } });
      const current = await client.callTool({ name: "task_list_items", arguments: { include_done: true } });
      const audit = await client.callTool({
        name: "task_list_items",
        arguments: { include_done: true, include_deleted: true },
      });

      expect(JSON.parse(toolText(deleted))).toMatchObject({ task: { id: "duplicate", deleted: true } });
      expect(JSON.parse(toolText(current))).toMatchObject({ count: 0, tasks: [] });
      expect(JSON.parse(toolText(audit))).toMatchObject({ count: 1, tasks: [{ id: "duplicate", deleted: true }] });

      await client.callTool({ name: "task_restore_item", arguments: { task_id: "duplicate" } });
      const restored = JSON.parse(
        toolText(
          await client.callTool({
            name: "task_get_item",
            arguments: { task_id: "duplicate" },
          }),
        ),
      );
      expect(restored.task).toMatchObject({ id: "duplicate", title: "Duplicate" });
      expect(restored.task).not.toHaveProperty("deleted");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("previews one task-scoped session without using a public queue", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-mcp-finalize-scope-"));
    process.env.TASK_MCP_DATA_ROOT = root;
    process.env.TASK_MCP_TIMEZONE = "UTC";
    vi.resetModules();
    const { createServer } = await import("#server");
    const server = createServer();
    const client = new Client({ name: "finalize-scope-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      await client.callTool({
        name: "task_create_item",
        arguments: { id: "task-1", title: "Scoped task" },
      });
      const preview = await client.callTool({
        name: "session_finish_task",
        arguments: {
          date: "2026-07-12",
          backfill: true,
          dry_run: true,
          session_id: "task-session",
          source: "test",
          summary: "task",
          task_id: "task-1",
          done: ["task work"],
          people_updates: {
            profiles: [{ id: "session-person", display_name: "Session Person" }],
          },
          knowledge_updates: [
            {
              id: "reusable-session-principle",
              title: "Reusable session principle",
              type: "concept",
              summary: "A reusable principle discovered during work.",
              evidence: [{ statement: "Generalize durable insights", rationale: "They can guide later tasks" }],
              body: "Apply this principle when the same conditions recur.",
            },
          ],
        },
      });

      expect(preview.isError).not.toBe(true);
      expect(JSON.parse(toolText(preview))).toMatchObject({
        dry_run: true,
        submitted: { update: { task_id: "task-1", done: ["task work"] } },
        finalize: { apply: { entries: [{ task_id: "task-1", done: ["task work"] }] } },
        people_update_preview: { profiles: [{ id: "session-person" }] },
        knowledge_update_preview: [{ id: "reusable-session-principle" }],
      });

      const applied = await client.callTool({
        name: "session_finish_task",
        arguments: {
          date: "2026-07-12",
          backfill: true,
          session_id: "task-session-applied",
          source: "test",
          summary: "task with person information",
          task_id: "task-1",
          done: ["captured person information"],
          processing_policy: "deferred",
          people_updates: {
            profiles: [{ id: "session-person", display_name: "Session Person" }],
          },
          knowledge_updates: [
            {
              id: "reusable-session-principle",
              title: "Reusable session principle",
              type: "concept",
              summary: "A reusable principle discovered during work.",
              evidence: [{ statement: "Generalize durable insights", rationale: "They can guide later tasks" }],
              body: "Apply this principle when the same conditions recur.",
            },
          ],
        },
      });
      expect(applied.isError).not.toBe(true);
      expect(JSON.parse(toolText(applied))).toMatchObject({
        people_updated: true,
        people: { profiles: [{ profile: { id: "session-person" } }] },
        knowledge_updated: true,
        knowledge_created_count: 1,
        knowledge_updated_count: 0,
      });
      const knowledge = await client.callTool({
        name: "knowledge_get_note",
        arguments: { id: "reusable-session-principle", depth: 0 },
      });
      expect(JSON.parse(toolText(knowledge))).toMatchObject({ note: { title: "Reusable session principle" } });
      const sessionPerson = await client.callTool({
        name: "people_get_profile",
        arguments: { person_id: "session-person" },
      });
      expect(JSON.parse(toolText(sessionPerson))).toMatchObject({ profile: { display_name: "Session Person" } });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
