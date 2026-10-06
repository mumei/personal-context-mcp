import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { prepareWork } from "#app/workPreparation";
import { registerSystemTools } from "#mcp/tools/system";
import { createTempRepo } from "./helpers.ts";

describe("work preparation", () => {
  it("reserves the first next-action slots for the requested task without changing saved state", async () => {
    const { repo, config } = await createTempRepo();
    const otherTasks = Array.from({ length: 25 }, (_, index) => ({
      id: `other-${index}`,
      title: `Other ${index}`,
      status: "inProgress" as const,
    }));
    await repo.saveTasks(
      {
        tasks: [...otherTasks, { id: "kian", title: "Kian", status: "inProgress", report_exclude: true }],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-03",
      {
        date: "2026-07-03",
        entries: [{ task_id: "kian", next: ["Evaluate real audio", "Integrate the approved feature"] }],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: otherTasks.map((task) => ({ task_id: task.id, next: [`Newer action ${task.id}`] })),
      },
      "seed",
    );
    const taskPath = repo.layoutPath("tasks");
    const activityPath = repo.layoutPath("activities", "2026-07-03.yaml");
    const before = await Promise.all([readFile(taskPath, "utf8"), readFile(activityPath, "utf8")]);
    const input = {
      date: "2026-07-04",
      query: "audio evaluation",
      lookbackDays: 7,
      knowledgeDepth: 0,
      knowledgeLimit: 3,
      includeContextBody: false,
    };

    const crossTask = await prepareWork(repo, { ...input, scope: "global", includeGlobalSituation: true });
    const focused = await prepareWork(repo, { ...input, taskId: "kian" });

    expect(crossTask.situation!.next_actions.some((item) => item.task_id === "kian")).toBe(false);
    expect(focused.situation!.next_actions).toHaveLength(2);
    expect(JSON.stringify(focused)).not.toContain("other-");
    expect(focused.scope).toBe("strict");
    expect(focused.situation!.next_actions.slice(0, 2).map((item) => item.text)).toEqual([
      "Evaluate real audio",
      "Integrate the approved feature",
    ]);
    expect(focused.task_context).toMatchObject({
      task: { id: "kian", report_exclude: true },
      task_memory: { task_id: "kian" },
    });

    const server = new McpServer({ name: "work-preparation-test", version: "0.0.0" });
    registerSystemTools({ server, repo, config });
    const client = new Client({ name: "work-preparation-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const result = await client.callTool({
        name: "system_prepare_work",
        arguments: { task_id: "kian", date: input.date, query: input.query, knowledge_depth: 0, knowledge_limit: 3 },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const prepared = JSON.parse(content.find((item) => item.type === "text")?.text ?? "{}");
      expect(prepared.situation.next_actions).toEqual(focused.situation!.next_actions);
      expect(JSON.stringify(prepared)).not.toContain("other-");
    } finally {
      await client.close();
      await server.close();
    }
    expect(await Promise.all([readFile(taskPath, "utf8"), readFile(activityPath, "utf8")])).toEqual(before);
    await expect(readFile(repo.layoutPath("taskMemory", "kian.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(repo.layoutPath("reports", "2026-07-04.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects strict expansion and omits global situation unless explicitly requested", async () => {
    const { repo } = await createTempRepo();
    const input = {
      date: "2026-09-10",
      query: "VoIP",
      lookbackDays: 7,
      knowledgeDepth: 1,
      knowledgeLimit: 10,
      includeContextBody: true,
    };
    await expect(prepareWork(repo, { ...input, scope: "strict" })).rejects.toThrow("requires task_id");
    await expect(
      prepareWork(repo, { ...input, scope: "strict", taskId: "delivery", includeGlobalSituation: true }),
    ).rejects.toThrow("requires scope=global");
    expect((await prepareWork(repo, input)).situation).toBeUndefined();
  });

  it("never expands explicit Knowledge into other nodes and excludes unrelated activity and Global Memory", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          { id: "delivery", title: "VoIP", status: "inProgress" },
          { id: "robot", title: "ROBOT_SWITCH_SECRET", status: "waiting" },
        ],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-09-10",
      {
        date: "2026-09-10",
        entries: [
          { task_id: "delivery", done: ["Audio trial"] },
          { task_id: "robot", done: ["ROBOT_SWITCH_SECRET"], next: ["ROBOT_SWITCH_SECRET"] },
        ],
      },
      "seed",
    );
    await repo.saveGlobalMemory({ summary: ["GLOBAL_SECRET"], rules: [], preferences: [] }, "seed");
    for (const id of ["voice", "unrelated"])
      await repo.saveKnowledgeNote(
        {
          id,
          title: id,
          type: "technology",
          aliases: [],
          tags: [],
          summary: id,
          evidence: [{ statement: id, rationale: "Reusable evidence" }],
          relations: id === "voice" ? [{ type: "related_to", target_id: "unrelated" }] : [],
          created_at: "2026-09-10T00:00:00Z",
          updated_at: "2026-09-10T00:00:00Z",
          body: id,
        },
        "seed",
      );
    const args = {
      date: "2026-09-10",
      query: "unrelated",
      taskId: "delivery",
      lookbackDays: 7,
      knowledgeDepth: 3,
      knowledgeLimit: 10,
      includeContextBody: true,
    };
    const strict = await prepareWork(repo, args);
    expect(strict.knowledge.nodes).toEqual([]);
    expect(JSON.stringify(strict)).not.toContain("ROBOT_SWITCH_SECRET");
    expect(JSON.stringify(strict)).not.toContain("GLOBAL_SECRET");
    const selected = await prepareWork(repo, { ...args, knowledgeIds: ["voice"] });
    expect(selected.knowledge.nodes.map((node) => node.id)).toEqual(["voice"]);
    expect(selected.knowledge.edges).toEqual([]);
    expect(selected.situation!.recent_done.map((item) => item.text)).toEqual(["Audio trial"]);
  });
});
