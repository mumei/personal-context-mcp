import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempRepo } from "./helpers.ts";
import { resolveWeeklyPeriod } from "#domain/reports/weekly/range";
import { loadWeeklySource } from "#domain/reports/weekly/source";
import { generateWeeklyReport, readWeeklyReport } from "#domain/reports/weekly/generation";
import { listWeeklyHistory } from "#domain/reports/weekly/history";
import { updateReportSettings } from "#infra/config/reportSettings";
import { createTaskMcpWebServer, stopTaskMcpWebServer } from "#webServer";
import type { AddressInfo } from "node:net";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function fixture() {
  const result = await createTempRepo();
  await result.repo.saveTasks({ tasks: [{ id: "t", title: "Current title", project: "P", status: "done" }] }, "seed");
  await result.repo.saveActivity(
    "2026-10-05",
    {
      date: "2026-10-05",
      entries: [
        {
          task_id: "t",
          done: ["Completed design https://example.com/design", "Completed design https://example.com/design"],
          next: ["Implement"],
        },
      ],
    },
    "seed",
  );
  return result;
}
const response = () =>
  Promise.resolve({
    text: JSON.stringify({ tasks: [{ task_id: "t", done: ["Designed"], next: ["Implement"] }] }),
    provider: "claude_cli" as const,
    model: "test-model",
  });

describe("weekly saved history", () => {
  it("distinguishes ungenerated periods from saved versions and preserves old weekday ranges", async () => {
    const { repo, config } = await fixture();
    const initial = await listWeeklyHistory(repo, config);
    expect(initial.versions).toEqual([]);
    expect(initial.periods).toContainEqual({
      week_start: "2026-10-05",
      week_end: "2026-10-11",
      through: "2026-10-08",
      can_generate: true,
    });
    await generateWeeklyReport(repo, config, "2026-10-05", "2026-10-06", response);
    await generateWeeklyReport(repo, config, "2026-10-05", "2026-10-08", response);
    await updateReportSettings(repo, { week_start_day: 0 });
    const history = await listWeeklyHistory(repo, config);
    expect(history.versions.map((item) => item.through)).toEqual(["2026-10-08", "2026-10-06"]);
    expect(history.periods).toContainEqual({
      week_start: "2026-10-05",
      week_end: "2026-10-11",
      through: "2026-10-08",
      can_generate: false,
    });
    const old = await readWeeklyReport(repo, config, "2026-10-05", "2026-10-06");
    expect(old).toMatchObject({
      exists: true,
      week_start: "2026-10-05",
      week_end: "2026-10-11",
      through: "2026-10-06",
    });
    expect(old.text.text).toContain("Designed");
  });

  it("rejects mismatched stored identity instead of displaying a different period", async () => {
    const { repo, config } = await fixture();
    await generateWeeklyReport(repo, config, "2026-10-05", "2026-10-06", response);
    const path = repo.pathFor(repo.layoutName("outputs"), "weekly", "2026-10-05_2026-10-06", "report.json");
    const record = JSON.parse(
      (await repo.readTextIfExists(repo.layoutName("outputs"), "weekly", "2026-10-05_2026-10-06", "report.json"))!,
    );
    record.period.week_start = "2026-10-04";
    await repo.writeText(path, JSON.stringify(record), "test");
    await expect(readWeeklyReport(repo, config, "2026-10-05", "2026-10-06")).rejects.toThrow("identity");
    await expect(listWeeklyHistory(repo, config)).rejects.toThrow("identity");
  });
});

