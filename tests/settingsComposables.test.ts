// @vitest-environment jsdom

import { computed, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getJson, mutateJson } from "#webUi/services/api";
import { useDailyScheduleForm } from "#webUi/composables/settings/useDailyScheduleForm";
import { useDailyTaskAutomation } from "#webUi/composables/settings/useDailyTaskAutomation";
import { useReportSettings } from "#webUi/composables/settings/useReportSettings";
import { normalizeRolloverHour } from "#webUi/composables/settings/useProfileSettings";
import type { AutomationStatus } from "#webUi/composables/settings/types";
import type { MessageKey } from "#webUi/composables/useLocale";

vi.mock("../src/web-ui/services/api.ts", () => ({ getJson: vi.fn(), mutateJson: vi.fn() }));

function automationStatus(): AutomationStatus {
  return reactive({
    connected_client: {},
    llm_provider: {
      configured_provider: "auto",
      selected_provider: "gemini_cli",
      selected_model: "gemini-2.5-pro",
      selection_reason: "gemini_client",
      providers: [],
    },
    clients: [],
    model_options: {
      codex: [{ value: "gpt-5.6-sol", recommended: true }],
      cursor: [{ value: "auto", recommended: true }],
      claude_code_loop: [{ value: "claude-sonnet-4-6", recommended: true }],
      claude_desktop: [{ value: "claude-sonnet-4-6", recommended: true }],
      copilot_cli: [{ value: "gpt-5.3-codex", recommended: true }],
      gemini_cli: [{ value: "gemini-2.5-pro", recommended: true }],
    },
  });
}

describe("settings composables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes full-width rollover hours and clamps the supported range", () => {
    expect(normalizeRolloverHour("０４")).toBe(4);
    expect(normalizeRolloverHour("２４")).toBe(23);
    expect(normalizeRolloverHour(-1)).toBe(0);
  });

  it("loads and saves the selected weekly report start day", async () => {
    vi.mocked(getJson).mockResolvedValue({ week_start_day: 0, path: "/tmp/config/report.yaml" });
    vi.mocked(mutateJson).mockResolvedValue({ week_start_day: 6, path: "/tmp/config/report.yaml" });
    const settings = useReportSettings();

    await settings.load();
    expect(settings.report).toMatchObject({ week_start_day: 0, path: "/tmp/config/report.yaml" });
    expect(settings.closingDay.value).toBe(6);
    settings.closingDay.value = 5;
    expect(settings.report.week_start_day).toBe(6);
    await settings.save();

    expect(mutateJson).toHaveBeenCalledWith("/api/settings/report", "PUT", { week_start_day: 6 });
    expect(settings.report).toMatchObject({ week_start_day: 6, path: "/tmp/config/report.yaml" });
  });

  it("converts every closing weekday to the following start weekday without changing the schema", () => {
    const settings = useReportSettings();
    for (let closing = 0; closing < 7; closing++) {
      settings.closingDay.value = closing;
      expect(settings.report.week_start_day).toBe((closing + 1) % 7);
      expect(settings.closingDay.value).toBe(closing);
    }
  });

  it("round-trips execution controls through the daily RRULE", () => {
    const schedule = useDailyScheduleForm();
    schedule.load("RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=15;BYDAY=MO,WE,FR");

    expect(schedule.executionTime.value).toBe("09:15");
    expect(schedule.selectedWeekdays.value).toEqual(["MO", "WE", "FR"]);
    expect(schedule.serialize()).toBe("RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=15;BYDAY=MO,WE,FR");
  });

  it("encapsulates external setup preparation and completion", async () => {
    const automation = automationStatus();
    const schedule = useDailyScheduleForm();
    const notifications: string[] = [];
    const reloadStatus = vi.fn(async () => undefined);
    vi.mocked(mutateJson)
      .mockResolvedValueOnce({
        integration: {
          mode: "assisted",
          status: "setup_required",
          setup_command: "gemini --prompt ...",
          notes: ["integrationNoteGeminiCliSetup"],
        },
        source_runner: "codex",
        source_stop_note: "switchStopCodexAutomatic",
      })
      .mockResolvedValueOnce({});
    const dailyTask = useDailyTaskAutomation({
      automation,
      configuredRunner: computed(() => "codex"),
      profileTimezone: () => "Asia/Tokyo",
      schedule,
      reloadStatus,
      translate: (key: MessageKey) => String(key),
      notify: (message) => notifications.push(message),
    });

    dailyTask.startSwitch();
    dailyTask.beginSetup("gemini_cli");
    expect(dailyTask.setup.model).toBe("gemini-2.5-pro");
    await dailyTask.saveSetup();

    expect(mutateJson).toHaveBeenNthCalledWith(
      1,
      "/api/settings/daily-task/prepare",
      "POST",
      expect.objectContaining({ runner: "gemini_cli", model: "gemini-2.5-pro" }),
    );
    expect(dailyTask.awaitingCompletion.value).toBe(true);
    expect(dailyTask.sourceStopNote.value).toBe("switchStopCodexAutomatic");
    expect(notifications).toContain("automationSetupPrepared");

    await dailyTask.completeSetup();
    expect(mutateJson).toHaveBeenNthCalledWith(
      2,
      "/api/settings/daily-task/complete",
      "POST",
      expect.objectContaining({ runner: "gemini_cli", source_runner: "codex" }),
    );
    expect(reloadStatus).toHaveBeenCalledOnce();
    expect(notifications).toContain("automationSwitched");
    expect(dailyTask.setupRunner.value).toBeUndefined();
  });

  it("loads an existing daily task into the schedule form", async () => {
    vi.mocked(getJson).mockResolvedValue({
      version: 1,
      name: "Briefing",
      enabled: true,
      runner: "copilot_cli",
      schedule: "RRULE:FREQ=WEEKLY;BYHOUR=8;BYMINUTE=5;BYDAY=TU,TH",
      timezone: "Asia/Tokyo",
      model: "gpt-5.3-codex",
      reasoning_effort: "medium",
      workspace: "/tmp/project",
      claude_loop_interval: "24h",
      prompt: "Generate briefing",
    });
    const schedule = useDailyScheduleForm();
    const dailyTask = useDailyTaskAutomation({
      automation: automationStatus(),
      configuredRunner: computed(() => "copilot_cli"),
      profileTimezone: () => "Asia/Tokyo",
      schedule,
      reloadStatus: async () => undefined,
      translate: (key: MessageKey) => String(key),
      notify: () => undefined,
    });

    await dailyTask.beginEdit({
      runner: "copilot_cli",
      state: "configured",
      selected: true,
      detection: "external",
    });

    expect(dailyTask.setup.name).toBe("Briefing");
    expect(schedule.executionTime.value).toBe("08:05");
    expect(schedule.selectedWeekdays.value).toEqual(["TU", "TH"]);
  });
});
