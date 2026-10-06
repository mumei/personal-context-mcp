// @vitest-environment jsdom
import { mount, RouterLinkStub } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import BaseButton from "#webUi/components/atoms/BaseButton.vue";
import ToggleSwitch from "#webUi/components/atoms/ToggleSwitch.vue";
import MorningBrief from "#webUi/components/organisms/MorningBrief.vue";
import TaskCurrentStatus from "#webUi/components/organisms/TaskCurrentStatus.vue";
import TaskMeta from "#webUi/components/molecules/TaskMeta.vue";
import HelpPage from "#webUi/pages/HelpPage.vue";
import { i18n } from "#webUi/i18n/index";

describe("Web UI atomic components", () => {
  it("adapts task status cards to the available content width", () => {
    const source = readFileSync(resolve("src/web-ui/components/organisms/TaskCurrentStatus.vue"), "utf8");

    expect(source).toContain("container-type: inline-size");
    expect(source).toContain("@container (max-width: 760px)");
    expect(source).toContain("grid-template-columns: 1fr");
    expect(source).toContain("grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr)");
    expect(source).toContain("align-items: start");
  });

  it("uses localized labels for the current task summary and issues", () => {
    i18n.global.locale.value = "ja";
    const wrapper = mount(TaskCurrentStatus, {
      global: { plugins: [i18n] },
      props: {
        detail: {
          task: { id: "task-1", title: "Task 1", status: "inProgress", compact_summary: ["要約本文"] },
          context: {},
          memory: { risks: ["確認待ち"], next: ["担当者へ連絡"] },
        },
      },
    });

    expect(wrapper.findAll("dt").map((item) => item.text())).toEqual(["概要", "リスク", "次の行動"]);
    expect(wrapper.text()).not.toContain("summary");
  });

  it("uses context and newest Activity values when task memory is absent", () => {
    i18n.global.locale.value = "ja";
    const wrapper = mount(TaskCurrentStatus, {
      global: { plugins: [i18n] },
      props: {
        detail: {
          task: { id: "task-1", title: "Task 1", status: "inProgress", compact_summary: [] },
          context: { data: { compact_summary: ["  Context\nsummary  ", "Context summary"] } },
          latest_activity: { task_id: "task-1", compact_summary: ["Activity summary"], next: ["  Follow up  "] },
          latest_next_activity: { task_id: "task-1", next: ["  Follow up  ", "Follow up"] },
        },
      },
    });

    expect(wrapper.text()).toContain("Context summary");
    expect(wrapper.text()).toContain("Follow up");
  });

  it("keeps an explicit latest empty next list from reviving stale memory next", () => {
    i18n.global.locale.value = "ja";
    const wrapper = mount(TaskCurrentStatus, {
      global: { plugins: [i18n] },
      props: {
        detail: {
          task: { id: "task-1", title: "Task 1", status: "inProgress", compact_summary: ["Summary"] },
          context: {},
          memory: { next: ["Stale action"], updated_at: "2026-07-01T00:00:00Z" },
          latest_next_activity: { task_id: "task-1", occurred_at: "2026-07-02T00:00:00Z", next: [] },
        },
      },
    });

    expect(wrapper.text()).not.toContain("Stale action");
    expect(wrapper.text()).toContain("現在の論点はありません");
  });

  it("explains the Personal Context MCP data model and standard workflow", () => {
    i18n.global.locale.value = "ja";
    const wrapper = mount(HelpPage, { global: { plugins: [i18n] } });

    expect(wrapper.get("h2").text()).toBe("Personal Context MCPの使い方");
    expect(wrapper.get(".data-flow").text()).toContain("Activity");
    expect(wrapper.get(".data-flow").text()).toContain("Task Memory");
    expect(wrapper.findAll(".workflow li")).toHaveLength(5);
    expect(wrapper.text()).toContain("session_finish_task");
    expect(wrapper.text()).toContain("記録・記憶・出力を分ける");
  });

  it("renders an atom button with its semantic state", () => {
    const wrapper = mount(BaseButton, {
      props: { variant: "primary", disabled: true },
      slots: { default: "生成" },
    });

    expect(wrapper.get("button").text()).toBe("生成");
    expect(wrapper.get("button").classes()).toContain("button--primary");
    expect(wrapper.get("button").attributes()).toHaveProperty("disabled");
  });

  it("emits report visibility changes from the toggle atom", async () => {
    const wrapper = mount(ToggleSwitch, {
      props: { modelValue: true, label: "レポートに表示" },
    });

    expect(wrapper.get('input[role="switch"]').element).toMatchObject({ checked: true });
    await wrapper.get('input[role="switch"]').setValue(false);
    expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);
  });

  it("composes task metadata from atom components", () => {
    i18n.global.locale.value = "ja";
    const wrapper = mount(TaskMeta, {
      global: { plugins: [i18n] },
      props: {
        task: {
          id: "task-1",
          title: "Task 1",
          project: "Example",
          status: "inProgress",
          tier: 1,
          report_exclude: true,
        },
        showId: true,
      },
    });

    expect(wrapper.text()).toContain("Example");
    expect(wrapper.text()).toContain("進行中");
    expect(wrapper.text()).toContain("Tier 1");
    expect(wrapper.text()).toContain("レポート対象外");
    expect(wrapper.text()).toContain("task-1");
  });

  it("switches component labels through vue-i18n", () => {
    i18n.global.locale.value = "en";
    const wrapper = mount(TaskMeta, {
      global: { plugins: [i18n] },
      props: { task: { id: "task-1", title: "Task 1", status: "inProgress" } },
    });

    expect(wrapper.text()).toContain("In progress");
    i18n.global.locale.value = "ja";
  });

  it("shows the GitHub issue review as a collapsed one-line accordion", async () => {
    i18n.global.locale.value = "ja";
    const wrapper = mount(MorningBrief, {
      global: { plugins: [i18n] },
      props: {
        sections: [
          {
            number: 3,
            title: "GitHub Issue確認",
            available: true,
            preview: "27リポジトリを確認。",
            items: ["27リポジトリを確認。", "優先確認: rhoco #8514、#7970。"],
            paragraphs: [],
          },
        ],
      },
    });

    const accordion = wrapper.get("details.brief-accordion");
    expect(accordion.attributes("open")).toBeUndefined();
    expect(accordion.get("summary").text()).toContain("GitHub Issue確認");
    expect(accordion.get(".accordion-preview").text()).toBe("27リポジトリを確認。");
    expect(accordion.findAll(".accordion-content li").map((item) => item.text())).toEqual([
      "27リポジトリを確認。",
      "優先確認: rhoco #8514、#7970。",
    ]);

    await accordion.get("summary").trigger("click");
    expect(accordion.attributes()).toHaveProperty("open");
  });

  it("keeps section order and maps task progress by task ID", async () => {
    i18n.global.locale.value = "ja";
    const wrapper = mount(MorningBrief, {
      global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub } },
      props: {
        sections: [
          { number: 1, title: "今日の予定", available: true, items: ["予定なし"], paragraphs: [] },
          { number: 3, title: "GitHub Issue確認", available: true, items: ["1件"], paragraphs: [] },
          {
            number: 5,
            title: "本日のワタシ用タスク表",
            available: true,
            items: [],
            paragraphs: [],
            table: {
              headers: ["優先", "タスク名", "今日やること", "今日のゴール"],
              rows: [["1", "Task B <!--task-id:task-b-->", "確認", "完了"]],
            },
          },
        ],
        progress: {
          "task-a": { alignment_state: "blocked" },
          "task-b": {
            alignment_state: "aligned",
            assessment: "問い合わせまで完了し、回答確認が残っている。",
          },
        },
        date: "2026-07-18",
        canCheckProgress: true,
      },
    });

    expect(wrapper.findAll(".brief").map((section) => section.text().trim().charAt(0))).toEqual(["1", "3", "5"]);
    expect(wrapper.get(".progress").text()).toBe("計画どおり");
    expect(wrapper.get(".progress-comment").text()).toBe("問い合わせまで完了し、回答確認が残っている。");
    expect(wrapper.getComponent(RouterLinkStub).props("to")).toBe("/tasks/task-b/current?date=2026-07-18");
    expect(wrapper.get(".brief-heading button").text()).toContain("進捗のみ確認");
    await wrapper.get(".brief-heading button").trigger("click");
    expect(wrapper.emitted("checkProgress")).toHaveLength(1);
  });

  it("renders explicit empty states for empty actionable sections", () => {
    i18n.global.locale.value = "ja";
    const wrapper = mount(MorningBrief, {
      global: { plugins: [i18n] },
      props: {
        sections: [
          { number: 4, title: "今日注意が必要なタスク", available: true, items: [], paragraphs: [] },
          {
            number: 5,
            title: "本日のワタシ用タスク表",
            available: true,
            items: [],
            paragraphs: [],
            table: { headers: ["優先", "タスク名", "今日やること", "今日のゴール"], rows: [] },
          },
        ],
      },
    });

    expect(wrapper.text()).toContain("今日注意が必要なタスクはありません");
    expect(wrapper.text()).toContain("本日のタスクはありません");
  });
});
