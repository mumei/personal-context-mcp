import { describe, expect, it } from "vitest";
import { buildDailySchedule, parseDailySchedule } from "#shared/dailySchedule";

describe("daily schedule controls", () => {
  it("maps a daily schedule to every weekday", () => {
    expect(parseDailySchedule("RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=5")).toEqual({
      time: "07:05",
      weekdays: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
    });
  });

  it("round-trips selected weekdays in canonical order", () => {
    expect(buildDailySchedule("18:30", ["FR", "MO", "WE"])).toBe(
      "RRULE:FREQ=WEEKLY;BYHOUR=18;BYMINUTE=30;BYDAY=MO,WE,FR",
    );
    expect(parseDailySchedule("RRULE:FREQ=WEEKLY;BYHOUR=18;BYMINUTE=30;BYDAY=MO,WE,FR")).toEqual({
      time: "18:30",
      weekdays: ["MO", "WE", "FR"],
    });
  });

  it("rejects missing weekdays and invalid times", () => {
    expect(() => buildDailySchedule("07:30", [])).toThrow("weekday");
    expect(() => buildDailySchedule("25:00", ["MO"])).toThrow("HH:MM");
  });
});
