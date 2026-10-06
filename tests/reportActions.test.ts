import { describe, expect, it } from "vitest";
import { generateReportEntriesFromActivities, updateReportEntry } from "#domain/reports/actions";
import { renderHtmlReport, renderMarkdownReport, renderTextReport } from "#domain/reports/render";
import { createTempRepo } from "./helpers.ts";

describe("report actions", () => {
  it("keeps newest monitoring activity values within deterministic report limits", async () => {
    const { repo } = await createTempRepo();
    const sourceActivity = {
      date: "2026-07-04",
      entries: Array.from({ length: 10 }, (_, index) => {
        const snapshot = index + 1;
        return {
          task_id: "task-1",
          done: [`snapshot ${snapshot}: fetched=${snapshot * 100}; status=${snapshot === 10 ? "running" : "stale"}`],
          next: [`next ${snapshot}`],
          confirm: [`confirm ${snapshot}`],
          external_summary: [`external ${snapshot}`],
        };
      }),
    };
    await repo.saveActivity("2026-07-04", sourceActivity, "seed");
    await repo.saveYaml(
      repo.layoutPath("reports", "2026-07-04.yaml"),
      {
        date: "2026-07-04",
        entries: [{ task_id: "task-1", today_diff_heading_only: true, today_diff_order: 9 }],
      },
      "seed-report",
    );

    const result = await generateReportEntriesFromActivities(repo, "2026-07-04");

    expect(result.source_activity_count).toBe(10);
    expect(result.entries).toEqual([
      expect.objectContaining({
        task_id: "task-1",
        done: ["snapshot 10: fetched=1000; status=running"],
        next: ["next 10"],
        today_diff_heading_only: true,
        today_diff_order: 9,
        source_activity_ids: expect.any(Array),
        source_activity_revision: expect.any(String),
        activity_generated_at: expect.any(String),
      }),
    ]);
    await expect(repo.loadReport("2026-07-04")).resolves.toEqual({
      date: "2026-07-04",
      entries: result.entries,
    });
    await expect(repo.loadActivity("2026-07-04")).resolves.toEqual(sourceActivity);
  });

  it("uses the latest non-empty done and next values independently for each task", async () => {
    const { repo } = await createTempRepo();
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [
          { task_id: "task-1", done: ["old done"], next: ["old next"] },
          { task_id: "task-1", done: ["new done"], next: [] },
          { task_id: "task-1", done: [""], next: ["new next"] },
        ],
      },
      "seed",
    );

    const result = await generateReportEntriesFromActivities(repo, "2026-07-04");

    expect(result.entries).toEqual([
      expect.objectContaining({ task_id: "task-1", done: ["new done"], next: ["new next"] }),
    ]);
  });

  it("does not change reports when generating with write disabled", async () => {
    const { repo } = await createTempRepo();
    await repo.saveActivity(
      "2026-07-04",
      { date: "2026-07-04", entries: [{ task_id: "task-1", done: ["new activity"] }] },
      "seed-activity",
    );
    const originalReport = {
      date: "2026-07-04",
      entries: [{ task_id: "task-1", done: ["existing report"], today_diff_order: 2 }],
    };
    await repo.saveYaml(repo.layoutPath("reports", "2026-07-04.yaml"), originalReport, "seed-report");

    const result = await generateReportEntriesFromActivities(repo, "2026-07-04", false);

    expect(result.entries).toEqual([
      expect.objectContaining({ task_id: "task-1", done: ["new activity"], today_diff_order: 2 }),
    ]);
    expect(result.save).toEqual({
      changed: false,
      path: repo.layoutPath("reports", "2026-07-04.yaml"),
    });
    await expect(repo.loadReport("2026-07-04")).resolves.toEqual(originalReport);
  });

  it("replaces an existing daily report entry", async () => {
    const { repo } = await createTempRepo();
    await repo.saveYaml(
      repo.layoutPath("reports", "2026-07-04.yaml"),
      {
        date: "2026-07-04",
        entries: [
          {
            task_id: "deltaco-store-info",
            done: ["古い長い差分。ここには詳細すぎる調査ログが大量に入っている。"],
            next: ["古い次アクション"],
            confirm: ["古い確認事項"],
          },
        ],
      },
      "seed-report",
    );

    const result = await updateReportEntry(repo, "2026-07-04", {
      task_id: "deltaco-store-info",
      mode: "replace",
      done: ["店舗情報差分を短く要約"],
      next: ["必要な追加確認だけ進める"],
    });
    const report = await repo.loadReport("2026-07-04");

    expect(result.entry).toEqual(
      expect.objectContaining({
        task_id: "deltaco-store-info",
        manual_override: true,
        done: ["店舗情報差分を短く要約"],
        next: ["必要な追加確認だけ進める"],
        source_activity_revision: expect.any(String),
      }),
    );
    expect(report.entries).toEqual([result.entry]);
    expect(JSON.stringify(report)).not.toContain("古い長い差分");
    expect(JSON.stringify(report)).not.toContain("古い確認事項");
  });

  it("appends report bullets without duplicating existing values", async () => {
    const { repo } = await createTempRepo();
    await repo.saveYaml(
      repo.layoutPath("reports", "2026-07-04.yaml"),
      {
        date: "2026-07-04",
        entries: [
          {
            task_id: "task-1",
            done: ["既存の完了"],
            next: ["既存の次アクション"],
          },
        ],
      },
      "seed-report",
    );

    await updateReportEntry(repo, "2026-07-04", {
      task_id: "task-1",
      mode: "append",
      done: ["既存の完了", "追加の完了"],
      next: ["既存の次アクション", "追加の次アクション"],
    });
    const report = await repo.loadReport("2026-07-04");

    expect(report.entries[0]).toEqual(
      expect.objectContaining({
        task_id: "task-1",
        manual_override: true,
        done: ["既存の完了", "追加の完了"],
        next: ["既存の次アクション", "追加の次アクション"],
        source_activity_revision: expect.any(String),
      }),
    );
  });

  it("deletes a report entry from the daily diff", async () => {
    const { repo } = await createTempRepo();
    await repo.saveYaml(
      repo.layoutPath("reports", "2026-07-04.yaml"),
      {
        date: "2026-07-04",
        entries: [
          { task_id: "keep", done: ["残す"] },
          { task_id: "remove", done: ["消す"] },
        ],
      },
      "seed-report",
    );

    const result = await updateReportEntry(repo, "2026-07-04", {
      task_id: "remove",
      mode: "delete",
    });
    const report = await repo.loadReport("2026-07-04");

    expect(result.removed).toEqual({ task_id: "remove", done: ["消す"] });
    expect(report.entries).toEqual([
      { task_id: "keep", done: ["残す"] },
      expect.objectContaining({ task_id: "remove", manual_override: true, report_exclude: true }),
    ]);
  });

  it("keeps a manual override across report regeneration and can clear it", async () => {
    const { repo } = await createTempRepo();
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [{ task_id: "task-1", done: ["raw journal value"], next: ["raw next"] }],
      },
      "seed",
    );

    await updateReportEntry(repo, "2026-07-04", {
      task_id: "task-1",
      mode: "replace",
      done: ["stable short summary"],
      next: ["stable next"],
    });
    await generateReportEntriesFromActivities(repo, "2026-07-04");
    await expect(repo.loadReport("2026-07-04")).resolves.toMatchObject({
      entries: [
        {
          task_id: "task-1",
          manual_override: true,
          done: ["stable short summary"],
          next: ["stable next"],
        },
      ],
    });

    await updateReportEntry(repo, "2026-07-04", { task_id: "task-1", mode: "clear_override" });
    await generateReportEntriesFromActivities(repo, "2026-07-04");
    await expect(repo.loadReport("2026-07-04")).resolves.toMatchObject({
      entries: [
        {
          task_id: "task-1",
          done: ["raw journal value"],
          next: ["raw next"],
        },
      ],
    });
  });

  it("keeps a persistent exclusion out of every renderer until cleared", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", project: "Project", title: "Excluded task", tier: 1, status: "todo" }],
      },
      "seed-tasks",
    );
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [{ task_id: "task-1", done: ["HIDDEN_REPORT_VALUE"], next: ["HIDDEN_NEXT_VALUE"] }],
      },
      "seed-activity",
    );

    await updateReportEntry(repo, "2026-07-04", { task_id: "task-1", mode: "delete" });
    await generateReportEntriesFromActivities(repo, "2026-07-04");
    const rendered = await Promise.all([
      renderTextReport(repo, "2026-07-04"),
      renderMarkdownReport(repo, "2026-07-04"),
      renderHtmlReport(repo, "2026-07-04"),
    ]);

    for (const output of rendered) {
      expect(output).not.toContain("Excluded task");
      expect(output).not.toContain("HIDDEN_REPORT_VALUE");
      expect(output).not.toContain("report_exclude");
    }

    await updateReportEntry(repo, "2026-07-04", { task_id: "task-1", mode: "clear_override" });
    await generateReportEntriesFromActivities(repo, "2026-07-04");
    await expect(renderTextReport(repo, "2026-07-04")).resolves.toContain("HIDDEN_REPORT_VALUE");
  });

  it("supports the compact-report workflow before regenerating the text report", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          {
            id: "deltaco-store-info",
            project: "DeltaCo",
            title: "店舗情報確認",
            tier: 1,
            status: "inProgress",
          },
        ],
      },
      "seed-tasks",
    );
    await repo.saveYaml(
      repo.layoutPath("reports", "2026-07-04.yaml"),
      {
        date: "2026-07-04",
        entries: [
          {
            task_id: "deltaco-store-info",
            done: ["長い差分: 調査過程、確認ログ、補足説明まで含めた文章"],
          },
        ],
      },
      "seed-report",
    );

    await updateReportEntry(repo, "2026-07-04", {
      task_id: "deltaco-store-info",
      mode: "replace",
      done: ["店舗情報の確認結果だけ短く反映"],
      next: ["未確認項目を追加で確認"],
    });
    const text = await renderTextReport(repo, "2026-07-04");

    expect(text).toContain("店舗情報の確認結果だけ短く反映");
    expect(text).toContain("未確認項目を追加で確認");
    expect(text).not.toContain("長い差分");
  });
});
