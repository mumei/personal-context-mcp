import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildActivityCalendar } from "#web/activity/calendar";
import { createTempRepo } from "./helpers.ts";

afterEach(() => vi.useRealTimers());

describe("Activity calendar local-date projection", () => {
  it.each([
    ["Asia/Tokyo", "2026-07-31T16:30:00Z", "2026-08-01"],
    ["America/Los_Angeles", "2026-08-01T01:30:00Z", "2026-07-31"],
    ["Pacific/Kiritimati", "2026-07-31T12:00:00Z", "2026-08-01"],
    ["America/New_York", "2026-03-08T06:30:00Z", "2026-03-08"],
    ["America/New_York", "2026-03-08T07:30:00Z", "2026-03-08"],
    ["America/New_York", "2026-11-01T05:30:00Z", "2026-11-01"],
    ["America/New_York", "2026-11-01T06:30:00Z", "2026-11-01"],
  ])("projects %s timestamps by calendar day, not storage/work day", async (timezone, occurredAt, calendarDate) => {
    const { repo, config } = await createTempRepo();
    config.timezone = timezone;
    config.activityRolloverHour = 4;
    const storageDate = "2026-01-01";
    await repo.saveActivity(
      storageDate,
      {
        date: storageDate,
        entries: [{ activity_id: "event", task_id: "task", occurred_at: occurredAt, done: ["Recorded work"] }],
      },
      "seed",
    );
    const path = join(repo.root, "activities", `${storageDate}.yaml`);
    const before = await readFile(path, "utf8");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(occurredAt));
    const view = await buildActivityCalendar(repo, config, calendarDate, calendarDate);
    expect(view.today).toBe(calendarDate);
    expect(view.daily_counts).toEqual({ [calendarDate]: 1 });
    expect(view.events).toMatchObject([
      { calendar_date: calendarDate, operational_date: storageDate, occurred_at: occurredAt },
    ]);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("includes adjacent-file midnight events exactly once and excludes next calendar day", async () => {
    const { repo, config } = await createTempRepo();
    config.timezone = "Asia/Tokyo";
    config.activityRolloverHour = 4;
    await repo.saveActivity(
      "2026-07-31",
      {
        date: "2026-07-31",
        entries: [
          { activity_id: "before", task_id: "task", occurred_at: "2026-07-31T14:59:59Z" },
          { activity_id: "midnight", task_id: "task", occurred_at: "2026-07-31T15:00:00Z" },
          { activity_id: "early", task_id: "task", occurred_at: "2026-08-01T03:59:00+09:00" },
        ],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-08-01",
      {
        date: "2026-08-01",
        entries: [
          { activity_id: "last", task_id: "task", occurred_at: "2026-08-01T23:59:59+09:00" },
          { activity_id: "next", task_id: "task", occurred_at: "2026-08-02T00:00:00+09:00" },
        ],
      },
      "seed",
    );
    const view = await buildActivityCalendar(repo, config, "2026-08-01", "2026-08-01");
    expect(view.events.map((event) => event.id)).toEqual(["midnight", "early", "last"]);
    expect(view.daily_counts).toEqual({ "2026-08-01": 3 });
  });

  it("keeps unknown, invalid and offset-free legacy times on their storage date without using recorded_at", async () => {
    const { repo, config } = await createTempRepo();
    config.timezone = "Asia/Tokyo";
    await repo.saveActivity(
      "2026-07-31",
      {
        date: "2026-07-31",
        entries: [
          { activity_id: "unknown", task_id: "task", recorded_at: "2026-08-10T00:00:00Z" },
          { activity_id: "invalid", task_id: "task", occurred_at: "not-a-time" },
          { activity_id: "naive", task_id: "task", occurred_at: "2026-08-01T01:00:00" },
        ],
      },
      "seed",
    );
    const view = await buildActivityCalendar(repo, config, "2026-07-31", "2026-07-31");
    expect(view.events).toHaveLength(3);
    expect(view.events.every((event) => event.calendar_date === "2026-07-31" && !event.occurred_at)).toBe(true);
    expect((await buildActivityCalendar(repo, config, "2026-08-01", "2026-08-01")).events).toEqual([]);
  });

  it("rejects nonexistent dates and oversized ranges", async () => {
    const { repo, config } = await createTempRepo();
    await expect(buildActivityCalendar(repo, config, "2026-02-30", "2026-03-01")).rejects.toThrow(
      "Invalid calendar date",
    );
    await expect(buildActivityCalendar(repo, config, "2026-01-01", "2026-12-31")).rejects.toThrow("62 days");
  });
});
