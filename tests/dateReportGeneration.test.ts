import { describe, expect, it, vi } from "vitest";
import { generateDateReportWithCodex } from "#domain/reports/generation";
import { loadReportActivitySyncState } from "#domain/reports/activitySync";
import { getKnowledgeUsageSummary } from "#infra/audit/knowledgeUsage";
import { createTempRepo } from "./helpers.ts";

describe("generateDateReportWithCodex", () => {
  it("does not report excluded tasks as unreflected Activity", async () => {
    const { repo } = await createTempRepo();
    const date = "2026-07-24";
    await repo.saveTasks(
      {
        tasks: [
          { id: "visible", title: "Visible task", status: "inProgress" },
          { id: "excluded", title: "Excluded task", status: "inProgress", report_exclude: true },
        ],
      },
      "seed",
    );
    await repo.saveActivity(
      date,
      {
        date,
        entries: [
          { activity_id: "visible-1", task_id: "visible", done: ["Visible work"] },
          { activity_id: "excluded-1", task_id: "excluded", done: ["Excluded work"] },
        ],
      },
      "seed",
    );

    await expect(loadReportActivitySyncState(repo, date)).resolves.toMatchObject({
      pending_count: 1,
      tasks: [{ task_id: "visible", pending_activity_count: 1 }],
    });
  });

  it("reflects immutable Activity entries recorded under a declared legacy task id", async () => {
    const { repo, config } = await createTempRepo();
    const date = "2026-07-15";
    await repo.saveTasks(
      {
        tasks: [
          {
            id: "task-current",
            title: "Current task",
            status: "inProgress",
            activity_aliases: ["task-legacy"],
          },
        ],
      },
      "seed",
    );
    await repo.saveActivity(
      date,
      { date, entries: [{ activity_id: "legacy-1", task_id: "task-legacy", done: ["Legacy work"] }] },
      "seed",
    );

    await expect(loadReportActivitySyncState(repo, date)).resolves.toMatchObject({
      pending_count: 1,
      tasks: [{ task_id: "task-current", pending_activity_count: 1 }],
    });
    const result = await generateDateReportWithCodex(repo, config, date, "text", async (request) => {
      expect(request.prompt).toContain("Legacy work");
      return {
        text: JSON.stringify({
          tasks: [
            {
              task_id: "task-current",
              report_entry: { done: ["Legacy work"], next: [] },
              task_summary: ["Legacy work reflected"],
            },
          ],
        }),
      };
    });

    expect(result.task_ids).toEqual(["task-current"]);
    await expect(loadReportActivitySyncState(repo, date)).resolves.toMatchObject({ pending_count: 0, tasks: [] });
    await expect(repo.loadActivity(date)).resolves.toEqual({
      date,
      entries: [expect.objectContaining({ task_id: "task-legacy", done: ["Legacy work"] })],
    });
  });

  it("regenerates structured report data from the latest activity before rendering", async () => {
    const { repo, config } = await createTempRepo();
    const date = "2026-07-15";
    await repo.saveTasks(
      {
        tasks: [
          {
            id: "meeting",
            title: "rhoco 定例ミーティング（2026-07-15）",
            project: "rhoco",
            tier: 1,
            status: "done",
          },
        ],
      },
      "seed",
    );
    await repo.saveActivity(
      date,
      {
        date,
        entries: [{ task_id: "meeting", done: ["rhocoとの定例ミーティングを実施した"] }],
      },
      "seed",
    );
    await repo.saveReport(
      date,
      {
        date,
        entries: [{ task_id: "meeting", done: ["古い表示"] }],
      },
      "seed",
    );
    await repo.saveGlobalMemory({ preferences: ["結論を先に書く"], rules: ["URLを省略しない"] }, "seed-global-memory");
    await repo.saveKnowledgeNote(
      {
        id: "rhoco-platform",
        title: "rhoco platform",
        type: "system",
        aliases: ["rhoco"],
        tags: ["platform"],
        summary: "rhocoの共通知識",
        evidence: [{ statement: "rhocoは共通基盤である", rationale: "複数タスクで共通して利用する" }],
        relations: [],
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z",
        body: "rhocoで共通して参照する背景情報。",
      },
      "seed-knowledge",
    );

    const result = await generateDateReportWithCodex(repo, config, date, "text", async (request) => {
      expect(request.prompt).toContain("rhocoとの定例ミーティングを実施した");
      expect(request.prompt).toContain('"preferences":["結論を先に書く"]');
      expect(request.prompt).toContain('"rules":["URLを省略しない"]');
      expect(request.prompt).toContain("mandatory user-wide output constraints");
      expect(request.prompt).toContain("relevant_knowledge");
      expect(request.prompt).toContain("rhocoの共通知識");
      return {
        text: JSON.stringify({
          tasks: [
            {
              task_id: "meeting",
              report_entry: { done: ["rhocoとの定例ミーティングを実施した"], next: [] },
              task_summary: ["定例ミーティングを完了"],
            },
          ],
        }),
      };
    });

    expect(result.text).toContain("rhocoとの定例ミーティングを実施した");
    expect(result.text).toContain("★ [ rhoco ] rhoco 定例ミーティング（2026-07-15）");
    expect(result.text).not.toContain("古い表示");
    await expect(repo.loadReport(date)).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          task_id: "meeting",
          done: ["rhocoとの定例ミーティングを実施した"],
          source_activity_revision: expect.any(String),
          source_activity_ids: expect.any(Array),
          task_snapshot: expect.objectContaining({ status: "done" }),
        }),
      ],
    });
    await expect(loadReportActivitySyncState(repo, date)).resolves.toMatchObject({ pending_count: 0, tasks: [] });
    await expect(getKnowledgeUsageSummary(repo)).resolves.toMatchObject({
      injected_event_count: 1,
      injected_note_count: 1,
      recent_events: [
        expect.objectContaining({
          workflow: "report_generate_output",
          stage: "injected_to_llm",
          knowledge_ids: ["rhoco-platform"],
        }),
      ],
    });

    const shouldNotCallLlm = vi.fn(async () => {
      throw new Error("LLM should not be called for a current report");
    });
    const current = await generateDateReportWithCodex(repo, config, date, "text", shouldNotCallLlm);
    expect(current.task_ids).toEqual([]);
    expect(shouldNotCallLlm).not.toHaveBeenCalled();
  });

  it("updates only the task with newly appended activity and retains its manual override marker", async () => {
    const { repo, config } = await createTempRepo();
    const date = "2026-07-15";
    await repo.saveTasks(
      {
        tasks: [
          { id: "task-1", title: "Task 1", status: "inProgress" },
          { id: "task-2", title: "Task 2", status: "inProgress" },
        ],
      },
      "seed",
    );
    await repo.saveActivity(
      date,
      {
        date,
        entries: [
          { activity_id: "a-1", task_id: "task-1", done: ["Task 1 initial"] },
          { activity_id: "a-2", task_id: "task-2", done: ["Task 2 initial"] },
        ],
      },
      "seed",
    );
    const initialResponse = (taskIds: string[]) =>
      JSON.stringify({
        tasks: taskIds.map((taskId) => ({
          task_id: taskId,
          report_entry: { done: [`${taskId} generated`], next: [] },
          task_summary: [`${taskId} summary`],
        })),
      });
    await generateDateReportWithCodex(repo, config, date, "text", async () => ({
      text: initialResponse(["task-1", "task-2"]),
    }));
    const report = await repo.loadReport(date);
    const task1 = report.entries.find((entry) => entry.task_id === "task-1");
    if (!task1) throw new Error("task-1 report missing");
    task1.manual_override = true;
    task1.done = ["Manual Task 1 text"];
    await repo.saveReport(date, report, "manual-edit");
    await repo.saveActivity(
      date,
      {
        date,
        entries: [
          { activity_id: "a-1", task_id: "task-1", done: ["Task 1 initial"] },
          { activity_id: "a-2", task_id: "task-2", done: ["Task 2 initial"] },
          { activity_id: "a-3", task_id: "task-1", done: ["Task 1 new activity"] },
        ],
      },
      "append",
    );

    const generated = await generateDateReportWithCodex(repo, config, date, "text", async (request) => {
      expect(request.prompt).toContain("Task 1 new activity");
      expect(request.prompt).toContain("Manual Task 1 text");
      expect(request.prompt).not.toContain("Task 2 initial");
      return { text: initialResponse(["task-1"]).replace("task-1 generated", "Task 1 refreshed") };
    });

    expect(generated.task_ids).toEqual(["task-1"]);
    const updated = await repo.loadReport(date);
    expect(updated.entries.find((entry) => entry.task_id === "task-1")).toMatchObject({
      manual_override: true,
      done: ["Task 1 refreshed"],
      source_activity_ids: ["a-1", "a-3"],
    });
    expect(updated.entries.find((entry) => entry.task_id === "task-2")?.done).toEqual(["task-2 generated"]);
    await expect(loadReportActivitySyncState(repo, date)).resolves.toMatchObject({ pending_count: 0 });
  });

  it("restores URLs omitted while Web-style pending activity generation reorganizes an existing entry", async () => {
    const { repo, config } = await createTempRepo();
    const date = "2026-07-18";
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Published report", status: "inProgress" }] }, "seed");
    await repo.saveActivity(
      date,
      {
        date,
        entries: [
          {
            activity_id: "activity-1",
            task_id: "task-1",
            done: ["公開URL: https://example.com/latest"],
            next: ["確認URL: https://example.com/review"],
          },
        ],
      },
      "seed",
    );
    await repo.saveReport(
      date,
      {
        date,
        entries: [{ task_id: "task-1", done: ["既存URL: https://example.com/existing"] }],
      },
      "seed",
    );

    await generateDateReportWithCodex(repo, config, date, "text", async (request) => {
      expect(request.prompt).toContain("Preserve every user-facing HTTP/HTTPS URL");
      return {
        text: JSON.stringify({
          tasks: [
            {
              task_id: "task-1",
              report_entry: { done: ["公開内容を更新した"], next: ["内容を確認する"] },
              task_summary: ["公開内容を更新中"],
            },
          ],
        }),
      };
    });

    const entry = (await repo.loadReport(date)).entries[0];
    expect(entry?.done).toEqual([
      "公開内容を更新した",
      "既存URL: https://example.com/existing",
      "公開URL: https://example.com/latest",
    ]);
    expect(entry?.next).toEqual(["内容を確認する", "確認URL: https://example.com/review"]);
  });
});