describe("weekly period boundaries", () => {
  it("uses the operational timezone and rollover, not the calendar date", () => {
    const config = { timezone: "Asia/Tokyo", activityRolloverHour: 4 };
    expect(resolveWeeklyPeriod(config, 1, undefined, undefined, new Date("2026-10-07T18:00:00Z"))).toMatchObject({
      week_start: "2026-10-05",
      week_end: "2026-10-11",
      today: "2026-10-07",
      through: "2026-10-07",
      provisional: true,
    });
    expect(resolveWeeklyPeriod(config, 1, undefined, undefined, new Date("2026-10-07T19:00:00Z"))).toMatchObject({
      through: "2026-10-08",
    });
  });
  it.each([0, 1, 2, 3, 4, 5, 6])("supports weekday %i across year boundaries", (weekday) => {
    const period = resolveWeeklyPeriod(
      { timezone: "UTC", activityRolloverHour: 0 },
      weekday,
      "2025-01-01",
      undefined,
      new Date("2026-10-08T12:00:00Z"),
    );
    expect(new Date(`${period.week_start}T00:00:00Z`).getUTCDay()).toBe(weekday);
    expect(Date.parse(period.week_end) - Date.parse(period.week_start)).toBe(6 * 86400000);
    expect(period.provisional).toBe(false);
  });
  it("rejects impossible dates, future work and out-of-week through dates", () => {
    const config = { timezone: "UTC", activityRolloverHour: 0 };
    const now = new Date("2026-10-08T12:00:00Z");
    for (const [week, through] of [
      ["2026-02-30", undefined],
      ["2026-10-12", undefined],
      ["2026-10-05", "2026-10-09"],
      ["2026-10-05", "2026-10-04"],
    ]) {
      expect(() => resolveWeeklyPeriod(config, 1, week, through, now)).toThrow();
    }
  });
});

