import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { submitAgentUpdate } from "#domain/agent-updates/workflow";
import { searchKnowledge, upsertKnowledgeNote } from "#domain/knowledge/actions";
import { recordPersonInteraction, upsertPersonProfile } from "#domain/people/actions";
import { defaultBackupCleanup, defaultLayout } from "#infra/config/config";
import { getKnowledgeUsageSummary, recordKnowledgeUsage } from "#infra/audit/knowledgeUsage";
import { resolveDate } from "#shared/date";
import { Repository } from "#infra/repository/repository";
import {
  buildOverview,
  buildActivityCalendar,
  checkMorningTaskProgress,
  createTaskMcpWebServer,
  generateMorningTaskSections,
  generateWebMorningSummary,
  isWebServerEnabled,
  mergeMorningTaskSections,
  organizeWebTaskInformation,
  parseMorningBrief,
  parseWebServerOptions,
  renderMarkdownBody,
  resolveWebAgentUpdatesWithAi,
  stopTaskMcpWebServer,
} from "#webServer";
import { createTempRepo } from "./helpers.ts";
import type { TaskMcpConfig } from "#shared/types";

describe("web server", () => {
  async function request(
    server: ReturnType<typeof createTaskMcpWebServer>,
    path: string,
    token?: string,
  ): Promise<{ status: number; headers: Record<string, string | number> }> {
    return await new Promise((resolve) => {
      let status = 0;
      let headers: Record<string, string | number> = {};
      const response = {
        writeHead(statusCode: number, responseHeaders: Record<string, string | number>) {
          status = statusCode;
          headers = responseHeaders as Record<string, string | number>;
          return response as ServerResponse;
        },
        end() {
          resolve({ status, headers });
          return response as ServerResponse;
        },
      };
      server.emit(
        "request",
        {
          method: "GET",
          url: path,
          headers: token ? { authorization: `Bearer ${token}` } : {},
        } as IncomingMessage,
        response as ServerResponse,
      );
    });
  }

  async function liveRequest(
    server: ReturnType<typeof createTaskMcpWebServer>,
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    try {
      return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
    } finally {
      await stopTaskMcpWebServer(server);
    }
  }

  it("builds overview data from the repository", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [
          { id: "task-1", title: "Task 1", status: "inProgress", tier: 1 },
          { id: "task-2", title: "Task 2", status: "done", tier: 3 },
          { id: "duplicate", title: "Duplicate", status: "inProgress", tier: 1, deleted: true },
        ],
      },
      "seed",
    );
    await repo.saveReportSummary(
      "2026-07-04",
      {
        date: "2026-07-04",
        headline: "Today summary",
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-02",
      { date: "2026-07-02", entries: [{ task_id: "task-2", done: ["Older update"] }] },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-03",
      { date: "2026-07-03", entries: [{ task_id: "task-1", done: ["Newer update"] }] },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-04",
      { date: "2026-07-04", entries: [{ task_id: "task-1", done: ["Unreflected update"] }] },
      "seed",
    );

    const overview = await buildOverview(repo, config, "2026-07-04");
    expect(overview.operational_range).toMatchObject({ date: "2026-07-04", timezone: config.timezone });

    expect(overview.counts.inProgress).toBe(1);
    expect(overview.counts.done).toBe(1);
    expect(overview.report_summary).toMatchObject({ headline: "Today summary" });
    expect(overview.tasks).toHaveLength(2);
    expect(overview.tasks.map((task) => task.id)).not.toContain("duplicate");
    expect(overview.morning_brief.available).toBe(false);
    expect(overview.today).toBe(resolveDate(undefined, config));
    expect(overview.morning_task_progress["task-1"]).toMatchObject({
      status: "inProgress",
      updated_on_date: true,
      completed: false,
    });
    expect(overview.morning_task_progress["task-2"]).toMatchObject({ status: "done", completed: true });
    expect(overview.task_last_updated).toEqual({ "task-1": "2026-07-04", "task-2": "2026-07-02" });
    expect(overview.report_sync).toMatchObject({
      date: "2026-07-04",
      pending_count: 1,
      tasks: [{ task_id: "task-1", pending_activity_count: 1, total_activity_count: 1 }],
    });
  });

  it("builds a bounded Activity calendar without merging parallel entries", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveActivity(
      "2026-07-20",
      {
        date: "2026-07-20",
        entries: [
          {
            activity_id: "activity-a",
            task_id: "task-a",
            project: "Project A",
            title: "Parallel A",
            occurred_at: "2026-07-20T10:00:00+09:00",
            done: ["Completed A"],
          },
          {
            activity_id: "activity-b",
            task_id: "task-b",
            project: "Project B",
            title: "Parallel B",
            occurred_at: "2026-07-20T10:00:00+09:00",
            done: ["Completed B"],
          },
        ],
      },
      "seed",
    );

    const calendar = await buildActivityCalendar(repo, config, "2026-07-19", "2026-07-25");

    expect(calendar.events).toHaveLength(2);
    expect(calendar.events.map((event) => event.id)).toEqual(["activity-a", "activity-b"]);
    expect(calendar.daily_counts).toEqual({ "2026-07-20": 2 });
    expect(calendar.projects).toEqual(["Project A", "Project B"]);
    expect(calendar).toMatchObject({ timezone: config.timezone, rollover_hour: config.activityRolloverHour });
  });

  it("initializes calendar API with local today while leaving overview on the work date", async () => {
    const { repo, config } = await createTempRepo();
    config.timezone = "Asia/Tokyo";
    config.activityRolloverHour = 4;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-31T16:00:00Z"));
    try {
      const response = await liveRequest(createTaskMcpWebServer(repo, config), "/api/activity-calendar");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        today: "2026-08-01",
        from: "2026-08-01",
        to: "2026-08-01",
        timezone: "Asia/Tokyo",
      });
      expect((await buildOverview(repo, config)).today).toBe("2026-07-31");
      const invalid = await liveRequest(createTaskMcpWebServer(repo, config), "/api/activity-calendar?from=2026-08-01");
      expect(invalid.status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves the dashboard for reloadable UI routes", async () => {
    const { repo, config } = await createTempRepo();
    for (const path of [
      "/summary",
      "/report/markdown",
      "/global",
      "/activity",
      "/help",
      "/settings",
      "/tasks/task-1/memory?date=2026-07-15",
    ]) {
      const response = await liveRequest(createTaskMcpWebServer(repo, config), path);
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toContain("<title>Personal Context MCP</title>");
    }
  });

  it("toggles task report visibility and rerenders the selected date", async () => {
    const { repo, config } = await createTempRepo();
    const date = "2026-07-24";
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Report task", status: "inProgress", tier: 1 }] }, "seed");
    await repo.saveReport(
      date,
      { date, entries: [{ task_id: "task-1", done: ["Visible report result"], next: [] }] },
      "seed",
    );

    const response = await liveRequest(createTaskMcpWebServer(repo, config), "/api/task/task-1/report-visibility", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visible: false, date }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      task: { id: "task-1", report_exclude: true },
      visible: false,
      date,
    });
    await expect(repo.loadTasks()).resolves.toMatchObject({
      tasks: [{ id: "task-1", report_exclude: true }],
    });
    await expect(repo.loadOutput("text", date, "txt")).resolves.not.toContain("Visible report result");
    await expect(repo.loadOutput("markdown", date, "md")).resolves.not.toContain("Visible report result");
  });

  it("embeds route diagnostics from the original server request", async () => {
    const { repo, config } = await createTempRepo();
    const response = await liveRequest(
      createTaskMcpWebServer(repo, config),
      "/report/text?date=2026-07-17&route_debug=1",
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('id="task-mcp-request-context"');
    expect(html).toContain('"requested_path":"/report/text"');
    expect(html).toContain('"requested_search":"?date=2026-07-17\\u0026route_debug=1"');
    expect(html).toContain('"route_debug":true');
  });

  it("parses all morning brief sections and the personal task table", () => {
    const brief = parseMorningBrief(
      "2026-07-14",
      [
        "2026/07/14（火）モーニングブリーフ",
        "",
        "1. 今日の予定",
        "- 予定なし",
        "2. 重要な未読メール",
        "- 重要な未読メールなし",
        "3. GitHub Issue確認",
        "- 27リポジトリを確認。",
        "4. 今日注意が必要なタスク",
        "- 仕事探し: 選考結果を確認。",
        "5. 本日のワタシ用タスク表",
        "優先\tタスク名\t今日やること\t今日のゴール",
        "1\t仕事探し\t選考結果を確認\t次のアクションを確定",
        "保留\tLocalLLM\t緊急度が上がるまで保留\t優先タスクへ集中",
        "6. 今日の推奨アクション",
        "最初にSESの選考確認を済ませる。",
      ].join("\n"),
    );

    expect(brief.available).toBe(true);
    expect(brief.sections).toHaveLength(6);
    expect(brief.sections[2]).toMatchObject({
      title: "GitHub Issue確認",
      preview: "27リポジトリを確認。",
      items: ["27リポジトリを確認。"],
    });
    expect(brief.sections[4]?.table).toEqual({
      headers: ["優先", "タスク名", "今日やること", "今日のゴール"],
      rows: [
        ["1", "仕事探し", "選考結果を確認", "次のアクションを確定"],
        ["保留", "LocalLLM", "緊急度が上がるまで保留", "優先タスクへ集中"],
      ],
    });
    expect(brief.sections[5]?.paragraphs).toEqual(["最初にSESの選考確認を済ませる。"]);
  });

  it("creates a bounded GitHub preview even when the first issue is long", () => {
    const longIssue = `Akarie/example #123: ${"長いIssueタイトル".repeat(20)}`;
    const brief = parseMorningBrief(
      "2026-07-14",
      ["2026/07/14 ブリーフィング", "3. GitHub Issue確認", `- ${longIssue}`].join("\n"),
    );

    expect(brief.sections[2]?.preview).toHaveLength(80);
    expect(brief.sections[2]?.preview).toMatch(/…$/);
  });

  it("marks missing morning brief sections without hiding available content", () => {
    const brief = parseMorningBrief("2026-07-14", "2026/07/14 モーニングブリーフ\n\n1. 今日の予定\n- 予定なし\n");

    expect(brief.sections).toHaveLength(6);
    expect(brief.sections[0]).toMatchObject({ available: true, items: ["予定なし"] });
    expect(brief.sections[3]).toMatchObject({ available: false, title: "今日注意が必要なタスク" });
  });

  it("merges generated task sections into an external morning brief", () => {
    const merged = mergeMorningTaskSections(
      [
        "2026/07/14 モーニングブリーフ",
        "1. 今日の予定",
        "- 予定なし",
        "2. 重要な未読メール",
        "- なし",
        "3. GitHub Issue確認",
        "- 27件",
        "4. 古い内容",
        "- 置換対象",
      ].join("\n"),
      {
        attention: ["仕事探し: 選考結果を確認する。"],
        task_table: [
          {
            priority: "1",
            task_id: "job-search-daily",
            task_name: "仕事探し",
            today_action: "選考結果を確認",
            today_goal: "次の行動を確定",
          },
        ],
        recommendation: "最初にSESの確認を進める。",
      },
    );

    expect(merged).not.toContain("古い内容");
    expect(merged).toContain("4. 今日注意が必要なタスク");
    expect(merged).toContain("仕事探し <!--task-id:job-search-daily-->");
    expect(parseMorningBrief("2026-07-14", merged).sections.every((section) => section.available)).toBe(true);
  });

  it("generates and saves task sections only for today", async () => {
    const { repo, config } = await createTempRepo();
    const today = resolveDate(undefined, config);
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1", status: "inProgress", tier: 1 }] }, "seed");
    await repo.saveGlobalMemory(
      { preferences: ["結論を先に書く"], rules: ["ユーザー向けURLを保持する"] },
      "seed-global-memory",
    );
    await upsertKnowledgeNote(repo, {
      id: "task-planning",
      title: "Task planning",
      type: "concept",
      aliases: ["Task 1"],
      tags: ["planning"],
      summary: "Plan one concrete action and one verifiable goal.",
      evidence: [{ statement: "Plans need a concrete action.", rationale: "Concrete actions can be verified." }],
      body: "Use a concrete action and a verifiable goal when planning work.",
    });
    await repo.saveOutput(
      "morning",
      today,
      [
        `${today} モーニングブリーフ`,
        "1. 今日の予定",
        "- PRIVATE_CALENDAR_CONTENT",
        "2. 重要な未読メール",
        "- PRIVATE_MAIL_CONTENT",
        "3. GitHub Issue確認",
        "- PRIVATE_GITHUB_CONTENT",
      ].join("\n"),
      "seed",
      "md",
    );
    await repo.saveOutput(
      "morning-progress",
      today,
      JSON.stringify({
        date: today,
        checked_at: new Date().toISOString(),
        items: [{ task_id: "task-1", state: "aligned", assessment: "old", evidence: [] }],
      }),
      "seed",
      "json",
    );
    const generated = JSON.stringify({
      attention: ["Task 1: 次の作業を確認する。"],
      task_table: [
        {
          priority: "1",
          task_id: "task-1",
          task_name: "Task 1",
          today_action: "次の作業を確認",
          today_goal: "実行内容を確定",
        },
      ],
      recommendation: "Task 1から開始する。",
    });

    const result = await generateMorningTaskSections(repo, config, today, async (input) => {
      expect(input.prompt).toContain('"task_id":"task-1"');
      expect(input.prompt).toContain('"preferences":["結論を先に書く"]');
      expect(input.prompt).toContain('"rules":["ユーザー向けURLを保持する"]');
      expect(input.prompt).toContain("mandatory user-wide operating constraints");
      expect(input.prompt).toContain("task-planning");
      expect(input.prompt).not.toContain("PRIVATE_CALENDAR_CONTENT");
      expect(input.prompt).not.toContain("PRIVATE_MAIL_CONTENT");
      expect(input.prompt).not.toContain("PRIVATE_GITHUB_CONTENT");
      return { text: generated, threadId: "thread", turnId: "turn" };
    });

    expect(result.document.sections[5]).toMatchObject({ available: true, paragraphs: ["Task 1から開始する。"] });
    await expect(getKnowledgeUsageSummary(repo)).resolves.toMatchObject({
      injected_event_count: 1,
      injected_note_count: 1,
      recent_events: [
        expect.objectContaining({
          workflow: "briefing_generate_daily",
          stage: "injected_to_llm",
          knowledge_ids: ["task-planning"],
        }),
      ],
    });
    expect(await repo.loadOutput("morning", today, "md")).toContain("5. 本日のワタシ用タスク表");
    await expect(repo.loadOutput("morning-progress", today, "json")).resolves.toContain('"items": []');
    await expect(
      generateMorningTaskSections(repo, config, "2000-01-01", async () => ({ text: generated })),
    ).rejects.toThrow("only be generated for today");

    const unknownTask = generated.replace('"task-1"', '"unknown-task"');
    await expect(generateMorningTaskSections(repo, config, today, async () => ({ text: unknownTask }))).rejects.toThrow(
      "not an active input task",
    );

    const duplicatedTask = JSON.stringify({
      ...JSON.parse(generated),
      task_table: [...JSON.parse(generated).task_table, ...JSON.parse(generated).task_table],
    });
    await expect(
      generateMorningTaskSections(repo, config, today, async () => ({ text: duplicatedTask })),
    ).rejects.toThrow("duplicate task_id");

    await expect(
      generateMorningTaskSections(repo, config, today, async () => ({
        text: JSON.stringify({ attention: [], task_table: [], recommendation: "対象なし。" }),
      })),
    ).rejects.toThrow("empty task table despite active input tasks");

    const sevenRows = JSON.stringify({
      ...JSON.parse(generated),
      task_table: Array.from({ length: 7 }, (_, index) => ({
        ...JSON.parse(generated).task_table[0],
        task_id: `task-${index + 1}`,
      })),
    });
    await expect(generateMorningTaskSections(repo, config, today, async () => ({ text: sevenRows }))).rejects.toThrow(
      "invalid task table",
    );
  });

  it("generates empty task sections when there are no active tasks", async () => {
    const { repo, config } = await createTempRepo();
    const today = resolveDate(undefined, config);
    await repo.saveTasks({ tasks: [{ id: "done-task", title: "Done", status: "done" }] }, "seed");
    await repo.saveOutput(
      "morning",
      today,
      [
        `${today} ブリーフィング`,
        "1. 今日の予定",
        "- 予定なし",
        "2. 重要な未読メール",
        "- なし",
        "3. GitHub Issue確認",
        "- 0件",
      ].join("\n"),
      "seed",
      "md",
    );

    const result = await generateMorningTaskSections(repo, config, today, async () => ({
      text: JSON.stringify({
        attention: [],
        task_table: [],
        recommendation: "優先対応が必要なタスクはありません。",
      }),
    }));

    expect(result.generated.attention).toEqual([]);
    expect(result.generated.task_table).toEqual([]);
    expect(result.document.sections[3]).toMatchObject({ available: true, items: [] });
    expect(result.document.sections[4]?.table?.rows).toEqual([]);
    await expect(checkMorningTaskProgress(repo, config, today, async () => ({ text: "{}" }))).rejects.toThrow(
      "task table has not been generated",
    );
  });

  it("rolls back the briefing when resetting progress fails", async () => {
    const { repo, config } = await createTempRepo();
    const today = resolveDate(undefined, config);
    const originalBrief = [
      `${today} ブリーフィング`,
      "1. 今日の予定",
      "- 予定なし",
      "2. 重要な未読メール",
      "- なし",
      "3. GitHub Issue確認",
      "- 0件",
    ].join("\n");
    const originalProgress = JSON.stringify({
      date: today,
      checked_at: "2026-07-16T00:00:00.000Z",
      items: [{ task_id: "task-1", state: "aligned", assessment: "old", evidence: [] }],
    });
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1", status: "inProgress" }] }, "seed");
    await repo.saveOutput("morning", today, originalBrief, "seed", "md");
    await repo.saveOutput("morning-progress", today, originalProgress, "seed", "json");

    const originalSaveOutput = repo.saveOutput.bind(repo);
    vi.spyOn(repo, "saveOutput").mockImplementation(async (...args) => {
      if (args[0] === "morning-progress") throw new Error("progress write failed");
      return originalSaveOutput(...args);
    });

    await expect(
      generateMorningTaskSections(repo, config, today, async () => ({
        text: JSON.stringify({
          attention: ["Task 1を確認する。"],
          task_table: [
            {
              priority: "1",
              task_id: "task-1",
              task_name: "Task 1",
              today_action: "確認する",
              today_goal: "方針を決める",
            },
          ],
          recommendation: "Task 1から開始する。",
        }),
      })),
    ).rejects.toThrow("progress write failed");

    await expect(repo.loadOutput("morning", today, "md")).resolves.toBe(originalBrief);
    await expect(repo.loadOutput("morning-progress", today, "json")).resolves.toBe(originalProgress);
  });

  it("rejects generation when external briefing sections change during LLM execution", async () => {
    const { repo, config } = await createTempRepo();
    const today = resolveDate(undefined, config);
    const initialBrief = [
      `${today} ブリーフィング`,
      "1. 今日の予定",
      "- 予定なし",
      "2. 重要な未読メール",
      "- なし",
      "3. GitHub Issue確認",
      "- 確認リポジトリ: 27件",
    ].join("\n");
    const refreshedBrief = initialBrief.replace("27件", "28件");
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1", status: "inProgress" }] }, "seed");
    await repo.saveOutput("morning", today, initialBrief, "seed", "md");

    await expect(
      generateMorningTaskSections(repo, config, today, async () => {
        await repo.saveOutput("morning", today, refreshedBrief, "external-refresh", "md");
        return {
          text: JSON.stringify({
            attention: ["Task 1を確認する。"],
            task_table: [
              {
                priority: "1",
                task_id: "task-1",
                task_name: "Task 1",
                today_action: "確認する",
                today_goal: "方針を決める",
              },
            ],
            recommendation: "Task 1から開始する。",
          }),
        };
      }),
    ).rejects.toThrow("inputs changed while the LLM was generating");

    await expect(repo.loadOutput("morning", today, "md")).resolves.toBe(refreshedBrief);
  });

  it("rejects a generated row when its task becomes inactive before saving", async () => {
    const { repo, config } = await createTempRepo();
    const today = resolveDate(undefined, config);
    const brief = [
      `${today} ブリーフィング`,
      "1. 今日の予定",
      "- 予定なし",
      "2. 重要な未読メール",
      "- なし",
      "3. GitHub Issue確認",
      "- 0件",
    ].join("\n");
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1", status: "inProgress" }] }, "seed");
    await repo.saveOutput("morning", today, brief, "seed", "md");

    await expect(
      generateMorningTaskSections(repo, config, today, async () => {
        await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1", status: "done" }] }, "complete-task");
        return {
          text: JSON.stringify({
            attention: ["Task 1を確認する。"],
            task_table: [
              {
                priority: "1",
                task_id: "task-1",
                task_name: "Task 1",
                today_action: "確認する",
                today_goal: "方針を決める",
              },
            ],
            recommendation: "Task 1から開始する。",
          }),
        };
      }),
    ).rejects.toThrow("inputs changed while the LLM was generating");

    await expect(repo.loadOutput("morning", today, "md")).resolves.toBe(brief);
  });

  it("rejects an older concurrent generation after a newer request commits", async () => {
    const { repo, config } = await createTempRepo();
    const today = resolveDate(undefined, config);
    const brief = [
      `${today} ブリーフィング`,
      "1. 今日の予定",
      "- 予定なし",
      "2. 重要な未読メール",
      "- なし",
      "3. GitHub Issue確認",
      "- 0件",
    ].join("\n");
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1", status: "inProgress" }] }, "seed");
    await repo.saveOutput("morning", today, brief, "seed", "md");
    const output = (recommendation: string) =>
      JSON.stringify({
        attention: ["Task 1を確認する。"],
        task_table: [
          {
            priority: "1",
            task_id: "task-1",
            task_name: "Task 1",
            today_action: "確認する",
            today_goal: "方針を決める",
          },
        ],
        recommendation,
      });
    let releaseOlder!: () => void;
    let markOlderStarted!: () => void;
    const olderStarted = new Promise<void>((resolve) => {
      markOlderStarted = resolve;
    });
    const olderRelease = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    const older = generateMorningTaskSections(repo, config, today, async () => {
      markOlderStarted();
      await olderRelease;
      return { text: output("古い生成結果") };
    });
    await olderStarted;
    const newer = await generateMorningTaskSections(repo, config, today, async () => ({
      text: output("新しい生成結果"),
    }));
    releaseOlder();

    await expect(older).rejects.toThrow("newer briefing generation request superseded");
    expect(newer.document.sections[5]?.paragraphs).toEqual(["新しい生成結果"]);
    await expect(repo.loadOutput("morning", today, "md")).resolves.toContain("新しい生成結果");
  });

  it.each(["activity", "memory"] as const)("rejects generation when %s changes during LLM execution", async (kind) => {
    const { repo, config } = await createTempRepo();
    const today = resolveDate(undefined, config);
    const brief = [
      `${today} ブリーフィング`,
      "1. 今日の予定",
      "- 予定なし",
      "2. 重要な未読メール",
      "- なし",
      "3. GitHub Issue確認",
      "- 0件",
    ].join("\n");
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1", status: "inProgress" }] }, "seed");
    await repo.saveOutput("morning", today, brief, "seed", "md");
    await repo.saveTaskMemory("task-1", { task_id: "task-1", summary: ["初期状態"] }, "seed");

    await expect(
      generateMorningTaskSections(repo, config, today, async () => {
        if (kind === "activity") {
          await repo.saveActivity(
            today,
            { date: today, entries: [{ task_id: "task-1", done: ["生成中の更新"] }] },
            "concurrent-update",
          );
        } else {
          await repo.saveTaskMemory(
            "task-1",
            { task_id: "task-1", summary: ["生成中に更新された長期記憶"] },
            "concurrent-update",
          );
        }
        return {
          text: JSON.stringify({
            attention: ["Task 1を確認する。"],
            task_table: [
              {
                priority: "1",
                task_id: "task-1",
                task_name: "Task 1",
                today_action: "確認する",
                today_goal: "方針を決める",
              },
            ],
            recommendation: "Task 1から開始する。",
          }),
        };
      }),
    ).rejects.toThrow("inputs changed while the LLM was generating");

    await expect(repo.loadOutput("morning", today, "md")).resolves.toBe(brief);
  });

  it("collects external inputs before generating the web morning summary", async () => {
    const { repo, config } = await createTempRepo();
    const order: string[] = [];
    const result = await generateWebMorningSummary(
      repo,
      config,
      resolveDate(undefined, config),
      async () => {
        order.push("collect");
        return { configured: true, executed: true, duration_ms: 10 };
      },
      async () => {
        order.push("generate");
        return {
          document: { date: "2026-07-15", title: "Morning brief", available: true, raw: "", sections: [] },
          generated: { attention: [], task_table: [], recommendation: "" },
          save: {},
          llm_provider: "test",
        };
      },
    );

    expect(order).toEqual(["collect", "generate"]);
    expect(result.external_input).toMatchObject({ executed: true });
  });

  it("does not generate a web morning summary when external collection fails", async () => {
    const { repo, config } = await createTempRepo();
    let generated = false;
    await expect(
      generateWebMorningSummary(
        repo,
        config,
        resolveDate(undefined, config),
        async () => {
          throw new Error("mail unavailable");
        },
        async () => {
          generated = true;
          throw new Error("must not run");
        },
      ),
    ).rejects.toThrow("mail unavailable");
    expect(generated).toBe(false);
  });

  it("does not generate a web morning summary when the collector is unavailable", async () => {
    const { repo, config } = await createTempRepo();
    let generated = false;
    await expect(
      generateWebMorningSummary(
        repo,
        config,
        resolveDate(undefined, config),
        async () => ({
          configured: false,
          executed: false,
          duration_ms: 0,
        }),
        async () => {
          generated = true;
          throw new Error("must not run");
        },
      ),
    ).rejects.toThrow("not configured or is disabled");
    expect(generated).toBe(false);
  });

  it("uses an LLM to assess task-table progress against today's action and goal", async () => {
    const { repo, config } = await createTempRepo();
    const today = resolveDate(undefined, config);
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task 1", status: "inProgress", tier: 1 }] }, "seed");
    await repo.saveActivity(
      today,
      { date: today, entries: [{ task_id: "task-1", done: ["選考結果を問い合わせた"] }] },
      "seed",
    );
    await repo.saveGlobalMemory(
      { preferences: ["残作業を明記する"], rules: ["根拠のない完了判定をしない"] },
      "seed-global-memory",
    );
    await repo.saveOutput(
      "morning",
      today,
      [
        `${today} モーニングブリーフ`,
        "5. 本日のワタシ用タスク表",
        "| 優先 | タスク名 | 今日やること | 今日のゴール |",
        "| --- | --- | --- | --- |",
        "| 1 | Task 1 <!--task-id:task-1--> | 選考結果を確認 | 次の行動を確定 |",
      ].join("\n"),
      "seed",
      "md",
    );

    const result = await checkMorningTaskProgress(repo, config, today, async (input) => {
      expect(input.prompt).toContain("選考結果を確認");
      expect(input.prompt).toContain("次の行動を確定");
      expect(input.prompt).toContain("選考結果を問い合わせた");
      expect(input.prompt).toContain("what has concretely been completed");
      expect(input.prompt).toContain('"preferences":["残作業を明記する"]');
      expect(input.prompt).toContain('"rules":["根拠のない完了判定をしない"]');
      expect(input.prompt).toContain("mandatory user-wide assessment constraints");
      return {
        text: JSON.stringify({
          items: [
            {
              task_id: "task-1",
              state: "aligned",
              assessment: "選考結果の問い合わせまで完了。回答確認と次の行動の確定が残っている。",
              evidence: ["選考結果を問い合わせた"],
            },
          ],
        }),
      };
    });

    expect(result.document.items[0]).toMatchObject({ task_id: "task-1", state: "aligned" });
    await expect(repo.loadOutput("morning-progress", today, "json")).resolves.toContain('"state": "aligned"');
    const overview = await buildOverview(repo, config, today);
    expect(overview.morning_task_progress["task-1"]).toMatchObject({
      alignment_state: "aligned",
      assessment: "選考結果の問い合わせまで完了。回答確認と次の行動の確定が残っている。",
    });
  });

  it("rejects an LLM progress assessment that omits a task-table row", async () => {
    const { repo, config } = await createTempRepo();
    const today = resolveDate(undefined, config);
    await repo.saveTasks(
      {
        tasks: [
          { id: "task-1", title: "Task 1", status: "inProgress" },
          { id: "task-2", title: "Task 2", status: "inProgress" },
        ],
      },
      "seed",
    );
    await repo.saveOutput(
      "morning",
      today,
      [
        `${today} モーニングブリーフ`,
        "5. 本日のワタシ用タスク表",
        "| 優先 | タスク名 | 今日やること | 今日のゴール |",
        "| --- | --- | --- | --- |",
        "| 1 | Task 1 <!--task-id:task-1--> | Action 1 | Goal 1 |",
        "| 2 | Task 2 <!--task-id:task-2--> | Action 2 | Goal 2 |",
      ].join("\n"),
      "seed",
      "md",
    );
    await expect(
      checkMorningTaskProgress(repo, config, today, async () => ({
        text: JSON.stringify({
          items: [{ task_id: "task-1", state: "in_progress", assessment: "進行中。", evidence: [] }],
        }),
      })),
    ).rejects.toThrow("did not assess every task-table row");
  });

  it("creates an HTTP server instance for read-only monitoring", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks(
      {
        tasks: [{ id: "task-1", title: "Task", status: "todo", context: "contexts/task-1.md" }],
      },
      "seed",
    );
    await repo.saveTaskContext(
      { id: "task-1", title: "Task", context: "contexts/task-1.md" },
      { data: { compact_summary: ["Context summary"] }, body: "Body" },
      "seed-context",
    );

    const server = createTaskMcpWebServer(repo, config);
    const overview = await buildOverview(repo, config, "2026-07-04");
    const task = overview.tasks[0];
    const context = task ? await repo.loadTaskContext(task) : undefined;

    expect(server.listening).toBe(false);
    expect(overview.tasks).toHaveLength(1);
    expect(context?.body).toBe("Body");
  });

  it("generates and loads text and markdown reports through the web API", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task", status: "inProgress", tier: 1 }] }, "seed");
    await repo.saveReport(
      "2026-07-15",
      {
        date: "2026-07-15",
        entries: [{ task_id: "task-1", done: ["Webレポートを実装"], next: ["表示を確認"] }],
      },
      "seed",
    );

    const textResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/report/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: "2026-07-15", format: "text" }),
    });
    expect(textResponse.status).toBe(200);
    await expect(textResponse.json()).resolves.toMatchObject({
      date: "2026-07-15",
      output: { text: expect.stringContaining("2026/07/15") },
    });

    const markdownResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/report/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: "2026-07-15", format: "markdown" }),
    });
    expect(markdownResponse.status).toBe(200);
    const markdown = (await markdownResponse.json()) as { output: { text: string; html: string } };
    expect(markdown.output.text).toContain("# 2026/07/15");
    expect(markdown.output.html).toContain("<h1>2026/07/15");

    const loadedResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/report?date=2026-07-15");
    expect(loadedResponse.status).toBe(200);
    await expect(loadedResponse.json()).resolves.toMatchObject({
      date: "2026-07-15",
      text: { text: expect.stringContaining("2026/07/15") },
      markdown: { text: expect.stringContaining("# 2026/07/15"), html: expect.stringContaining("<h1>2026/07/15") },
    });
  });

  it("serves a bounded Knowledge Graph and rendered note detail through the web API", async () => {
    const { repo, config } = await createTempRepo();
    await upsertKnowledgeNote(repo, {
      id: "cognito",
      title: "Amazon Cognito",
      type: "technology",
      tags: ["auth"],
      summary: "認証基盤",
      evidence: [{ statement: "Cognitoは認証基盤である", rationale: "利用者認証を提供する" }],
      body: "# Cognito\n\n認証を提供する。",
    });
    await upsertKnowledgeNote(repo, {
      id: "deltaco",
      title: "DeltaCo",
      type: "system",
      aliases: ["店舗情報サービス"],
      tags: ["service"],
      summary: "店舗情報システム",
      evidence: [{ statement: "DeltaCoはCognitoを利用する", rationale: "利用者認証に必要である" }],
      relations: [
        {
          type: "uses",
          target_id: "cognito",
          label: "認証基盤",
        },
      ],
      body: "# DeltaCo\n\nCognitoを利用する。",
    });

    const graphResponse = await liveRequest(
      createTaskMcpWebServer(repo, config),
      "/api/knowledge/graph?query=DeltaCo&depth=1&limit=25",
    );
    expect(graphResponse.status).toBe(200);
    await expect(graphResponse.json()).resolves.toMatchObject({
      nodes: [expect.objectContaining({ id: "cognito" }), expect.objectContaining({ id: "deltaco" })],
      edges: [
        expect.objectContaining({
          source: "deltaco",
          target: "cognito",
          type: "uses",
          label: "認証基盤",
        }),
      ],
      warnings: [],
      stats: { nodes: 2, edges: 1, orphans: 0 },
    });

    const noteResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/knowledge/note/deltaco?depth=1");
    expect(noteResponse.status).toBe(200);
    await expect(noteResponse.json()).resolves.toMatchObject({
      note: { id: "deltaco", body_html: expect.stringContaining("<h1>DeltaCo") },
      graph: { stats: { nodes: 2, edges: 1, orphans: 0 } },
    });

    await recordKnowledgeUsage(repo, config, {
      workflow: "report_generate_output",
      stage: "injected_to_llm",
      contexts: [{ task_id: "task-1", knowledge: await searchKnowledge(repo, { query: "DeltaCo" }) }],
    });
    const usageResponse = await liveRequest(
      createTaskMcpWebServer(repo, config),
      "/api/knowledge/usage?days=30&limit=10",
    );
    expect(usageResponse.status).toBe(200);
    await expect(usageResponse.json()).resolves.toMatchObject({
      event_count: 1,
      injected_event_count: 1,
      injected_note_count: 2,
      recent_events: [
        expect.objectContaining({ workflow: "report_generate_output", knowledge_ids: ["cognito", "deltaco"] }),
      ],
    });
  });

  it("serves local person profiles and interaction history through the web audit API", async () => {
    const { repo, config } = await createTempRepo();
    await upsertPersonProfile(repo, {
      id: "tanaka-taro",
      display_name: "田中 太郎",
      organizations: [{ name: "Example Inc.", role: "開発責任者" }],
      relationship_type: "client",
      facts: [
        {
          id: "preferred-channel",
          category: "communication",
          value: "Slack",
          basis: "confirmed",
          sensitivity: "private",
        },
      ],
    });
    await recordPersonInteraction(repo, "2026-08-12", {
      person_ids: ["tanaka-taro"],
      occurred_at: "2026-08-12T10:00:00.000Z",
      summary: "要件を確認した",
    });

    const listResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/people?query=Example");
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      count: 1,
      profiles: [{ id: "tanaka-taro", display_name: "田中 太郎" }],
    });

    const detailResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/people/tanaka-taro");
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      profile: { id: "tanaka-taro", facts: [{ basis: "confirmed", value: "Slack" }] },
      relationships: [],
      interactions: [{ summary: "要件を確認した" }],
    });
  });

  it("rejects unsupported web report formats", async () => {
    const { repo, config } = await createTempRepo();
    const response = await liveRequest(createTaskMcpWebServer(repo, config), "/api/report/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: "2026-07-15", format: "html" }),
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("format must be text or markdown");
  });

  it("updates persistent profile date settings through the web API", async () => {
    const { repo, config } = await createTempRepo();
    const updateResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/settings/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: "Asia/Tokyo", activity_rollover_hour: 4 }),
    });

    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({ timezone: "Asia/Tokyo", activity_rollover_hour: 4 });
    expect(config).toMatchObject({ timezone: "Asia/Tokyo", activityRolloverHour: 4 });

    const getResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/settings/profile");
    await expect(getResponse.json()).resolves.toMatchObject({ timezone: "Asia/Tokyo", activity_rollover_hour: 4 });

    const fullWidthResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/settings/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: "Asia/Tokyo", activity_rollover_hour: "２３" }),
    });
    expect(fullWidthResponse.status).toBe(200);
    await expect(fullWidthResponse.json()).resolves.toMatchObject({ activity_rollover_hour: 23 });

    const invalidResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/settings/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: "Asia/Tokyo", activity_rollover_hour: "２４" }),
    });
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.text()).resolves.toContain("0 to 23");
  });

  it("updates and runs backup retention through the web API", async () => {
    const { repo, config } = await createTempRepo();
    const updateResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/settings/maintenance", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        run_at: "04:15",
        keep_all_days: 5,
        keep_daily_days: 20,
        keep_weekly_days: 120,
        keep_monthly_days: 730,
        archive_grace_days: 60,
        max_versions_per_file_per_day: 2,
      }),
    });

    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({ run_at: "04:15", keep_all_days: 5 });
    expect(config.backupCleanup).toMatchObject({ runAt: "04:15", keepAllDays: 5 });

    const getResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/settings/maintenance");
    await expect(getResponse.json()).resolves.toMatchObject({ run_at: "04:15", keep_monthly_days: 730 });

    const runResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/settings/maintenance/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dry_run: true }),
    });
    expect(runResponse.status).toBe(200);
    await expect(runResponse.json()).resolves.toMatchObject({ dry_run: true, skipped: false });

    const invalidResponse = await liveRequest(createTaskMcpWebServer(repo, config), "/api/settings/maintenance", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        run_at: "24:00",
        keep_all_days: 5,
        keep_daily_days: 20,
        keep_weekly_days: 120,
        keep_monthly_days: 730,
        archive_grace_days: 60,
        max_versions_per_file_per_day: 2,
      }),
    });
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.text()).resolves.toContain("HH:MM");
  });

  it("exposes configured and selected LLM providers for the settings audit", async () => {
    const { repo, config } = await createTempRepo();
    vi.stubEnv("TASK_MCP_CODEX_DAILY_AUTOMATION_PATH", `${repo.root}/config/test-automation.toml`);
    config.connectedMcpClient = {
      name: "GitHub Copilot",
      version: "1.2.3",
      configured_provider: "auto",
      selected_provider: "copilot_cli",
      selected_model: "gpt-5.3-codex",
      selection_reason: "copilot_client",
    };

    const response = await liveRequest(createTaskMcpWebServer(repo, config), "/api/settings/automation-status");
    vi.unstubAllEnvs();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      llm_provider: {
        configured_provider: "auto",
        selected_provider: "copilot_cli",
        selected_model: "gpt-5.3-codex",
        selection_reason: "copilot_client",
        client_name: "GitHub Copilot",
        providers: [
          { id: "codex_app_server", selected: false },
          { id: "claude_cli", selected: false },
          { id: "copilot_cli", selected: true },
          { id: "cursor_cli", selected: false },
          { id: "gemini_cli", selected: false },
          { id: "lm_studio", selected: false },
        ],
      },
    });
    expect(payload.clients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runner: "copilot_cli", state: "not_configured" }),
        expect.objectContaining({ runner: "gemini_cli", state: "not_configured" }),
      ]),
    );
  });

  it("organizes Context and Task Memory together from all task evidence", async () => {
    const { repo, config } = await createTempRepo();
    const task = { id: "task-1", title: "Task", status: "inProgress" as const, context: "contexts/task-1.md" };
    await repo.saveTasks({ tasks: [task, { id: "task-2", title: "Other", status: "inProgress" }] }, "seed");
    await repo.saveTaskContext(
      task,
      {
        data: { owner: "user" },
        body: "# 古い概要\n\n再利用する背景\n\nhttps://example.com/spec）。\n\nhttps://meet.example.com/abc、連絡先: 担当者",
      },
      "seed-context",
    );
    await repo.saveTaskMemory("task-1", { task_id: "task-1", facts: ["2026-07-14の一時件数は42件"] }, "seed-memory");
    await repo.saveGlobalMemory(
      { preferences: ["簡潔に整理する"], rules: ["参照URLを保持する"] },
      "seed-global-memory",
    );
    await repo.saveActivity(
      "2026-07-14",
      {
        date: "2026-07-14",
        entries: [
          { task_id: "task-1", done: ["恒久方針を決定"] },
          { task_id: "task-2", done: ["他タスクの秘密情報"] },
        ],
      },
      "seed-activity",
    );
    await repo.saveInputs(
      "2026-07-14",
      {
        date: "2026-07-14",
        items: [
          { title: "恒久仕様", summary: ["認証方式を維持"], related_task_id: "task-1" },
          { title: "他タスクInput", summary: ["他タスクの入力情報"], related_task_id: "task-2" },
        ],
      },
      "seed-input",
    );
    const activityBefore = await repo.loadActivity("2026-07-14");
    const inputsBefore = await repo.loadInputs("2026-07-14");

    let prompt = "";
    await organizeWebTaskInformation(repo, config, "task-1", "2026-07-14", 7, async (input) => {
      prompt = input.prompt;
      return {
        text: JSON.stringify({
          context_markdown:
            "---\nowner: user\ncompact_summary:\n  - 整理済み概要\n---\n# 概要\n\n整理済みの説明。\n\nhttps://example.com/spec\n\nhttps://meet.example.com/abc",
          task_memory: {
            summary: ["再利用可能な方針"],
            facts: ["認証方式を維持"],
            decisions: ["以後も恒久方針を使う"],
            risks: [],
            next: [],
            mindmap: { root: "Task", paths: [["方針", "運用", "認証", "認証方式を維持"]] },
            sources: [],
          },
        }),
        threadId: "thread",
        turnId: "turn",
      };
    });

    expect(prompt).toContain("Context is the stable task definition");
    expect(prompt).toContain("Task Memory is reusable long-term knowledge");
    expect(prompt).toContain("恒久方針を決定");
    expect(prompt).toContain("認証方式を維持");
    expect(prompt).toContain('"preferences": [\n      "簡潔に整理する"');
    expect(prompt).toContain('"rules": [\n      "参照URLを保持する"');
    expect(prompt).toContain("Do not copy Global Memory into task Context or Task Memory");
    expect(prompt).not.toContain("他タスクの秘密情報");
    expect(prompt).not.toContain("他タスクの入力情報");
    await expect(repo.loadTaskContext(task)).resolves.toMatchObject({
      data: { owner: "user", compact_summary: ["整理済み概要"] },
    });
    await expect(repo.loadTaskMemory("task-1")).resolves.toMatchObject({ facts: ["認証方式を維持"] });
    await expect(repo.loadActivity("2026-07-14")).resolves.toEqual(activityBefore);
    await expect(repo.loadInputs("2026-07-14")).resolves.toEqual(inputsBefore);
  });

  it("keeps Context and Task Memory unchanged when unified generation fails", async () => {
    const { repo, config } = await createTempRepo();
    const task = { id: "task-1", title: "Task", status: "inProgress" as const, context: "contexts/task-1.md" };
    await repo.saveTasks({ tasks: [task] }, "seed");
    await repo.saveTaskContext(task, { data: {}, body: "保持する概要" }, "seed-context");
    await repo.saveTaskMemory("task-1", { task_id: "task-1", facts: ["保持する記憶"] }, "seed-memory");
    const contextBefore = await repo.loadTaskContext(task);
    const memoryBefore = await repo.loadTaskMemory("task-1");

    await expect(
      organizeWebTaskInformation(repo, config, "task-1", "2026-07-14", 7, async () => {
        throw new Error("LLM unavailable");
      }),
    ).rejects.toThrow("LLM unavailable");

    await expect(repo.loadTaskContext(task)).resolves.toEqual(contextBefore);
    await expect(repo.loadTaskMemory("task-1")).resolves.toEqual(memoryBefore);
  });

  it("requires explicit data-sharing consent for unified task organization", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task", status: "inProgress" }] }, "seed");
    const response = await liveRequest(createTaskMcpWebServer(repo, config), "/api/task/task-1/organize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allow_llm_data_sharing: false }),
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("allow_llm_data_sharing=true is required");
  });

  it("uses AI decisions to apply or reject unresolved Agent Updates", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task", status: "inProgress" }] }, "seed");
    const pending = await submitAgentUpdate(repo, "2026-07-15", {
      session_id: "session-1",
      source: "codex",
      summary: "固有の作業更新",
      task_id: "task-1",
      done: ["作業Aを完了"],
      confidence: "high",
    });
    const review = await submitAgentUpdate(repo, "2026-07-15", {
      session_id: "session-2",
      source: "codex",
      summary: "確認済みの更新",
      task_id: "task-1",
      done: ["作業Bを完了"],
      confidence: "low",
    });
    const rejected = await submitAgentUpdate(repo, "2026-07-15", {
      session_id: "session-3",
      source: "codex",
      summary: "重複した監視更新",
      task_id: "task-1",
      done: ["古い監視値"],
      confidence: "high",
    });
    let prompt = "";

    const result = (await resolveWebAgentUpdatesWithAi(repo, config, "2026-07-15", async (input) => {
      prompt = input.prompt;
      return {
        text: JSON.stringify({
          resolutions: [
            {
              date: "2026-07-15",
              update_id: pending.update.update_id,
              action: "apply",
              task_id: "task-1",
              reason: "固有の作業記録",
            },
            {
              date: "2026-07-15",
              update_id: review.update.update_id,
              action: "apply",
              task_id: "task-1",
              reason: "内容に矛盾なし",
            },
            {
              date: "2026-07-15",
              update_id: rejected.update.update_id,
              action: "reject",
              task_id: "task-1",
              reason: "新しい状態に包含済み",
            },
          ],
        }),
      };
    })) as { applied: number; rejected: number };

    expect(prompt).toContain("needs_review is not itself a reason to reject");
    expect(result).toMatchObject({ applied: 2, rejected: 1 });
    const activity = await repo.loadActivity("2026-07-15");
    expect(activity.entries.map((entry) => entry.agent_update_id)).toEqual(
      expect.arrayContaining([pending.update.update_id, review.update.update_id]),
    );
    const queue = await repo.loadAgentUpdates("2026-07-15");
    expect(queue.updates.find((update) => update.update_id === pending.update.update_id)?.status).toBe("applied");
    expect(queue.updates.find((update) => update.update_id === review.update.update_id)?.status).toBe("applied");
    expect(queue.updates.find((update) => update.update_id === rejected.update.update_id)).toMatchObject({
      status: "rejected",
      review_notes: ["AI resolution: 新しい状態に包含済み"],
    });
  });

  it("keeps Agent Updates unchanged when AI omits a resolution", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task", status: "inProgress" }] }, "seed");
    const first = await submitAgentUpdate(repo, "2026-07-15", {
      session_id: "one",
      source: "codex",
      summary: "更新1",
      task_id: "task-1",
      confidence: "high",
    });
    await submitAgentUpdate(repo, "2026-07-15", {
      session_id: "two",
      source: "codex",
      summary: "更新2",
      task_id: "task-1",
      confidence: "high",
    });
    const queueBefore = await repo.loadAgentUpdates("2026-07-15");

    await expect(
      resolveWebAgentUpdatesWithAi(repo, config, "2026-07-15", async () => ({
        text: JSON.stringify({
          resolutions: [
            {
              date: "2026-07-15",
              update_id: first.update.update_id,
              action: "apply",
              task_id: "task-1",
              reason: "適用可能",
            },
          ],
        }),
      })),
    ).rejects.toThrow("omitted 1 Agent Update");

    await expect(repo.loadAgentUpdates("2026-07-15")).resolves.toEqual(queueBefore);
    await expect(repo.loadActivity("2026-07-15")).resolves.toMatchObject({ entries: [] });
  });

  it("treats an already-resolved Agent Update queue as a successful no-op", async () => {
    const { repo, config } = await createTempRepo();
    let generated = false;

    const result = (await resolveWebAgentUpdatesWithAi(repo, config, "2026-07-15", async () => {
      generated = true;
      return { text: "{}" };
    })) as { no_op: boolean; resolved: number };

    expect(result).toMatchObject({ no_op: true, resolved: 0 });
    expect(generated).toBe(false);
  });

  it("resolves old Agent Updates outside the situation lookback window", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task", status: "inProgress" }] }, "seed");
    const old = await submitAgentUpdate(repo, "2026-07-04", {
      session_id: "old",
      source: "codex",
      summary: "古い未反映更新",
      task_id: "task-1",
      confidence: "high",
    });

    const result = (await resolveWebAgentUpdatesWithAi(repo, config, "2026-07-15", async () => ({
      text: JSON.stringify({
        resolutions: [
          {
            date: "2026-07-04",
            update_id: old.update.update_id,
            action: "apply",
            task_id: "task-1",
            reason: "固有の作業記録",
          },
        ],
      }),
    }))) as { applied: number; no_op?: boolean };

    expect(result).toMatchObject({ applied: 1 });
    expect(result.no_op).not.toBe(true);
    await expect(repo.loadActivity("2026-07-04")).resolves.toMatchObject({
      entries: [{ agent_update_id: old.update.update_id }],
    });
  });

  it("assigns an AI-inferred active task before applying an orphan Agent Update", async () => {
    const { repo, config } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task", status: "inProgress" }] }, "seed");
    const orphan = await submitAgentUpdate(repo, "2026-07-15", {
      session_id: "orphan",
      source: "codex",
      summary: "タスクIDが欠けた作業記録",
      done: ["作業を完了"],
      confidence: "low",
    });

    const result = (await resolveWebAgentUpdatesWithAi(repo, config, "2026-07-15", async () => ({
      text: JSON.stringify({
        resolutions: [
          {
            date: "2026-07-15",
            update_id: orphan.update.update_id,
            action: "apply",
            task_id: "task-1",
            reason: "内容からTaskに対応すると判断",
          },
        ],
      }),
    }))) as { applied: number; rejected: number };

    expect(result).toMatchObject({ applied: 1, rejected: 0 });
    await expect(repo.loadActivity("2026-07-15")).resolves.toMatchObject({
      entries: [{ task_id: "task-1", agent_update_id: orphan.update.update_id }],
    });
    const queue = await repo.loadAgentUpdates("2026-07-15");
    expect(queue.updates.find((update) => update.update_id === orphan.update.update_id)).toMatchObject({
      task_id: "task-1",
      status: "applied",
      review_notes: expect.arrayContaining([expect.stringContaining("AI resolution assigned task_id=task-1")]),
    });
  });

  it("rejects only the orphan update when AI cannot identify an active task", async () => {
    const { repo, config } = await createTempRepo();
    const orphan = await submitAgentUpdate(repo, "2026-07-15", {
      session_id: "orphan",
      source: "codex",
      summary: "対応タスク不明の記録",
      confidence: "low",
    });

    const result = (await resolveWebAgentUpdatesWithAi(repo, config, "2026-07-15", async () => ({
      text: JSON.stringify({
        resolutions: [
          {
            date: "2026-07-15",
            update_id: orphan.update.update_id,
            action: "apply",
            task_id: null,
            reason: "適用を試行",
          },
        ],
      }),
    }))) as { applied: number; rejected: number };

    expect(result).toMatchObject({ applied: 0, rejected: 1 });
    await expect(repo.loadActivity("2026-07-15")).resolves.toMatchObject({ entries: [] });
    const queue = await repo.loadAgentUpdates("2026-07-15");
    expect(queue.updates.find((update) => update.update_id === orphan.update.update_id)).toMatchObject({
      status: "rejected",
      review_notes: [expect.stringContaining("有効なtask_idを特定できないため却下")],
    });
  });

  it("requires explicit data-sharing consent for AI Agent Update resolution", async () => {
    const { repo, config } = await createTempRepo();
    const response = await liveRequest(createTaskMcpWebServer(repo, config), "/api/global/resolve-agent-updates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allow_llm_data_sharing: false }),
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("allow_llm_data_sharing=true is required");
  });

  it("rejects invalid unified output before changing either durable document", async () => {
    const { repo, config } = await createTempRepo();
    const task = { id: "task-1", title: "Task", status: "inProgress" as const, context: "contexts/task-1.md" };
    await repo.saveTasks({ tasks: [task] }, "seed");
    await repo.saveTaskContext(
      task,
      { data: { owner: "user" }, body: "仕様: https://example.com/spec\n" },
      "seed-context",
    );
    await repo.saveTaskMemory("task-1", { task_id: "task-1", facts: ["保持する記憶"] }, "seed-memory");
    const contextBefore = await repo.loadTaskContext(task);
    const memoryBefore = await repo.loadTaskMemory("task-1");

    const validMemory = {
      summary: [],
      facts: ["変更されない候補"],
      decisions: [],
      risks: [],
      next: [],
      mindmap: { root: "Task", paths: [] },
      sources: [],
    };
    await expect(
      organizeWebTaskInformation(repo, config, "task-1", "2026-07-14", 7, async () => ({
        text: JSON.stringify({
          context_markdown: "---\nowner: user\n---\n# 概要\n\nURLなし",
          task_memory: validMemory,
        }),
      })),
    ).rejects.toThrow("omitted 1 URL");
    await expect(
      organizeWebTaskInformation(repo, config, "task-1", "2026-07-14", 7, async () => ({
        text: JSON.stringify({ context_markdown: "# frontmatterなし", task_memory: validMemory }),
      })),
    ).rejects.toThrow("no valid YAML frontmatter block");

    await expect(repo.loadTaskContext(task)).resolves.toEqual(contextBefore);
    await expect(repo.loadTaskMemory("task-1")).resolves.toEqual(memoryBefore);
  });

  it("rolls back Context when Task Memory persistence fails", async () => {
    const { repo, config } = await createTempRepo();
    const task = { id: "task-1", title: "Task", status: "inProgress" as const, context: "contexts/task-1.md" };
    await repo.saveTasks({ tasks: [task] }, "seed");
    await repo.saveTaskContext(task, { data: { owner: "user" }, body: "元の概要" }, "seed-context");
    await repo.saveTaskMemory("task-1", { task_id: "task-1", facts: ["元の記憶"] }, "seed-memory");
    const contextBefore = await repo.loadTaskContext(task);
    const memoryBefore = await repo.loadTaskMemory("task-1");
    repo.saveTaskMemory = async () => {
      throw new Error("memory write failed");
    };

    await expect(
      organizeWebTaskInformation(repo, config, "task-1", "2026-07-14", 7, async () => ({
        text: JSON.stringify({
          context_markdown: "---\nowner: user\n---\n# 概要\n\n変更後",
          task_memory: {
            summary: [],
            facts: ["変更後の記憶"],
            decisions: [],
            risks: [],
            next: [],
            mindmap: { root: "Task", paths: [] },
            sources: [],
          },
        }),
      })),
    ).rejects.toThrow("memory write failed");

    await expect(repo.loadTaskContext(task)).resolves.toEqual(contextBefore);
    await expect(repo.loadTaskMemory("task-1")).resolves.toEqual(memoryBefore);
  });

  it("keeps loopback monitoring available without authentication", async () => {
    const { repo, config } = await createTempRepo();
    const response = await request(createTaskMcpWebServer(repo, config), "/api/overview");

    expect(response.status).toBe(200);
  });

  it("rejects remote hosts unless explicitly allowed with a token", () => {
    expect(() => parseWebServerOptions(["node", "webServer", "--host", "0.0.0.0"])).toThrow(/allow-remote/);
    expect(() => parseWebServerOptions(["node", "webServer", "--host", "0.0.0.0", "--allow-remote"])).toThrow(
      /Bearer token/,
    );
    expect(() => parseWebServerOptions(["node", "webServer", "--port", "0"])).toThrow(/Invalid port/);
    expect(() => parseWebServerOptions(["node", "webServer", "--host", "http://example.com"])).toThrow(/Invalid host/);
    expect(() => parseWebServerOptions(["node", "webServer", "--token", "short"])).toThrow(/Bearer-compatible/);
    expect(
      parseWebServerOptions(["node", "webServer"], {
        TASK_MCP_WEB_HOST: "0.0.0.0",
        TASK_MCP_WEB_ALLOW_REMOTE: "true",
        TASK_MCP_WEB_TOKEN: "test-token-with-enough-length",
      }),
    ).toMatchObject({ host: "0.0.0.0", allowRemote: true });
  });

  it("enables the monitor by default and supports an explicit opt-out", () => {
    expect(isWebServerEnabled({})).toBe(true);
    expect(isWebServerEnabled({ TASK_MCP_WEB_ENABLED: "false" })).toBe(false);
    expect(isWebServerEnabled({ TASK_MCP_WEB_ENABLED: "1" })).toBe(true);
    expect(() => isWebServerEnabled({ TASK_MCP_WEB_ENABLED: "sometimes" })).toThrow(/TASK_MCP_WEB_ENABLED/);
  });

  it("stops the HTTP listener and active connections idempotently", async () => {
    const fakeServer = Object.assign(new EventEmitter(), {
      listening: true,
      closeAllConnectionsCalled: 0,
      close(callback: (error?: Error) => void) {
        this.listening = false;
        callback();
        return this;
      },
      closeAllConnections() {
        this.closeAllConnectionsCalled += 1;
      },
    });

    await stopTaskMcpWebServer(fakeServer as unknown as ReturnType<typeof createTaskMcpWebServer>);
    await stopTaskMcpWebServer(fakeServer as unknown as ReturnType<typeof createTaskMcpWebServer>);

    expect(fakeServer.listening).toBe(false);
    expect(fakeServer.closeAllConnectionsCalled).toBe(1);
  });

  it("requires a Bearer token for protected HTML and API routes", async () => {
    const { repo, config } = await createTempRepo();
    const token = "test-token-with-enough-length";
    const protectedServer = () => createTaskMcpWebServer(repo, config, { token });

    const htmlFailure = await request(protectedServer(), "/");
    const apiFailure = await request(protectedServer(), `/api/overview?token=${token}`);
    const wrongTokenFailure = await request(protectedServer(), "/api/overview", "wrong-token-with-enough-length");
    const htmlSuccess = await request(protectedServer(), "/", token);
    const apiSuccess = await request(protectedServer(), "/api/overview", token);

    expect(htmlFailure.status).toBe(401);
    expect(htmlFailure.headers["www-authenticate"]).toContain("Bearer");
    expect(apiFailure.status).toBe(401);
    expect(wrongTokenFailure.status).toBe(401);
    expect(htmlSuccess.status).toBe(200);
    expect(apiSuccess.status).toBe(200);
  });

  it("organizes the Vue dashboard with Atomic Design layers", () => {
    const app = readFileSync(new URL("../src/web-ui/App.vue", import.meta.url), "utf8");
    const layout = readFileSync(new URL("../src/web-ui/components/templates/AuditLayout.vue", import.meta.url), "utf8");
    const sidebar = readFileSync(new URL("../src/web-ui/components/organisms/AppSidebar.vue", import.meta.url), "utf8");
    const taskMeta = readFileSync(new URL("../src/web-ui/components/molecules/TaskMeta.vue", import.meta.url), "utf8");
    const button = readFileSync(new URL("../src/web-ui/components/atoms/BaseButton.vue", import.meta.url), "utf8");
    const router = readFileSync(new URL("../src/web-ui/router/index.ts", import.meta.url), "utf8");

    expect(app.replace(/\s+/g, "")).toContain("<AuditLayout><RouterView/></AuditLayout>");
    expect(layout).toContain("AppSidebar");
    expect(sidebar).toContain("TaskMeta");
    expect(taskMeta).toContain("StatusDot");
    expect(button).toContain("button--primary");
    expect(router).toContain("/tasks/:taskId/:view(current|overview|context|memory)?");
    expect(router).toContain("createWebHistory()");
  });

  it("renders task context bodies as sanitized markdown", () => {
    const html = renderMarkdownBody("# Overview\n\n- item\n\n[link](https://example.com)\n\n<script>alert(1)</script>");

    expect(html).toContain("<h1>Overview</h1>");
    expect(html).toContain("<li>item</li>");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("<script>");
  });

  it("keeps Japanese sentence punctuation outside GFM bare URLs", () => {
    const html = renderMarkdownBody(
      "https://shop-data-finder-status.deltaco.chatgpt.site/flow、進捗は確認中。\n\nhttps://example.com/日本語/path?x=1。次です\n\n参照：https://example.com/spec（確認済み）",
    );

    expect(html).toContain('href="https://shop-data-finder-status.deltaco.chatgpt.site/flow"');
    expect(html).toContain("</a>、進捗は確認中。");
    expect(html).toContain('href="https://example.com/%E6%97%A5%E6%9C%AC%E8%AA%9E/path?x=1"');
    expect(html).toContain("</a>。次です");
    expect(html).toContain('href="https://example.com/spec"');
    expect(html).toContain("</a>（確認済み）");
    expect(html).not.toContain("%E3%80%81");
  });

  it("leaves explicit links and code spans to Marked's standard tokenizers", () => {
    const html = renderMarkdownBody("[既存リンク](https://example.com/a、b) と `https://example.com/a、b`");

    expect(html).toContain(">既存リンク</a>");
    expect(html).toContain("<code>https://example.com/a、b</code>");
  });

  it("uses the same default layout as the MCP server", () => {
    const config: TaskMcpConfig = {
      dataRoot: "/tmp/tasks",
      timezone: "UTC",
      defaultLookbackDays: 7,
      activityRolloverHour: 0,
      defaultRenderer: "markdown",
      reportLlmProvider: "auto",
      codexAppServerCommand: "codex",
      codexAppServerArgs: ["app-server", "--listen", "stdio://"],
      codexAppServerTimeoutMs: 120000,
      claudeCliCommand: "claude",
      claudeCliArgs: [],
      claudeCliModel: "claude-sonnet-4-6",
      claudeCliTimeoutMs: 120000,
      copilotCliCommand: "copilot",
      copilotCliArgs: [],
      copilotCliModel: "gpt-5.3-codex",
      copilotCliTimeoutMs: 120000,
      cursorCliCommand: "cursor-agent",
      cursorCliArgs: [],
      cursorCliModel: "gpt-5",
      cursorCliTimeoutMs: 120000,
      geminiCliCommand: "gemini",
      geminiCliArgs: [],
      geminiCliModel: "gemini-2.5-pro",
      geminiCliTimeoutMs: 120000,
      lmStudioBaseUrl: "http://127.0.0.1:1234/v1",
      lmStudioModel: "openai/gpt-oss-20b",
      lmStudioTimeoutMs: 120000,
      backupCleanup: { ...defaultBackupCleanup },
      layout: defaultLayout,
    };
    const repo = new Repository(config);

    expect(repo.layoutPath("taskMemory", "task-1.yaml")).toBe("/tmp/tasks/task_memory/task-1.yaml");
  });
});
