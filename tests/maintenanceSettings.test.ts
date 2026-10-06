import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  maintenanceSettingsView,
  updateMaintenanceSettings,
  validateMaintenanceSettings,
} from "#infra/config/maintenanceSettings";
import { createTempRepo } from "./helpers.ts";

const settings = {
  enabled: true,
  run_at: "04:15",
  keep_all_days: 5,
  keep_daily_days: 20,
  keep_weekly_days: 120,
  keep_monthly_days: 730,
  archive_grace_days: 60,
  max_versions_per_file_per_day: 2,
};

describe("maintenance settings", () => {
  it("persists validated retention settings and updates the live config", async () => {
    const { repo, config } = await createTempRepo();

    const result = await updateMaintenanceSettings(repo, config, settings);

    expect(result).toMatchObject(settings);
    expect(config.backupCleanup).toEqual({
      enabled: true,
      runAt: "04:15",
      keepAllDays: 5,
      keepDailyDays: 20,
      keepWeeklyDays: 120,
      keepMonthlyDays: 730,
      archiveGraceDays: 60,
      maxVersionsPerFilePerDay: 2,
    });
    await expect(readFile(join(repo.root, "config", "maintenance.yaml"), "utf8")).resolves.toContain(
      "keep_monthly_days: 730",
    );
    await expect(maintenanceSettingsView(repo, config)).resolves.toMatchObject(settings);
  });

  it("rejects invalid schedule and non-monotonic retention periods", () => {
    expect(() => validateMaintenanceSettings({ ...settings, run_at: "25:00" })).toThrow("HH:MM");
    expect(() => validateMaintenanceSettings({ ...settings, keep_all_days: 21, keep_daily_days: 20 })).toThrow(
      "Retention periods",
    );
  });
});
