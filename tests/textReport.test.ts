import { describe, expect, it } from "vitest";
import { applyAgentUpdates, submitAgentUpdate } from "#domain/agent-updates/workflow";
import { generateReportEntriesFromActivities } from "#domain/reports/actions";
import {
  generateReport,
  generateTextReport,
  renderHtmlReport,
  renderMarkdownReport,
  renderTextReport,
} from "#domain/reports/render";
import { createTempRepo } from "./helpers.ts";

describe("text report", () => {
  it("includes a completed task when the selected date has a structured report entry", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      { tasks: [{ id: "done-task", title: "Completed", project: "Project", tier: 1, status: "done" }] },
      "seed",
    );
    await repo.saveReport(
      "2026-07-15",
      {
        date: "2026-07-15",
        entries: [{ task_id: "done-task", done: ["Completed today"] }],
      },
      "seed",
    );

    const text = await renderTextReport(repo, "2026-07-15");

    expect(text).toContain("★ [ Project ] Completed");
    expect(text).toContain("Completed today");
  });

  it("keeps a user-facing URL even when it appeared in the previous report", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", project: "Project", title: "Task", tier: 1, status: "inProgress" }],
      },
      "seed",
    );
    const entry = { task_id: "task-1", done: ["公開レポート: https://example.com/report"] };
    await repo.saveReport("2026-07-03", { date: "2026-07-03", entries: [entry] }, "seed");
    await generateTextReport(repo, "2026-07-03", true);
    await repo.saveReport("2026-07-04", { date: "2026-07-04", entries: [entry] }, "seed");

    const text = await renderTextReport(repo, "2026-07-04");

    expect(text).toContain("公開レポート: https://example.com/report");
  });

  it("renders the text report structure", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          {
            id: "daily",
            project: "仕事探し",
            title: "daily",
            tier: 1,
            status: "inProgress",
            context: "contexts/daily.md",
          },
          {
            id: "todo-1",
            project: "ROOXIM移行作業",
            title: "Workspace",
            tier: 3,
            status: "todo",
            due: "2026-07-31",
            context: "contexts/todo-1.md",
          },
        ],
      },
      "seed",
    );
    await repo.saveTaskContext(
      { id: "daily", title: "daily", context: "contexts/daily.md" },
      { data: { compact_summary: ["応募状況を確認中", "面談準備が必要"] }, body: "" },
      "seed-context",
    );
    await repo.saveTaskContext(
      { id: "todo-1", title: "Workspace", context: "contexts/todo-1.md" },
      { data: { compact_summary: ["データサルベージと契約更新停止を進める"] }, body: "" },
      "seed-context",
    );
    await repo.saveYaml(
      repo.layoutPath("reports", "2026-07-04.yaml"),
      {
        date: "2026-07-04",
        entries: [
          {
            task_id: "daily",
            done: ["MCPでテキストレポート形式を再現"],
            next: ["実データで生成確認する"],
            confirm: ["旧形式との差分を見る"],
          },
        ],
      },
      "seed-report",
    );

    const text = await renderTextReport(repo, "2026-07-04");

    expect(text).toContain("2026/07/04（土）");
    expect(text).toContain("tasks: 2");
    expect(text).toContain("  - ●TODO       : 1");
    expect(text).toContain("  - ▶inProgress : 1");
    expect(text).toContain("本日差分・状況報告");
    expect(text).toContain("▶ [ 仕事探し ] (daily)");
    expect(text).toContain("  - やったこと:");
    expect(text).toContain("      - MCPでテキストレポート形式を再現");
    expect(text).toContain("■Tier1（優先度高）");
    expect(text).toContain("■Tier3（優先度が低い）");
    expect(text).toContain("● [ ROOXIM移行作業 ] Workspace (~7/31)");
  });

  it("groups every report format by project in deterministic task order", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          { id: "rhoco-task", project: "rhoco", title: "Robot task", tier: 1, status: "todo" },
          { id: "deltaco-later", project: "DeltaCo", title: "Later task", tier: 1, status: "todo" },
          { id: "deltaco-first", project: "DeltaCo", title: "First task", tier: 1, status: "todo" },
          { id: "deltaco-progress", project: "DeltaCo", title: "Progress task", tier: 1, status: "inProgress" },
        ],
      },
      "seed",
    );
    await repo.saveReport(
      "2026-08-19",
      {
        date: "2026-08-19",
        entries: [
          { task_id: "deltaco-later", done: ["later"], today_diff_order: 2 },
          { task_id: "deltaco-first", done: ["first"], today_diff_order: 1 },
          { task_id: "deltaco-progress", done: ["progress"] },
        ],
      },
      "seed",
    );

    const [text, markdown, html] = await Promise.all([
      renderTextReport(repo, "2026-08-19"),
      renderMarkdownReport(repo, "2026-08-19"),
      renderHtmlReport(repo, "2026-08-19"),
    ]);

    const tierText = text.slice(text.indexOf("■Tier1"));
    expect(tierText.indexOf("-- DeltaCo --")).toBeLessThan(tierText.indexOf("-- rhoco --"));
    expect(tierText.indexOf("First task")).toBeLessThan(tierText.indexOf("Later task"));
    expect(tierText.indexOf("Later task")).toBeLessThan(tierText.indexOf("Progress task"));
    expect((tierText.match(/-- DeltaCo --/g) ?? []).length).toBe(1);
    expect(markdown).toContain("### DeltaCo\n\n#### ● [ DeltaCo ] First task");
    expect(markdown.indexOf("### DeltaCo")).toBeLessThan(markdown.indexOf("### rhoco"));
    expect(html).toContain("<h3>DeltaCo</h3>");
    expect(html.indexOf("<h3>DeltaCo</h3>")).toBeLessThan(html.indexOf("<h3>rhoco</h3>"));
  });

  it("excludes an explicitly stopped task from every report format", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          {
            id: "stopped-task",
            project: "Project",
            title: "Suspended work",
            tier: 3,
            status: "blocked",
          },
        ],
      },
      "seed",
    );
    await repo.saveReport(
      "2026-07-23",
      {
        date: "2026-07-23",
        entries: [{ task_id: "stopped-task", done: ["Work was explicitly stopped."] }],
      },
      "seed",
    );

    const [text, markdown, html] = await Promise.all([
      renderTextReport(repo, "2026-07-23"),
      renderMarkdownReport(repo, "2026-07-23"),
      renderHtmlReport(repo, "2026-07-23"),
    ]);

    expect(text).toContain("tasks: 0");
    expect(markdown).toContain("- tasks: 0");
    expect(html).toContain("<li>tasks: 0</li>");
    expect(text).not.toContain("Suspended work");
    expect(markdown).not.toContain("Suspended work");
    expect(html).not.toContain("Suspended work");
    expect(text).not.toContain("Stopped");
    expect(text).not.toContain("Waiting");
  });

  it("writes the text report to outputs/text", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", project: "Project", title: "Task", tier: 1, status: "todo" }],
      },
      "seed",
    );

    const result = await generateTextReport(repo, "2026-07-04", true);

    expect(result.path).toBe(repo.layoutPath("outputs", "text", "2026-07-04.txt"));
    await expect(repo.loadOutput("text", "2026-07-04")).resolves.toBe(result.text);
  });

  it("renders and writes markdown reports", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", project: "Project", title: "Task", tier: 1, status: "todo" }],
      },
      "seed",
    );

    const markdown = await renderMarkdownReport(repo, "2026-07-04");
    const result = await generateReport(repo, "2026-07-04", true, "markdown");

    expect(markdown).toContain("# 2026/07/04（土）");
    expect(markdown).not.toContain("## 本日差分・状況報告");
    expect(markdown).toContain("## Tier1（優先度高）");
    expect(result.path).toBe(repo.layoutPath("outputs", "markdown", "2026-07-04.md"));
    await expect(repo.loadOutput("markdown", "2026-07-04", "md")).resolves.toBe(result.text);
  });

  it("renders and writes html reports", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", project: "Project", title: "Task", tier: 1, status: "todo" }],
      },
      "seed",
    );

    const html = await renderHtmlReport(repo, "2026-07-04");
    const result = await generateReport(repo, "2026-07-04", true, "html");

    expect(html).toContain("<!doctype html>");
    expect(html).not.toContain("<h2>本日差分・状況報告</h2>");
    expect(html).toContain("<h2>Tier1（優先度高）</h2>");
    expect(result.path).toBe(repo.layoutPath("outputs", "html", "2026-07-04.html"));
    await expect(repo.loadOutput("html", "2026-07-04", "html")).resolves.toBe(result.text);
  });

  it("renders applied agent updates in the daily diff section", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          {
            id: "job-search-daily",
            project: "仕事探し",
            title: "daily",
            tier: 1,
            status: "inProgress",
            context: "contexts/job-search-daily.md",
          },
        ],
      },
      "seed",
    );
    await repo.saveTaskContext(
      { id: "job-search-daily", title: "daily", context: "contexts/job-search-daily.md" },
      { data: { compact_summary: ["応募状況を確認中"] }, body: "" },
      "seed-context",
    );

    const { update } = await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "test-session",
      source: "test",
      task_id: "job-search-daily",
      summary: "面談準備を整理",
      done: ["経歴書画面共有と音声環境の確認が必要なことを整理"],
      next: ["経歴書の画面共有準備を確認する"],
      confidence: "high",
    });
    await applyAgentUpdates(repo, "2026-07-04", [update.update_id]);
    await generateReportEntriesFromActivities(repo, "2026-07-04");

    const text = await renderTextReport(repo, "2026-07-04");

    expect(text).toContain("本日差分・状況報告");
    expect(text).toContain("  - やったこと:");
    expect(text).toContain("      - 経歴書画面共有と音声環境の確認が必要なことを整理");
    expect(text).toContain("  - これからやること:");
    expect(text).toContain("      - 経歴書の画面共有準備を確認する");
  });

  it("uses legacy report task_summary as a tier task list summary fallback", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          {
            id: "task-1",
            project: "Project",
            title: "Task",
            tier: 1,
            status: "inProgress",
            context: "contexts/task-1.md",
          },
        ],
      },
      "seed",
    );
    await repo.saveTaskContext(
      { id: "task-1", title: "Task", context: "contexts/task-1.md" },
      { data: { compact_summary: ["古い概要"] }, body: "" },
      "seed-context",
    );
    await repo.saveReport(
      "2026-07-04",
      { date: "2026-07-04", entries: [{ task_id: "task-1", task_summary: ["LLMで更新したTier一覧概要"] }] },
      "seed-report",
    );

    const text = await renderTextReport(repo, "2026-07-04");

    expect(text).toContain("LLMで更新したTier一覧概要");
    expect(text).not.toContain("古い概要");
  });

  it("prefers report task snapshots over current task data in every renderer", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          {
            id: "task-1",
            project: "現在のプロジェクト",
            title: "現在のタスク名",
            tier: 3,
            status: "done",
            context: "contexts/task-1.md",
          },
        ],
      },
      "seed",
    );
    await repo.saveTaskContext(
      { id: "task-1", title: "現在のタスク名", context: "contexts/task-1.md" },
      { data: { compact_summary: ["現在の要約"] }, body: "" },
      "seed-context",
    );
    await repo.saveReport(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [
          {
            task_id: "task-1",
            task_summary: ["旧形式の要約"],
            task_snapshot: {
              project: "過去のプロジェクト",
              title: "過去のタスク名",
              tier: 2,
              status: "todo",
              summary: ["過去の要約"],
            },
          },
        ],
      },
      "seed-report",
    );

    const rendered = await Promise.all([
      renderTextReport(repo, "2026-07-04"),
      renderMarkdownReport(repo, "2026-07-04"),
      renderHtmlReport(repo, "2026-07-04"),
    ]);

    for (const output of rendered) {
      expect(output).toContain("● [ 過去のプロジェクト ] 過去のタスク名");
      expect(output).toContain("過去の要約");
      expect(output).toContain("Tier2（すぐ実行できないもの）");
      expect(output).not.toContain("現在のプロジェクト");
      expect(output).not.toContain("現在のタスク名");
      expect(output).not.toContain("現在の要約");
      expect(output).not.toContain("旧形式の要約");
    }
  });

  it("renders a historical snapshot after the current task was deleted", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks({ tasks: [] }, "seed-empty-current-tasks");
    await repo.saveReport(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [
          {
            task_id: "deleted-task",
            done: ["当時の作業"],
            task_snapshot: {
              title: "削除済みタスク",
              project: "過去案件",
              tier: 1,
              status: "inProgress",
              summary: ["削除前時点の状態"],
            },
          },
        ],
      },
      "seed-historical-snapshot",
    );

    const text = await renderTextReport(repo, "2026-07-04");

    expect(text).toContain("削除済みタスク");
    expect(text).toContain("削除前時点の状態");
    expect(text).toContain("当時の作業");
  });

  it("excludes a logically deleted duplicate from generated entries and every report format", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          { id: "canonical", title: "正規タスク", project: "Project", tier: 1, status: "inProgress" },
          { id: "duplicate", title: "重複タスク", project: "Project", tier: 1, status: "inProgress", deleted: true },
        ],
      },
      "seed-tasks",
    );
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [
          { task_id: "canonical", done: ["正規の更新"] },
          { task_id: "duplicate", done: ["重複した更新"] },
        ],
      },
      "seed-activity",
    );
    await repo.saveReport(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [
          { task_id: "canonical", done: ["正規の更新"] },
          { task_id: "duplicate", done: ["重複した更新"], manual_override: true },
        ],
      },
      "seed-report",
    );

    const generated = await generateReportEntriesFromActivities(repo, "2026-07-04", false);
    const rendered = await Promise.all([
      renderTextReport(repo, "2026-07-04"),
      renderMarkdownReport(repo, "2026-07-04"),
      renderHtmlReport(repo, "2026-07-04"),
    ]);

    expect(generated.source_activity_count).toBe(1);
    expect(generated.entries.map((entry) => entry.task_id)).toEqual(["canonical"]);
    for (const output of rendered) {
      expect(output).toContain("正規タスク");
      expect(output).not.toContain("重複タスク");
      expect(output).not.toContain("重複した更新");
    }
  });
});
