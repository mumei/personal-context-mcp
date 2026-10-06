import { describe, expect, it } from "vitest";
import {
  addDays,
  calendarRange,
  datesBetween,
  moveFocusDate,
  startOfWeek,
} from "#webUi/composables/activity/calendarMath";

describe("Activity calendar date math", () => {
  it("builds a complete six-row month range when needed", () => {
    expect(calendarRange("2026-08-15", "month")).toEqual({ from: "2026-07-26", to: "2026-09-05" });
    expect(datesBetween("2026-07-26", "2026-09-05")).toHaveLength(42);
  });

  it("keeps week and project lanes on the same Sunday-to-Saturday range", () => {
    expect(startOfWeek("2026-07-23")).toBe("2026-07-19");
    expect(calendarRange("2026-07-23", "week")).toEqual({ from: "2026-07-19", to: "2026-07-25" });
    expect(calendarRange("2026-07-23", "lane")).toEqual({ from: "2026-07-19", to: "2026-07-25" });
  });

  it("moves each view by its natural period without local timezone drift", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(moveFocusDate("2026-07-23", "day", 1)).toBe("2026-07-24");
    expect(moveFocusDate("2026-07-23", "week", -1)).toBe("2026-07-16");
    expect(moveFocusDate("2026-07-23", "month", 1)).toBe("2026-08-23");
  });
});
