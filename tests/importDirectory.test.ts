import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importTaskDirectory } from "#app/importDirectory";
import { createTempRepo } from "./helpers.ts";

describe("importTaskDirectory", () => {
  it("defaults to a read-only dry-run", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "task-mcp-source-preview-"));
    await writeFile(join(sourceRoot, "tasks.yaml"), "tasks:\n  - id: previewed\n    title: Previewed task\n", "utf8");
    const { repo } = await createTempRepo();

    const result = await importTaskDirectory(repo, {
      source_root: sourceRoot,
      source_layout: { tasks: "tasks.yaml" },
    });

    expect(result.dry_run).toBe(true);
    expect(result.copied).toEqual([
      expect.objectContaining({ from: join(sourceRoot, "tasks.yaml"), to: repo.layoutPath("tasks"), kind: "file" }),
    ]);
    await expect(readFile(repo.layoutPath("tasks"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("imports an existing layout into the configured data root", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "task-mcp-source-"));
    await mkdir(join(sourceRoot, "task_contexts"), { recursive: true });
    await mkdir(join(sourceRoot, "journal"), { recursive: true });
    await mkdir(join(sourceRoot, "inbox"), { recursive: true });
    await mkdir(join(sourceRoot, "report"), { recursive: true });
    await mkdir(join(sourceRoot, "reports"), { recursive: true });
    await mkdir(join(sourceRoot, "projects"), { recursive: true });
    await writeFile(
      join(sourceRoot, "tasks.yaml"),
      "tasks:\n  - id: imported-1\n    title: Imported task\n    status: inProgress\n    context: task_contexts/imported-1.md\n",
      "utf8",
    );
    await writeFile(join(sourceRoot, "task_contexts", "imported-1.md"), "---\ntitle: Imported\n---\nContext\n", "utf8");
    await writeFile(join(sourceRoot, "journal", "2026-07-04.yaml"), "date: 2026-07-04\nentries: []\n", "utf8");
    await writeFile(join(sourceRoot, "inbox", "2026-07-04.yaml"), "date: 2026-07-04\nitems: []\n", "utf8");
    await writeFile(join(sourceRoot, "report", "2026-07-04.yaml"), "date: 2026-07-04\nentries: []\n", "utf8");
    await writeFile(join(sourceRoot, "reports", "daily.txt"), "Daily output\n", "utf8");
    await writeFile(join(sourceRoot, "projects", "example.md"), "Project notes\n", "utf8");
    const { repo } = await createTempRepo();

    const result = await importTaskDirectory(repo, {
      source_root: sourceRoot,
      source_layout: {
        tasks: "tasks.yaml",
        contexts: "task_contexts",
        inputs: "inbox",
        activities: "journal",
        reports: "report",
        outputs: "reports",
      },
      extra_paths: ["projects"],
      dry_run: false,
    });

    expect(result.warnings).toEqual([]);
    expect(result.copied.map((entry) => entry.to)).toEqual(
      expect.arrayContaining([
        repo.layoutPath("tasks"),
        repo.layoutPath("contexts"),
        repo.layoutPath("activities"),
        repo.layoutPath("inputs"),
        repo.layoutPath("reports"),
        repo.layoutPath("outputs"),
        repo.pathFor("projects"),
      ]),
    );
    await expect(repo.loadTasks()).resolves.toMatchObject({
      tasks: [{ id: "imported-1", context: "contexts/imported-1.md" }],
    });
    await expect(readFile(repo.layoutPath("contexts", "imported-1.md"), "utf8")).resolves.toContain("Context");
    await expect(readFile(repo.pathFor("projects", "example.md"), "utf8")).resolves.toContain("Project notes");
  });
});
