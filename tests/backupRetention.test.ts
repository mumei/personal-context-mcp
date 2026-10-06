import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { runBackupRetention } from "#app/cleanup/retention";
import { createTempRepo } from "./helpers.ts";

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function backup(root: string, date: string, name: string, content: string): Promise<string> {
  const path = join(root, "backups", date, name);
  await mkdir(join(root, "backups", date), { recursive: true });
  await writeFile(path, content, "utf8");
  return path;
}

describe("automatic backup retention", () => {
  it("keeps recent data, compacts older daily versions, archives excess generations, and runs once", async () => {
    const { repo, config } = await createTempRepo();
    config.backupCleanup = {
      enabled: true,
      runAt: "03:00",
      keepAllDays: 7,
      keepDailyDays: 30,
      keepWeeklyDays: 180,
      keepMonthlyDays: 365,
      archiveGraceDays: 30,
      maxVersionsPerFilePerDay: 1,
    };
    const recent = await backup(repo.root, "2026-08-11", "tasks.yaml.20260811090000000.a-save.bak", "recent");
    const dailyLatest = await backup(repo.root, "2026-08-01", "tasks.yaml.20260801100000000.a-save.bak", "latest");
    const dailyOlder = await backup(repo.root, "2026-08-01", "tasks.yaml.20260801090000000.a-save.bak", "older");
    await backup(repo.root, "2026-06-01", "tasks.yaml.20260601100000000.a-save.bak", "week-old");
    const weeklyKept = await backup(repo.root, "2026-06-02", "tasks.yaml.20260602100000000.a-save.bak", "week-new");
    await backup(repo.root, "2025-01-01", "tasks.yaml.20250101100000000.a-save.bak", "expired");
    const expiredArchive = join(repo.root, "cleanup_archive", "2026-06-01", "backups", "old.txt");
    const unrelatedArchive = join(repo.root, "cleanup_archive", "2026-06-01", "outputs", "keep.txt");
    await mkdir(join(repo.root, "cleanup_archive", "2026-06-01", "backups"), { recursive: true });
    await mkdir(join(repo.root, "cleanup_archive", "2026-06-01", "outputs"), { recursive: true });
    await writeFile(expiredArchive, "old archive", "utf8");
    await writeFile(unrelatedArchive, "unrelated archive", "utf8");

    const now = new Date("2026-08-12T04:00:00.000Z");
    const preview = await runBackupRetention(repo, config, { dry_run: true, force: true, now });
    expect(preview.archived_backup_dates).toContain("2025-01-01");
    expect(preview.archived_backup_dates).toContain("2026-06-01");
    expect(preview.compacted_backup_file_count).toBeGreaterThan(0);
    expect(preview.compacted_backup_files_sample).toContain("backups/2026-08-01/" + dailyOlder.split("/").at(-1));
    expect(await exists(dailyOlder)).toBe(true);

    const result = await runBackupRetention(repo, config, { force: true, now });
    expect(result.skipped).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(await exists(dailyLatest)).toBe(true);
    expect(await exists(dailyOlder)).toBe(false);
    expect(await exists(weeklyKept)).toBe(true);
    expect(await exists(expiredArchive)).toBe(false);
    expect(await exists(unrelatedArchive)).toBe(true);
    expect(await exists(join(repo.root, "cleanup_archive", "2026-08-12", "backups", "2026-08-01"))).toBe(true);

    const state = YAML.parse(await readFile(join(repo.root, "config", "maintenance-state.yaml"), "utf8")) as {
      last_run: { operational_date: string };
    };
    expect(state.last_run.operational_date).toBe("2026-08-12");
    const repeated = await runBackupRetention(repo, config, { now });
    expect(repeated).toMatchObject({ skipped: true, skip_reason: "already_ran" });
  });

  it("keeps every archived backup path restorable while bounding automatic content details", async () => {
    const { repo, config } = await createTempRepo();
    config.backupCleanup = {
      enabled: true,
      runAt: "03:00",
      keepAllDays: 1,
      keepDailyDays: 1,
      keepWeeklyDays: 1,
      keepMonthlyDays: 1,
      archiveGraceDays: 30,
      maxVersionsPerFilePerDay: 1,
    };
    for (let index = 0; index < 210; index += 1) {
      await backup(repo.root, "2026-06-01", `task-${index}.yaml.20260601090000000.seed.bak`, `content-${index}`);
    }

    await runBackupRetention(repo, config, { force: true, now: new Date("2026-08-12T04:00:00.000Z") });

    const summaries = await repo.loadCleanupSummaries("2026-08-12");
    const summary = summaries.summaries.find((item) => item.target === "backups");
    expect(summary?.files).toHaveLength(211);
    expect(summary?.files.filter((file) => file.content_kind)).toHaveLength(200);
    expect(summary?.files.filter((file) => file.content_preview)).toHaveLength(199);
    expect(summary?.files.every((file) => file.restore_to && file.relative_path)).toBe(true);
    expect(summary?.notes).toContain(
      "Content previews and summaries were retained for the first 200 of 211 manifest entries; every archived path remains listed and restorable.",
    );
    expect((await readdir(join(repo.root, "cleanup_archive", "2026-08-12", "backups", "2026-06-01"))).length).toBe(210);
  });

  it("prunes only expired automatic backup manifests after deleting their archive data", async () => {
    const { repo, config } = await createTempRepo();
    config.backupCleanup = {
      enabled: true,
      runAt: "03:00",
      keepAllDays: 1,
      keepDailyDays: 1,
      keepWeeklyDays: 1,
      keepMonthlyDays: 1,
      archiveGraceDays: 30,
      maxVersionsPerFilePerDay: 1,
    };
    const archiveDate = "2026-06-01";
    const expiredArchive = join(repo.root, "cleanup_archive", archiveDate, "backups", "old.txt");
    await mkdir(join(repo.root, "cleanup_archive", archiveDate, "backups"), { recursive: true });
    await writeFile(expiredArchive, "old archive", "utf8");
    await repo.saveCleanupSummaries(
      archiveDate,
      {
        date: archiveDate,
        summaries: [
          {
            summary_id: "automatic-backups",
            created_at: "2026-06-01T00:00:00.000Z",
            source: "archive",
            target: "backups",
            archive_date: archiveDate,
            candidate_count: 1,
            total_size_bytes: 11,
            groups: [],
            files: [
              {
                relative_path: "cleanup_archive/2026-06-01/backups/old.txt",
                target: "backups",
                kind: "archived_file",
                size_bytes: 11,
              },
            ],
            notes: [
              "Created by automatic backup retention.",
              "Use cleanup_restore_archive to restore archived backups.",
            ],
          },
          {
            summary_id: "manual-backups",
            created_at: "2026-06-01T00:00:00.000Z",
            source: "archive",
            target: "backups",
            archive_date: archiveDate,
            candidate_count: 1,
            total_size_bytes: 12,
            groups: [],
            files: [
              {
                relative_path: "cleanup_archive/2026-06-01/backups/manual.txt",
                target: "backups",
                kind: "archived_file",
                size_bytes: 12,
              },
            ],
            notes: ["Created manually."],
          },
          {
            summary_id: "automatic-outputs",
            created_at: "2026-06-01T00:00:00.000Z",
            source: "archive",
            target: "outputs",
            archive_date: archiveDate,
            candidate_count: 1,
            total_size_bytes: 13,
            groups: [],
            files: [
              {
                relative_path: "cleanup_archive/2026-06-01/outputs/keep.txt",
                target: "outputs",
                kind: "archived_file",
                size_bytes: 13,
              },
            ],
            notes: ["Created by automatic backup retention."],
          },
        ],
      },
      "test",
    );

    const now = new Date("2026-08-12T04:00:00.000Z");
    await runBackupRetention(repo, config, { dry_run: true, force: true, now });
    expect(await exists(expiredArchive)).toBe(true);
    expect(
      (await repo.loadCleanupSummaries(archiveDate)).summaries.every((summary) => summary.files.length === 1),
    ).toBe(true);

    await runBackupRetention(repo, config, { force: true, now });

    const summaries = await repo.loadCleanupSummaries(archiveDate);
    expect(await exists(expiredArchive)).toBe(false);
    expect(summaries.summaries.find((summary) => summary.summary_id === "automatic-backups")).toMatchObject({
      candidate_count: 1,
      total_size_bytes: 11,
      files: [],
      notes: [
        "Created by automatic backup retention.",
        "Use cleanup_restore_archive to restore archived backups.",
        "The per-file manifest was pruned after archive expiry.",
      ],
    });
    expect(summaries.summaries.find((summary) => summary.summary_id === "manual-backups")?.files).toHaveLength(1);
    expect(summaries.summaries.find((summary) => summary.summary_id === "automatic-outputs")?.files).toHaveLength(1);
  });
});
