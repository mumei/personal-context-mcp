import { describe, expect, it } from "vitest";
import { upsertKnowledgeNote } from "#domain/knowledge/actions";
import { getKnowledgeUsageSummary, recordKnowledgeUsage } from "#infra/audit/knowledgeUsage";
import { writeRequestLog } from "#infra/audit/requestLog";
import { createTempRepo } from "./helpers.ts";

function knowledge(ids: string[]) {
  return {
    depth: 1,
    limit: 10,
    truncated: false,
    nodes: ids.map((id) => ({
      id,
      title: id,
      type: "concept" as const,
      aliases: [],
      tags: [],
      summary: `${id} summary`,
      evidence: [{ statement: `${id} statement`, rationale: `${id} rationale` }],
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    })),
    edges: [],
  };
}

describe("Knowledge usage audit", () => {
  it("records delivered and injected note IDs without note content", async () => {
    const { repo, config } = await createTempRepo();

    await upsertKnowledgeNote(repo, {
      id: "sales-principles",
      title: "Sales principles",
      type: "concept",
      summary: "Reusable sales guidance",
      evidence: [{ statement: "Understand before proposing", rationale: "Needs determine the useful proposal" }],
      body: "Use discovery before proposing a solution.",
    });
    await writeRequestLog(repo, config, {
      tool: "session_finish_task",
      status: "ok",
      duration_ms: 1,
      arguments_summary: { task_id: "task-1", knowledge_updates_count: 1 },
      result_summary: { knowledge_created_count: 1, knowledge_updated_count: 0 },
    });

    await recordKnowledgeUsage(repo, config, {
      workflow: "system_prepare_work",
      stage: "delivered_to_client",
      date: "2026-08-12",
      contexts: [{ task_id: "task-1", knowledge: knowledge(["sales-principles"]) }],
    });
    await recordKnowledgeUsage(repo, config, {
      workflow: "report_generate_output",
      stage: "injected_to_llm",
      date: "2026-08-12",
      provider: "codex_app_server",
      model: "test-model",
      contexts: [
        { task_id: "task-1", knowledge: knowledge(["sales-principles", "roi-validation"]) },
        { task_id: "task-2", knowledge: knowledge([]) },
      ],
    });

    const usage = await getKnowledgeUsageSummary(repo, { days: 30, limit: 10 });
    expect(usage).toMatchObject({
      stored_note_count: 1,
      accumulation_event_count: 1,
      accumulated_note_write_count: 1,
      last_accumulated_at: expect.any(String),
      event_count: 2,
      matched_event_count: 2,
      injected_event_count: 1,
      injected_note_count: 2,
      workflows: {
        system_prepare_work: { event_count: 1, injected_event_count: 0 },
        report_generate_output: { event_count: 1, injected_event_count: 1, injected_note_count: 2 },
      },
    });
    expect(usage.recent_events[0]).toMatchObject({
      workflow: "report_generate_output",
      stage: "injected_to_llm",
      task_ids: ["task-1", "task-2"],
      knowledge_ids: ["roi-validation", "sales-principles"],
      knowledge_by_task: [
        { task_id: "task-1", knowledge_ids: ["roi-validation", "sales-principles"] },
        { task_id: "task-2", knowledge_ids: [] },
      ],
    });
    expect(JSON.stringify(usage)).not.toContain("statement");
    expect(JSON.stringify(usage)).not.toContain("rationale");
  });

  it("records zero matches so unused Knowledge is distinguishable", async () => {
    const { repo, config } = await createTempRepo();
    await recordKnowledgeUsage(repo, config, {
      workflow: "briefing_generate_daily",
      stage: "injected_to_llm",
      contexts: [{ knowledge: knowledge([]) }],
    });

    await expect(getKnowledgeUsageSummary(repo)).resolves.toMatchObject({
      stored_note_count: 0,
      accumulation_event_count: 0,
      accumulated_note_write_count: 0,
      event_count: 1,
      matched_event_count: 0,
      injected_event_count: 1,
      injected_note_count: 0,
      recent_events: [{ matched_count: 0, injected_count: 0, knowledge_ids: [] }],
    });
  });
});
