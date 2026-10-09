// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "#webUi/i18n/index";
import WeeklyReportPage from "#webUi/pages/WeeklyReportPage.vue";
import ReportPage from "#webUi/pages/ReportPage.vue";
import SettingsPanel from "#webUi/components/organisms/SettingsPanel.vue";
import { getJson, mutateJson } from "#webUi/services/api";
import type { WeeklyReportResponse } from "#webUi/types/api";

vi.mock("#webUi/services/api", () => ({
  getJson: vi.fn(),
  mutateJson: vi.fn(),
}));

const response = (overrides: Partial<WeeklyReportResponse> = {}): WeeklyReportResponse => ({
  week_start: "2026-10-05",
  week_end: "2026-10-11",
  through: "2026-10-08",
  timezone: "Asia/Tokyo",
  rollover_hour: 4,
  today: "2026-10-08",
  provisional: true,
  generated_at: "2026-10-08T02:00:00.000Z",
  exists: true,
  recorded_dates: ["2026-10-05"],
  missing_dates: ["2026-10-06"],
  text: { text: "Weekly summary" },
  markdown: { text: "# Weekly summary", html: "<h1>Weekly summary</h1>" },
  ...overrides,
});
const catalog = () => ({
  today: "2026-10-08",
  current_week: "2026-10-05",
  week_start_day: 1,
  periods: [
    { week_start: "2026-10-05", week_end: "2026-10-11", through: "2026-10-08", can_generate: true },
    { week_start: "2026-09-28", week_end: "2026-10-04", through: "2026-10-04", can_generate: true },
  ],
  versions: [
    {
      week_start: "2026-10-05",
      week_end: "2026-10-11",
      through: "2026-10-08",
      generated_at: "2026-10-08T02:00:00Z",
      provisional: true,
    },
  ],
});
beforeEach(() => {
  vi.mocked(getJson).mockImplementation(async (url) => (url === "/api/report/weekly/history" ? catalog() : response()));
});

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/report/weekly/:format(text|markdown)?", name: "weekly-report", component: WeeklyReportPage },
      { path: "/report/:format(text|markdown)?", name: "report", component: { template: "<div>Daily</div>" } },
    ],
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Weekly report UI", () => {
  it("explains the selected closing day and rollover in both languages without saving settings", async () => {
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url === "/api/settings/profile") return { timezone: "Asia/Tokyo", activity_rollover_hour: 0 };
      if (url === "/api/settings/report") return { week_start_day: 1 };
      return {};
    });
    i18n.global.locale.value = "ja";
    const wrapper = mount(SettingsPanel, { global: { plugins: [i18n] } });
    await flushPromises();
    const description = () => wrapper.get("#weekly-closing-description").text();
    expect(description()).toContain("日曜日の終わりまでが対象です。月曜日の午前0時から次の週");
    await wrapper.get('input[inputmode="numeric"]').setValue("０４");
    expect(description()).toContain("月曜日の4時直前まで");
    await wrapper.get("#weekly-report-settings select").setValue(6);
    expect(description()).toContain("土曜日の作業日");
    expect(description()).toContain("日曜日の4時から次の週");
    i18n.global.locale.value = "en";
    await flushPromises();
    expect(description()).toContain("Saturday's workday");
    expect(description()).toContain("4:00 on Sunday");
    expect(mutateJson).not.toHaveBeenCalled();
    wrapper.unmount();
    i18n.global.locale.value = "ja";
  });
  it("keeps daily report content and format controls without duplicate daily/weekly navigation", async () => {
    vi.mocked(getJson).mockResolvedValue({ text: { text: "Daily summary" }, sync: { tasks: [] } });
    const router = makeRouter();
    await router.push("/report/text?date=2026-10-10");
    const wrapper = mount(ReportPage, { global: { plugins: [router, i18n] } });
    await flushPromises();
    expect(wrapper.get("pre").text()).toBe("Daily summary");
    expect(wrapper.text()).toContain("2026-10-10");
    expect(wrapper.find(".report-navigation").exists()).toBe(false);
    expect(wrapper.findAll("a")).toHaveLength(0);
    expect(wrapper.get(".tabs").text()).toContain("Markdown");
    wrapper.unmount();
  });

  it("keeps weekly selection and generation without a duplicate settings link or icon", async () => {
    const router = makeRouter();
    await router.push("/report/weekly/text");
    const wrapper = mount(WeeklyReportPage, { global: { plugins: [router, i18n] } });
    await flushPromises();
    expect(wrapper.findAll(".range-controls select")).toHaveLength(2);
    expect(wrapper.findAll(".range-controls a, .range-controls button")).toHaveLength(0);
    expect(wrapper.get("pre").text()).toBe("Weekly summary");
    expect(wrapper.get(".toolbar button").attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("opens an old saved range without generating or reinterpreting its boundaries", async () => {
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url === "/api/report/weekly/history") {
        const history = catalog();
        history.week_start_day = 0;
        history.periods[0]!.can_generate = false;
        return history;
      }
      return response();
    });
    const router = makeRouter();
    await router.push("/report/weekly/text?week=2026-10-05&through=2026-10-08");
    const wrapper = mount(WeeklyReportPage, { global: { plugins: [router, i18n] } });
    await flushPromises();
    expect(wrapper.get(".toolbar button").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Weekly summary");
    expect(mutateJson).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("keeps saved content visible when manual generation fails", async () => {
    vi.mocked(mutateJson).mockRejectedValue(new Error("Provider unavailable"));
    const router = makeRouter();
    await router.push("/report/weekly/text");
    const wrapper = mount(WeeklyReportPage, { global: { plugins: [router, i18n] } });
    await flushPromises();
    await wrapper.get(".toolbar button").trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Provider unavailable");
    expect(wrapper.get("pre").text()).toBe("Weekly summary");
    wrapper.unmount();
  });

  it("generates an explicitly chosen partial version only on request", async () => {
    vi.mocked(mutateJson).mockResolvedValue(response({ through: "2026-10-06" }));
    const router = makeRouter();
    await router.push("/report/weekly/text");
    const wrapper = mount(WeeklyReportPage, { global: { plugins: [router, i18n] } });
    await flushPromises();
    expect(mutateJson).not.toHaveBeenCalled();
    await wrapper.get('input[type="date"]').setValue("2026-10-06");
    await wrapper.get("details button").trigger("click");
    await flushPromises();
    expect(mutateJson).toHaveBeenCalledWith("/api/report/weekly/generate", "POST", {
      week: "2026-10-05",
      through: "2026-10-06",
    });
    wrapper.unmount();
  });

  it("restores the requested range from a shared URL", async () => {
    const router = makeRouter();
    await router.push("/report/weekly/text?week=2026-10-05&through=2026-10-07");
    const wrapper = mount(WeeklyReportPage, { global: { plugins: [router, i18n] } });
    await flushPromises();
    expect(getJson).toHaveBeenCalledWith("/api/report/weekly?week=2026-10-05&through=2026-10-07");
    wrapper.unmount();
  });
  it("routes weekly paths before the generic daily report path", async () => {
    const router = makeRouter();
    await router.push("/report/weekly/markdown");
    await router.isReady();
    expect(router.currentRoute.value.name).toBe("weekly-report");
  });

  it("shows the normalized week, partial cutoff, provisional state, and format content", async () => {
    const router = makeRouter();
    await router.push("/report/weekly/text");
    const wrapper = mount(WeeklyReportPage, { global: { plugins: [router, i18n] } });
    await flushPromises();

    expect(vi.mocked(getJson)).toHaveBeenCalledWith("/api/report/weekly?week=2026-10-05&through=2026-10-08");
    expect(wrapper.text()).toContain("2026-10-05");
    expect(wrapper.text()).toContain("2026-10-11");
    expect(wrapper.text()).toContain("2026-10-08");
    expect(wrapper.text()).toContain("暫定");
    expect(wrapper.text()).toContain("Weekly summary");
    expect(wrapper.get('input[type="date"]').element.getAttribute("max")).toBe("2026-10-08");
    expect(mutateJson).not.toHaveBeenCalled();
    expect(wrapper.get("select").text()).toContain("未生成");

    wrapper.unmount();
  });

  it("loads a selected week using the server default cutoff and ignores an older response", async () => {
    let resolveInitial!: (value: WeeklyReportResponse) => void;
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url === "/api/report/weekly/history") return catalog();
      if (url.includes("2026-09-28"))
        return response({ week_start: "2026-09-28", week_end: "2026-10-04", through: "2026-10-04" });
      return new Promise((resolve) => (resolveInitial = resolve));
    });
    const router = makeRouter();
    await router.push("/report/weekly/text");
    const wrapper = mount(WeeklyReportPage, { global: { plugins: [router, i18n] } });
    await flushPromises();
    await wrapper.find("select").setValue("2026-09-28");
    await flushPromises();
    resolveInitial(response());
    await flushPromises();

    expect(vi.mocked(getJson)).toHaveBeenCalledWith("/api/report/weekly?week=2026-09-28");
    expect(wrapper.text()).toContain("2026-09-28");
    expect(wrapper.text()).not.toContain("Provisional");
    wrapper.unmount();
  });

  it("generates both formats atomically for the selected range", async () => {
    vi.mocked(getJson).mockImplementation(async (url) =>
      url === "/api/report/weekly/history" ? catalog() : response({ text: { text: "Updated" } }),
    );
    vi.mocked(mutateJson).mockResolvedValue(response({ text: { text: "Updated" } }));
    const router = makeRouter();
    await router.push("/report/weekly/text");
    const wrapper = mount(WeeklyReportPage, { global: { plugins: [router, i18n] } });
    await flushPromises();
    await wrapper.get(".toolbar button").trigger("click");
    await flushPromises();

    expect(mutateJson).toHaveBeenCalledWith("/api/report/weekly/generate", "POST", {
      week: "2026-10-05",
      through: "2026-10-08",
    });
    expect(wrapper.text()).toContain("Updated");
    wrapper.unmount();
  });

  it("switches to rendered Markdown and copies the selected format", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...window.navigator, clipboard: { writeText } });
    const router = makeRouter();
    await router.push("/report/weekly/text");
    const wrapper = mount(WeeklyReportPage, { global: { plugins: [router, i18n] } });
    await flushPromises();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await flushPromises();
    expect(wrapper.find(".markdown-body h1").text()).toBe("Weekly summary");
    await wrapper.findAll(".toolbar button")[1].trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith("# Weekly summary");
    wrapper.unmount();
  });
});
