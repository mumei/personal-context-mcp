/**
 * Regression coverage for Repository transaction rollback and serialization.
 *
 * These tests verify the stable Repository facade, not lock-file internals or
 * domain workflows.
 *
 * Repositoryのトランザクションロールバックと直列化に関する回帰テストです。
 *
 * これらのテストは安定したRepositoryファサードを検証し、ロックファイルの内部実装や
 * ドメインワークフローは検証対象としません。
 *
 * @packageDocumentation
 */

import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Repository } from "#infra/repository/repository";
import { createTempRepo } from "./helpers.ts";

describe("repository transactions", () => {
  it("restores every touched file when a multi-file operation fails", async () => {
    const { repo } = await createTempRepo();
    const existing = repo.pathFor("existing.txt");
    const created = repo.pathFor("created.txt");
    await repo.replaceTextAtomic(existing, "before");

    await expect(
      repo.withTransaction(async () => {
        await repo.replaceTextAtomic(existing, "after");
        await repo.replaceTextAtomic(created, "temporary");
        throw new Error("commit failed");
      }),
    ).rejects.toThrow("commit failed");

    await expect(readFile(existing, "utf8")).resolves.toBe("before");
    await expect(readFile(created, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes backups created by a rolled-back transaction", async () => {
    const { repo, config } = await createTempRepo();
    const output = repo.pathFor(config.layout.outputs, "text", "2026-07-16.txt");
    await repo.saveOutput("text", "2026-07-16", "before", "seed");

    await expect(
      repo.withTransaction(async () => {
        await repo.saveOutput("text", "2026-07-16", "after", "transaction-write");
        throw new Error("rollback requested");
      }),
    ).rejects.toThrow("rollback requested");

    await expect(readFile(output, "utf8")).resolves.toBe("before");
    const backupRoot = repo.pathFor(config.layout.backups);
    const backupDates = await readdir(backupRoot);
    const backupFiles = (
      await Promise.all(backupDates.map(async (date) => readdir(repo.pathFor(config.layout.backups, date))))
    ).flat();
    expect(backupFiles.some((name) => name.includes("transaction-write"))).toBe(false);
  });

  it("serializes repository instances that share a data root", async () => {
    const { repo, config } = await createTempRepo();
    const secondRepo = new Repository(config);
    const events: string[] = [];
    let markFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = repo.withTransaction(async () => {
      events.push("first-start");
      markFirstStarted();
      await firstRelease;
      events.push("first-end");
    });
    await firstStarted;
    const second = secondRepo.withTransaction(async () => {
      events.push("second-start");
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(events).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });
});
