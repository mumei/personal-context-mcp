// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "#webUi/i18n/index";
import PeoplePage from "#webUi/pages/PeoplePage.vue";
import { router as applicationRouter } from "#webUi/router/index";
import type { PeopleListResponse, PersonDetailResponse } from "#webUi/types/api";

const profile = {
  id: "tanaka-taro",
  display_name: "田中 太郎",
  aliases: [],
  organizations: [{ name: "Example Inc.", role: "開発責任者" }],
  contacts: [{ type: "email", value: "tanaka@example.com", sensitivity: "sensitive" as const }],
  roles: [],
  relationship_type: "client",
  relationship_status: "active" as const,
  preferred_channels: ["Slack"],
  languages: ["ja"],
  timezone: "Asia/Tokyo",
  facts: [
    {
      id: "communication-style",
      category: "communication",
      value: "技術的な根拠を重視する可能性がある",
      basis: "inferred" as const,
      sensitivity: "private" as const,
      confidence: 0.6,
      updated_at: "2026-08-12T10:00:00.000Z",
    },
  ],
  notes: [],
  created_at: "2026-08-12T10:00:00.000Z",
  updated_at: "2026-08-12T10:00:00.000Z",
};

const selfProfile = {
  ...profile,
  id: "self",
  display_name: "利用者サンプル",
  aliases: ["本人"],
  organizations: [{ name: "DeltaCo", role: "役員" }],
  contacts: [],
  facts: [],
};

const list: PeopleListResponse = { count: 2, profiles: [profile, selfProfile] };
const detail: PersonDetailResponse = {
  profile,
  relationships: [
    {
      id: "self-to-tanaka",
      from_person_id: "self",
      to_person_id: "tanaka-taro",
      type: "client",
      label: "技術相談・改修対応",
      status: "active",
      notes: ["継続的な技術支援を行う"],
      created_at: "2026-08-12T10:00:00.000Z",
      updated_at: "2026-08-12T10:00:00.000Z",
    },
  ],
  interactions: [
    {
      interaction_id: "interaction-1",
      person_ids: ["tanaka-taro"],
      occurred_at: "2026-08-12T10:00:00.000Z",
      recorded_at: "2026-08-12T10:01:00.000Z",
      channel: "meeting",
      summary: "導入条件を確認した",
      outcomes: ["運用負荷を整理する"],
      follow_ups: ["次回資料を送る"],
      task_ids: [],
      sensitivity: "private",
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("People Web UI", () => {
  it("registers the People audit route", () => {
    expect(applicationRouter.resolve("/people/tanaka-taro").name).toBe("people");
  });

  it("keeps People navigation visible while reserving the sidebar remainder for tasks", () => {
    const sidebar = readFileSync(resolve("src/web-ui/components/organisms/AppSidebar.vue"), "utf8");

    expect(sidebar).toContain('to="/people"');
    expect(sidebar).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(sidebar).toContain("grid-template-rows: auto auto auto minmax(0, 1fr)");
    expect(sidebar).toContain("scrollbar-gutter: stable");
  });

  it("shows provenance, relationships, and interaction history without edit controls", async () => {
    i18n.global.locale.value = "ja";
    const fetchMock = vi.fn().mockImplementation(async (input: string) => ({
      ok: true,
      json: async () => (input.startsWith("/api/people/tanaka-taro") ? detail : list),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/people/:personId?", name: "people", component: PeoplePage }],
    });
    await router.push("/people/tanaka-taro");
    await router.isReady();
    const wrapper = mount(PeoplePage, {
      global: {
        plugins: [i18n, router],
        stubs: { PersonRelationshipGraph: { template: '<div class="relationship-graph-stub" />' } },
      },
    });

    await vi.waitFor(() => expect(wrapper.text()).toContain("導入条件を確認した"));
    expect(wrapper.text()).toContain("人物情報はローカル専用です");
    expect(wrapper.text()).toContain("推測");
    expect(wrapper.text()).toContain("確度: 60%");
    expect(wrapper.text()).toContain("次回資料を送る");
    expect(wrapper.text()).toContain("利用者サンプル");
    expect(wrapper.text()).toContain("技術支援元");
    expect(wrapper.text()).toContain("継続的な技術支援を行う");
    expect(wrapper.text()).not.toContain("self → tanaka-taro");
    expect(wrapper.find(".relationship-graph-stub").exists()).toBe(true);
    expect(wrapper.find(".profile-section").exists()).toBe(true);
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
    expect(wrapper.find('button[data-action="edit"]').exists()).toBe(false);
  });
});
