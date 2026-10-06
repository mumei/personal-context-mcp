import { describe, expect, it } from "vitest";
import {
  applyTaskMemoryPromotion,
  buildTaskMemoryPromotionPrompt,
  normalizeMemoryMindMap,
  parseTaskMemoryPromotion,
  updateGlobalMemory,
  updateReportSummary,
  updateTaskMemory,
  updateTaskMemoryMindMap,
} from "#domain/memory/actions";
import { createTempRepo } from "./helpers.ts";

describe("memory actions", () => {
  it("stores task, global, and report state separately", async () => {
    const { repo } = await createTempRepo();
    await updateTaskMemory(repo, {
      task_id: "task-1",
      mode: "append",
      summary: ["認証調査が継続中"],
      next: ["制限条件を確認する"],
    });
    await updateGlobalMemory(repo, { mode: "append", rules: ["作業原本を変更しない"] });
    await updateReportSummary(repo, "2026-07-04", { mode: "replace", done: ["認証条件を確認"] });

    await expect(repo.loadTaskMemory("task-1")).resolves.toMatchObject({ summary: ["認証調査が継続中"] });
    await expect(repo.loadGlobalMemory()).resolves.toMatchObject({ rules: ["作業原本を変更しない"] });
    await expect(repo.loadReportSummary("2026-07-04")).resolves.toMatchObject({ done: ["認証条件を確認"] });
  });

  it("builds promotion input from existing memory, context, inputs, and activities", async () => {
    const { repo } = await createTempRepo();
    const task = {
      id: "task-1",
      title: "認証対応",
      status: "inProgress" as const,
      tier: 1 as const,
      context: "contexts/task-1.md",
    };
    await repo.saveTasks({ tasks: [task] }, "seed");
    await repo.saveTaskContext(task, { data: { summary: ["OAuthを利用"] }, body: "既存認証方式を維持する。" }, "seed");
    await updateTaskMemory(repo, { task_id: task.id, mode: "replace", facts: ["APIキーは環境変数で管理"] });
    await repo.saveInputs(
      "2026-07-04",
      {
        date: "2026-07-04",
        items: [{ id: "mail-1", type: "email", title: "API制限", related_task_id: task.id }],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [{ task_id: task.id, done: ["API制限を確認"], next: ["再試行条件を整理"] }],
      },
      "seed",
    );

    const result = await buildTaskMemoryPromotionPrompt(repo, "2026-07-04", { task_id: task.id });

    expect(result.skipped).toBe(false);
    expect(result.sources.existing_memory.facts).toEqual(["APIキーは環境変数で管理"]);
    expect(result.sources.task_context.body.text).toContain("既存認証方式");
    expect(result.sources.inputs[0]?.items).toHaveLength(1);
    expect(result.sources.activities[0]?.entries).toHaveLength(1);
    expect(result.prompt).toContain("complete latest task-memory state");
    expect(result.prompt).toContain("meaningful 4-6 level paths");
  });

  it("replaces managed memory fields and skips an unchanged promotion input", async () => {
    const { repo } = await createTempRepo();
    const task = { id: "task-1", title: "認証対応", status: "inProgress" as const, tier: 1 as const };
    await repo.saveTasks({ tasks: [task] }, "seed");
    await updateTaskMemory(repo, {
      task_id: task.id,
      mode: "replace",
      facts: ["古い方式を利用"],
      risks: ["解消済みリスク"],
    });
    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [{ task_id: task.id, done: ["新方式へ移行"], next: ["本番確認"] }],
      },
      "seed",
    );
    const prompt = await buildTaskMemoryPromotionPrompt(repo, "2026-07-04", { task_id: task.id });
    const parsed = parseTaskMemoryPromotion(
      JSON.stringify({
        task_id: task.id,
        summary: ["新方式への移行が完了"],
        facts: ["新方式を利用"],
        decisions: [],
        risks: [],
        next: ["本番確認"],
        mindmap: {
          root: "認証対応",
          children: [{ label: "移行", children: [{ label: "新方式", children: [] }] }],
        },
        sources: [{ date: "2026-07-04", task_id: task.id, section: "done" }],
      }),
      task.id,
    );

    await applyTaskMemoryPromotion(repo, { task_id: task.id, input_hash: prompt.input_hash, ...parsed });
    const memory = await repo.loadTaskMemory(task.id);
    expect(memory.facts).toEqual(["新方式を利用"]);
    expect(memory.risks).toBeUndefined();
    expect(memory.input_hash).toBe(prompt.input_hash);
    expect(memory.applied_at).toBeTruthy();
    expect(memory.mindmap).toEqual({
      root: "認証対応",
      children: [{ label: "移行", children: [{ label: "新方式" }] }],
    });

    const duplicate = await buildTaskMemoryPromotionPrompt(repo, "2026-07-04", { task_id: task.id });
    expect(duplicate).toMatchObject({ skipped: true, skip_reason: "duplicate_input" });

    await repo.saveActivity(
      "2026-07-04",
      {
        date: "2026-07-04",
        entries: [
          { task_id: task.id, done: ["新方式へ移行"], next: ["本番確認"] },
          { task_id: task.id, done: ["本番確認が完了"] },
        ],
      },
      "append",
    );
    const changed = await buildTaskMemoryPromotionPrompt(repo, "2026-07-04", { task_id: task.id });
    expect(changed.skipped).toBe(false);
    expect(changed.input_hash).not.toBe(prompt.input_hash);
  });

  it("rejects an LLM response for another task", () => {
    expect(() => parseTaskMemoryPromotion('{"task_id":"other","summary":[]}', "task-1")).toThrow("not task-1");
  });

  it("updates only the visualization while preserving durable memory and checkpoints", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTaskMemory(
      "task-1",
      {
        task_id: "task-1",
        summary: ["既存要約"],
        facts: ["既存事実"],
        sources: [{ path: "/private/source.md" }],
        input_hash: "checkpoint",
        applied_at: "2026-07-12T00:00:00.000Z",
      },
      "seed",
    );

    await updateTaskMemoryMindMap(repo, "task-1", {
      root: "対象タスク",
      children: [{ label: "現在地", children: [{ label: "実装完了" }] }],
    });

    const memory = await repo.loadTaskMemory("task-1");
    expect(memory).toMatchObject({
      summary: ["既存要約"],
      facts: ["既存事実"],
      sources: [{ path: "/private/source.md" }],
      input_hash: "checkpoint",
      applied_at: "2026-07-12T00:00:00.000Z",
      mindmap: { root: "対象タスク", children: [{ label: "現在地", children: [{ label: "実装完了" }] }] },
    });
  });

  it("builds shared AI concept paths and bounds depth, width, and label length", () => {
    const mindmap = normalizeMemoryMindMap({
      root: "非常に長いルートラベルを安全な長さへ切り詰めるための文字列",
      paths: [
        ["世田谷区", "収集状況", "iタウンページ", "詳細取得", "5,165件完了", "保存済み", "深すぎる"],
        ["世田谷区", "収集状況", "業種媒体", "期待値", "再集計中"],
        ...Array.from({ length: 8 }, (_, index) => [`分類${index}`, "詳細"]),
      ],
    });

    expect(mindmap?.root.length).toBeLessThanOrEqual(32);
    expect(mindmap?.children).toHaveLength(7);
    expect(mindmap?.children[0]?.children).toHaveLength(1);
    expect(mindmap?.children[0]?.children?.[0]?.children).toHaveLength(2);
    expect(
      mindmap?.children[0]?.children?.[0]?.children?.[0]?.children?.[0]?.children?.[0]?.children?.[0]?.children,
    ).toBeUndefined();
  });
});
