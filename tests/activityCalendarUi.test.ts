// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "#webUi/i18n/index";
import ActivityPage from "#webUi/pages/ActivityPage.vue";
import ActivityMonthGrid from "#webUi/components/organisms/ActivityMonthGrid.vue";
import ActivityTimeGrid from "#webUi/components/organisms/ActivityTimeGrid.vue";
import ActivityProjectLanes from "#webUi/components/organisms/ActivityProjectLanes.vue";
import type { ActivityCalendarEvent } from "#webUi/types/api";
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

const event: ActivityCalendarEvent = {
  id: "midnight",
  calendar_date: "2026-08-01",
  operational_date: "2026-07-31",
  occurred_at: "2026-07-31T16:30:00Z",
  task_id: "task",
  project: "Project",
  title: "Midnight work",
  summary: "Midnight work",
  done: [],
  next: [],
};
afterEach(() => vi.unstubAllGlobals());

describe("Activity calendar UI calendar-day contract", () => {
  it("lets the page own vertical scrolling while retaining horizontal calendar overflow", () => {
    const source = readFileSync("src/web-ui/components/organisms/ActivityTimeGrid.vue", "utf8");
    const scrollRules = [...source.matchAll(/\.time-scroll\s*\{([^}]+)\}/g)].map((match) => match[1]);
    expect(scrollRules).toHaveLength(1);
    expect(scrollRules[0]).toContain("overflow-x: auto");
    expect(scrollRules[0]).not.toMatch(/(?:max-)?height\s*:/);
    expect(scrollRules[0]).not.toMatch(/overflow(?:-y)?\s*:\s*(?:auto|scroll)/);
  });
  it("keeps the complete 24-hour axis and late-night event selectable", async () => {
    const late = { ...event, id: "late", occurred_at: "2026-08-01T14:59:00Z" };
    const grid = mount(ActivityTimeGrid, {
      props: { from: "2026-08-01", to: "2026-08-01", events: [late], projects: ["Project"], timezone: "Asia/Tokyo" },
      global: { plugins: [i18n] },
    });
    expect(grid.findAll(".hour-labels span")).toHaveLength(24);
    expect(grid.findAll(".hour-labels span").at(-1)?.text()).toBe("23:00");
    expect(grid.find(".positioned-event").attributes("style")).toContain("top: 1151.2px");
    await grid.get(".activity-event").trigger("click");
    expect(grid.emitted("select")?.[0]).toEqual([late]);
    grid.unmount();
  });
  it("places month events on calendar_date and highlights local today", () => {
    const wrapper = mount(ActivityMonthGrid, {
      props: {
        from: "2026-07-31",
        to: "2026-08-01",
        focusDate: "2026-08-01",
        today: "2026-08-01",
        events: [event],
        projects: ["Project"],
      },
      global: { plugins: [i18n] },
    });
    const days = wrapper.findAll(".day-cell");
    expect(days[0].text()).not.toContain("Midnight work");
    expect(days[1].text()).toContain("Midnight work");
    expect(days[1].classes()).toContain("today");
    wrapper.unmount();
  });

  it("positions local 01:30 at minute 90 from midnight in time grid and lanes", () => {
    const props = {
      from: "2026-08-01",
      to: "2026-08-01",
      events: [event],
      projects: ["Project"],
      timezone: "Asia/Tokyo",
    };
    const grid = mount(ActivityTimeGrid, { props, global: { plugins: [i18n] } });
    expect(grid.find(".positioned-event").attributes("style")).toContain("top: 72px");
    expect(grid.find(".hour-labels span").text()).toBe("00:00");
    expect(grid.text()).toContain("01:30");
    const lane = mount(ActivityProjectLanes, { props, global: { plugins: [i18n] } });
    expect(lane.find(".lane-event").attributes("style")).toContain("6.25%");
    grid.unmount();
    lane.unmount();
  });

  it("bootstraps and navigates Today from API local date, not UTC or overview work date", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        from: "2026-08-01",
        to: "2026-08-01",
        timezone: "Asia/Tokyo",
        today: "2026-08-01",
        rollover_hour: 4,
        events: [event],
        daily_counts: { "2026-08-01": 1 },
        projects: ["Project"],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/activity", component: ActivityPage }],
    });
    await router.push("/activity?view=day");
    const wrapper = mount(ActivityPage, { global: { plugins: [i18n, router] } });
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/activity-calendar?from=2026-08-01&to=2026-08-01", expect.anything()),
    );
    expect(wrapper.text()).toContain("Asia/Tokyo");
    expect(wrapper.find(".calendar-status").text()).toContain("Asia/Tokyo · 00:00–24:00");
    await router.push("/activity?view=day&date=2026-07-01");
    wrapper.findComponent({ name: "ActivityCalendarToolbar" }).vm.$emit("today");
    await vi.waitFor(() => expect(router.currentRoute.value.query.date).toBe("2026-08-01"));
    wrapper.unmount();
  });
});
