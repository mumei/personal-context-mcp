import { describe, expect, it } from "vitest";
import {
  operationalDateInTimeZone,
  operationalDateRange,
  resolveActivityWriteDate,
  resolveDate,
  todayInTimeZone,
} from "#shared/date";

describe("date resolution", () => {
  const atThreeAmJst = new Date("2026-07-14T18:00:00.000Z");
  const atFourAmJst = new Date("2026-07-14T19:00:00.000Z");

  it("resolves the calendar date in the configured timezone", () => {
    expect(todayInTimeZone("Asia/Tokyo", atThreeAmJst)).toBe("2026-07-15");
    expect(resolveDate(undefined, { timezone: "Asia/Tokyo", activityRolloverHour: 0 }, atThreeAmJst)).toBe(
      "2026-07-15",
    );
  });

  it("keeps times before the configured rollover hour on the previous work date", () => {
    expect(operationalDateInTimeZone("Asia/Tokyo", 4, atThreeAmJst)).toBe("2026-07-14");
    expect(operationalDateInTimeZone("Asia/Tokyo", 4, atFourAmJst)).toBe("2026-07-15");
  });

  it("resolves tomorrow from the operational date", () => {
    expect(resolveDate("tomorrow", { timezone: "Asia/Tokyo", activityRolloverHour: 4 }, atThreeAmJst)).toBe(
      "2026-07-15",
    );
  });

  it("derives activity dates from occurred_at and requires explicit backfill", () => {
    const config = { timezone: "Asia/Tokyo", activityRolloverHour: 4 };
    expect(resolveActivityWriteDate(undefined, "2026-07-15T03:59:00+09:00", false, config)).toBe("2026-07-14");
    expect(resolveActivityWriteDate(undefined, "2026-07-15T04:00:00+09:00", false, config)).toBe("2026-07-15");
    expect(() => resolveActivityWriteDate("2026-07-14", undefined, false, config)).toThrow("backfill=true");
    expect(resolveActivityWriteDate("2026-07-14", undefined, true, config)).toBe("2026-07-14");
  });

  it("describes the selected operational date range", () => {
    expect(operationalDateRange("2026-07-15", { timezone: "Asia/Tokyo", activityRolloverHour: 4 })).toMatchObject({
      start: "2026-07-15 04:00",
      end: "2026-07-16 04:00",
      timezone: "Asia/Tokyo",
    });
  });
});