describe("weekly generation", () => {
  it("preserves daily sources, URLs and independent through-date artifacts", async () => {
    const { repo, config } = await fixture();
    const activity = await repo.loadActivity("2026-10-05");
    const tasks = await repo.loadTasks();
    const report = await repo.loadReport("2026-10-05");
    const first = await generateWeeklyReport(repo, config, "2026-10-05", "2026-10-06", response);
    expect(first.text.text).toContain("https://example.com/design");
    expect(first.missing_dates).toEqual(["2026-10-06"]);
    expect(first.text.text).toContain("未記録は作業なしを意味しません");
    expect(first.provisional).toBe(true);
    await generateWeeklyReport(repo, config, "2026-10-05", "2026-10-07", response);
    expect((await readWeeklyReport(repo, config, "2026-10-05", "2026-10-06")).text.text).toBe(first.text.text);
    expect(await repo.loadActivity("2026-10-05")).toEqual(activity);
    expect(await repo.loadTasks()).toEqual(tasks);
    expect(await repo.loadReport("2026-10-05")).toEqual(report);
  });
  it("collects only dated facts, deduplicates journal lines and honors exclusions", async () => {
    const { repo, config } = await fixture();
    await repo.saveTasks(
      {
        tasks: [
          { id: "t", title: "Current title", status: "done", activity_aliases: ["legacy"] },
          { id: "excluded", title: "Excluded", status: "inProgress", report_exclude: true },
          { id: "stopped", title: "Stopped", status: "blocked" },
        ],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-10-06",
      {
        date: "2026-10-06",
        entries: [
          { task_id: "legacy", done: ["Historical work"] },
          { task_id: "excluded", done: ["Secret excluded"] },
          { task_id: "stopped", done: ["Stopped work"] },
        ],
      },
      "seed",
    );
    const period = resolveWeeklyPeriod(config, 1, "2026-10-05", "2026-10-06", new Date("2026-10-08T12:00:00Z"));
    const { source } = await loadWeeklySource(repo, period, "2026-10-08T12:00:00Z");
    expect(source.tasks).toHaveLength(1);
    expect(source.tasks[0].days[0].done).toHaveLength(1);
    expect(source.tasks[0].days[1].done).toEqual(["Historical work"]);
    expect(JSON.stringify(source)).not.toContain("status");
    expect(JSON.stringify(source)).not.toContain("Secret excluded");
  });
  it("does not leak future journal work via a dated report fallback", async () => {
    const { repo, config } = await fixture();
    await repo.saveActivity(
      "2026-10-05",
      { date: "2026-10-05", entries: [{ task_id: "t", occurred_at: "2099-01-01T00:00:00Z", done: ["Future"] }] },
      "seed",
    );
    await repo.saveReport("2026-10-05", { date: "2026-10-05", entries: [{ task_id: "t", done: ["Future"] }] }, "seed");
    const period = resolveWeeklyPeriod(config, 1, "2026-10-05", "2026-10-05");
    expect((await loadWeeklySource(repo, period, new Date().toISOString())).source.tasks).toEqual([]);
  });
  it("does not fall back on provider failure or destroy existing artifacts", async () => {
    const { repo, config } = await fixture();
    const first = await generateWeeklyReport(repo, config, "2026-10-05", "2026-10-06", response);
    await expect(
      generateWeeklyReport(repo, config, "2026-10-05", "2026-10-06", async () => {
        throw new Error("Provider failed");
      }),
    ).rejects.toThrow("Provider failed");
    expect((await readWeeklyReport(repo, config, "2026-10-05", "2026-10-06")).text.text).toBe(first.text.text);
  });
  it("rejects source changes or week-setting changes during generation", async () => {
    const { repo, config } = await fixture();
    await expect(
      generateWeeklyReport(repo, config, "2026-10-05", "2026-10-06", async () => {
        await repo.saveActivity(
          "2026-10-05",
          { date: "2026-10-05", entries: [{ task_id: "t", done: ["Changed"] }] },
          "seed",
        );
        return response();
      }),
    ).rejects.toThrow("source changed");
    await expect(
      generateWeeklyReport(repo, config, "2026-10-05", "2026-10-06", async () => {
        await updateReportSettings(repo, { week_start_day: 0 });
        return response();
      }),
    ).rejects.toThrow("source changed");
  });
  it("saves an honest empty-period result without calling the provider", async () => {
    const { repo, config } = await createTempRepo();
    const generate = vi.fn(response);
    const result = await generateWeeklyReport(repo, config, "2026-09-28", undefined, generate);
    expect(generate).not.toHaveBeenCalled();
    expect(result.missing_dates).toHaveLength(7);
    expect(result.provisional).toBe(false);
    expect(result.text.text).toContain("記録はありません");
  });
  it("rolls back all weekly files when one format fails to save", async () => {
    const { repo, config } = await fixture();
    const original = repo.writeText.bind(repo);
    vi.spyOn(repo, "writeText").mockImplementation(async (path, text, reason) => {
      if (path.endsWith("report.md")) throw new Error("Disk failure");
      return original(path, text, reason);
    });
    await expect(generateWeeklyReport(repo, config, "2026-10-05", "2026-10-06", response)).rejects.toThrow(
      "Disk failure",
    );
    expect((await readWeeklyReport(repo, config, "2026-10-05", "2026-10-06")).exists).toBe(false);
    expect(await repo.readTextIfExists("outputs", "weekly", "2026-10-05_2026-10-06", "report.txt")).toBeNull();
  });
  it("serves and generates the same weekly artifacts through the Web API", async () => {
    const { repo, config } = await createTempRepo();
    const server = createTaskMcpWebServer(repo, config);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect(await (await fetch(`${base}/api/settings/report`)).json()).toMatchObject({ week_start_day: 1 });
      expect((await fetch(`${base}/api/report/weekly?week=2026-02-30`)).status).toBe(400);
      const result = await fetch(`${base}/api/report/weekly/generate`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ week: "2026-09-28" }),
      });
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ exists: true, through: "2026-10-04", provisional: false });
      const read = await fetch(`${base}/api/report/weekly?week=2026-09-28`);
      expect(await read.json()).toMatchObject({
        exists: true,
        markdown: { html: expect.stringContaining("週次レポート") },
      });
      await updateReportSettings(repo, { week_start_day: 0 });
      const history = await (await fetch(`${base}/api/report/weekly/history`)).json();
      expect(history.versions).toEqual([expect.objectContaining({ week_start: "2026-09-28", through: "2026-10-04" })]);
      const historical = await fetch(`${base}/api/report/weekly?week=2026-09-28&through=2026-10-04`);
      expect(await historical.json()).toMatchObject({ exists: true, week_start: "2026-09-28", week_end: "2026-10-04" });
    } finally {
      await stopTaskMcpWebServer(server);
    }
  });
});
