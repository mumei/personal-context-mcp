import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  archiveCleanup,
  cleanupDataRoot,
  finalizeCleanupArchive,
  restoreCleanupArchive,
  summarizeCleanupCandidates,
} from "#app/cleanup";
import { createTempRepo } from "./helpers.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

describe("cleanup", () => {
  it("previews, archives, and deletes only archived cleanup candidates", async () => {
    const { repo, config } = await createTempRepo();
    const outputRoot = repo.layoutPath("outputs");
    await mkdir(join(outputRoot, "text"), { recursive: true });
    await writeFile(join(outputRoot, "text", "2026-07-04.txt"), "daily report", "utf8");
    await mkdir(join(outputRoot, "line"), { recursive: true });
    await writeFile(join(outputRoot, "line", "2026-07-04.txt"), "legacy line report", "utf8");
    await writeFile(join(outputRoot, "one-off.html"), "<html></html>", "utf8");
    await mkdir(join(outputRoot, "screenshots"), { recursive: true });
    await writeFile(join(outputRoot, "screenshots", "01.png"), "png", "utf8");

    const preview = await cleanupDataRoot(repo, config, { action: "preview" });

    expect(preview.total_count).toBe(3);
    expect(preview.candidates.map((candidate) => candidate.relative_path).sort()).toEqual([
      "outputs/line",
      "outputs/one-off.html",
      "outputs/screenshots",
    ]);
    expect(await readFile(join(outputRoot, "text", "2026-07-04.txt"), "utf8")).toBe("daily report");

    const archived = await cleanupDataRoot(repo, config, { action: "archive" });

    expect(archived.total_count).toBe(3);
    expect(await exists(join(outputRoot, "line"))).toBe(false);
    expect(await exists(join(outputRoot, "one-off.html"))).toBe(false);
    expect(await exists(join(outputRoot, "screenshots"))).toBe(false);
    expect(await readFile(join(outputRoot, "text", "2026-07-04.txt"), "utf8")).toBe("daily report");
    expect(archived.candidates.every((candidate) => candidate.archived_to)).toBe(true);
    const archivedPaths = archived.candidates
      .map((candidate) => candidate.archived_to)
      .filter((path): path is string => Boolean(path));
    expect(archivedPaths.length).toBe(3);
    await Promise.all(archivedPaths.map(async (path) => expect(await exists(path)).toBe(true)));

    const restorePreview = await restoreCleanupArchive(repo, config, { target: "outputs", dry_run: true });
    expect(restorePreview.total_count).toBe(3);
    expect(restorePreview.candidates.map((candidate) => candidate.restore_to).sort()).toEqual([
      join(outputRoot, "line"),
      join(outputRoot, "one-off.html"),
      join(outputRoot, "screenshots"),
    ]);

    const restored = await restoreCleanupArchive(repo, config, { target: "outputs", dry_run: false });
    expect(restored.candidates.every((candidate) => candidate.restored)).toBe(true);
    expect(await exists(join(outputRoot, "line"))).toBe(true);
    expect(await exists(join(outputRoot, "one-off.html"))).toBe(true);
    expect(await exists(join(outputRoot, "screenshots"))).toBe(true);
    await Promise.all(archivedPaths.map(async (path) => expect(await exists(path)).toBe(false)));

    await cleanupDataRoot(repo, config, { action: "archive" });
    const reArchived = await restoreCleanupArchive(repo, config, { target: "outputs", dry_run: true });
    const reArchivedPaths = reArchived.candidates.map((candidate) => candidate.path);

    await writeFile(join(outputRoot, "new-unarchived.html"), "<html>new</html>", "utf8");
    const deleted = await cleanupDataRoot(repo, config, { action: "delete" });

    expect(deleted.total_count).toBe(3);
    expect(deleted.candidates.every((candidate) => candidate.deleted)).toBe(true);
    await Promise.all(reArchivedPaths.map(async (path) => expect(await exists(path)).toBe(false)));
    expect(await exists(join(outputRoot, "new-unarchived.html"))).toBe(true);
    expect(await readFile(join(outputRoot, "text", "2026-07-04.txt"), "utf8")).toBe("daily report");
  });

  it("supports cleanup targets outside outputs", async () => {
    const { repo, config } = await createTempRepo();
    const backupRoot = repo.layoutPath("backups");
    await mkdir(join(backupRoot, "2026-07-04"), { recursive: true });
    await writeFile(join(backupRoot, "2026-07-04", "tasks.yaml.bak"), "backup", "utf8");
    await writeFile(repo.pathFor(".DS_Store"), "junk", "utf8");
    await mkdir(repo.pathFor("cleanup_archive", "2026-07-04", "outputs"), { recursive: true });
    await writeFile(repo.pathFor("cleanup_archive", "2026-07-04", "outputs", ".DS_Store"), "archived junk", "utf8");

    const backupPreview = await cleanupDataRoot(repo, config, { action: "preview", target: "backups" });
    const junkPreview = await cleanupDataRoot(repo, config, { action: "preview", target: "system_junk" });

    expect(backupPreview.candidates).toMatchObject([
      { target: "backups", kind: "backup_dir", relative_path: "backups/2026-07-04" },
    ]);
    expect(junkPreview.candidates).toMatchObject([
      { target: "system_junk", kind: "system_junk", relative_path: ".DS_Store" },
    ]);

    const archived = await cleanupDataRoot(repo, config, { action: "archive", target: "all" });

    expect(archived.candidates.map((candidate) => candidate.target).sort()).toEqual(["backups", "system_junk"]);
    expect(await exists(join(backupRoot, "2026-07-04"))).toBe(false);
    expect(await exists(repo.pathFor(".DS_Store"))).toBe(false);
  });

  it("summarizes cleanup candidates before archive", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Task 1" }],
      },
      "seed",
    );
    const outputRoot = repo.layoutPath("outputs");
    await mkdir(outputRoot, { recursive: true });
    await writeFile(join(outputRoot, "task-1-proof.html"), "<html>proof</html>", "utf8");

    const result = await summarizeCleanupCandidates(repo, config, {
      target: "outputs",
      source: "current",
      write: true,
    });

    expect(result.summary.candidate_count).toBe(1);
    expect(result.summary.inferred_task_ids).toEqual(["task-1"]);
    expect(result.summary.files).toMatchObject([
      {
        relative_path: "outputs/task-1-proof.html",
        target: "outputs",
        inferred_task_ids: ["task-1"],
        content_kind: "text",
      },
    ]);
    expect(result.summary.files[0]?.summary?.join(" ")).toContain("proof");
    const saved = await repo.loadCleanupSummaries(result.date);
    expect(saved.summaries[0]?.summary_id).toBe(result.summary.summary_id);
  });

  it("archives cleanup candidates and records a restorable archive summary in one flow", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Task 1" }],
      },
      "seed",
    );
    const outputRoot = repo.layoutPath("outputs");
    await mkdir(outputRoot, { recursive: true });
    await writeFile(join(outputRoot, "task-1-proof.html"), "<html>proof</html>", "utf8");

    const result = await archiveCleanup(repo, config, {
      target: "outputs",
      archive_date: "2026-07-04",
      dry_run: false,
    });

    expect(result.archive.total_count).toBe(1);
    expect(result.summary.source).toBe("archive");
    expect(result.summary.archive_date).toBe("2026-07-04");
    expect(result.summary.files).toMatchObject([
      {
        relative_path: "cleanup_archive/2026-07-04/outputs/task-1-proof.html",
        target: "outputs",
        inferred_task_ids: ["task-1"],
        restore_to: join(outputRoot, "task-1-proof.html"),
        content_kind: "text",
      },
    ]);
    expect(result.summary.files[0]?.summary?.join(" ")).toContain("proof");
    expect(await exists(join(outputRoot, "task-1-proof.html"))).toBe(false);
    expect(await exists(repo.pathFor("cleanup_archive", "2026-07-04", "outputs", "task-1-proof.html"))).toBe(true);
    const saved = await repo.loadCleanupSummaries(result.summary_date);
    expect(saved.summaries[0]?.summary_id).toBe(result.summary.summary_id);
  });

  it("records an untruncated manifest for more than 200 archived candidates", async () => {
    const { repo, config } = await createTempRepo();
    const outputRoot = repo.layoutPath("outputs");
    await mkdir(outputRoot, { recursive: true });
    await Promise.all(
      Array.from({ length: 201 }, (_, index) =>
        writeFile(join(outputRoot, `legacy-${String(index).padStart(3, "0")}.txt`), `legacy ${index}`, "utf8"),
      ),
    );

    const result = await archiveCleanup(repo, config, {
      target: "outputs",
      archive_date: "2026-07-04",
      dry_run: false,
    });

    expect(result.archive.total_count).toBe(201);
    expect(result.summary.candidate_count).toBe(201);
    expect(result.summary.files).toHaveLength(201);
    expect(result.summary.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relative_path: "cleanup_archive/2026-07-04/outputs/legacy-200.txt",
          size_bytes: 10,
          restore_to: join(outputRoot, "legacy-200.txt"),
        }),
      ]),
    );
  });

  it("records every file inside an archived directory with a restore destination", async () => {
    const { repo, config } = await createTempRepo();
    const outputRoot = repo.layoutPath("outputs");
    await mkdir(join(outputRoot, "legacy", "nested"), { recursive: true });
    await writeFile(join(outputRoot, "legacy", "first.txt"), "first", "utf8");
    await writeFile(join(outputRoot, "legacy", "nested", "second.txt"), "second", "utf8");

    const result = await archiveCleanup(repo, config, {
      target: "outputs",
      archive_date: "2026-07-04",
      dry_run: false,
    });

    expect(result.summary.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relative_path: "cleanup_archive/2026-07-04/outputs/legacy",
          content_kind: "directory",
        }),
        expect.objectContaining({
          relative_path: "cleanup_archive/2026-07-04/outputs/legacy/first.txt",
          size_bytes: 5,
          restore_to: join(outputRoot, "legacy", "first.txt"),
        }),
        expect.objectContaining({
          relative_path: "cleanup_archive/2026-07-04/outputs/legacy/nested/second.txt",
          size_bytes: 6,
          restore_to: join(outputRoot, "legacy", "nested", "second.txt"),
        }),
      ]),
    );
    expect(result.summary.files.find((file) => file.relative_path.endsWith("/legacy"))?.summary?.join(" ")).toContain(
      "descendant files are listed",
    );
  });

  it("rolls back moved candidates when saving the archive summary fails", async () => {
    const { repo, config } = await createTempRepo();
    const outputRoot = repo.layoutPath("outputs");
    await mkdir(outputRoot, { recursive: true });
    await writeFile(join(outputRoot, "legacy.html"), "<html>legacy</html>", "utf8");
    vi.spyOn(repo, "saveCleanupSummaries").mockRejectedValueOnce(new Error("disk full"));

    await expect(
      archiveCleanup(repo, config, {
        target: "outputs",
        archive_date: "2026-07-04",
        dry_run: false,
      }),
    ).rejects.toThrow("all moved candidates were rolled back");

    expect(await exists(join(outputRoot, "legacy.html"))).toBe(true);
    expect(await exists(repo.pathFor("cleanup_archive", "2026-07-04", "outputs", "legacy.html"))).toBe(false);
  });

  it("rejects unsafe archive dates and relative path filters", async () => {
    const { repo, config } = await createTempRepo();

    await expect(
      archiveCleanup(repo, config, {
        archive_date: "../outside",
      }),
    ).rejects.toThrow("archive_date");
    await expect(
      restoreCleanupArchive(repo, config, {
        relative_paths: ["../outside"],
      }),
    ).rejects.toThrow("Unsafe relative path filter");
  });

  it("finalizes only archived cleanup candidates", async () => {
    const { repo, config } = await createTempRepo();
    const outputRoot = repo.layoutPath("outputs");
    await mkdir(outputRoot, { recursive: true });
    await writeFile(join(outputRoot, "legacy.html"), "<html>legacy</html>", "utf8");

    await archiveCleanup(repo, config, {
      target: "outputs",
      archive_date: "2026-07-04",
      dry_run: false,
    });
    await writeFile(join(outputRoot, "new-unarchived.html"), "<html>new</html>", "utf8");

    const finalized = await finalizeCleanupArchive(repo, config, {
      target: "outputs",
      archive_date: "2026-07-04",
      dry_run: false,
    });

    expect(finalized.deleted.total_count).toBe(1);
    expect(await exists(repo.pathFor("cleanup_archive", "2026-07-04", "outputs", "legacy.html"))).toBe(false);
    expect(await exists(join(outputRoot, "new-unarchived.html"))).toBe(true);
  });
});
