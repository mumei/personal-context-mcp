// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import KnowledgeInspector from "#webUi/components/organisms/KnowledgeInspector.vue";
import KnowledgeRecentTable from "#webUi/components/organisms/KnowledgeRecentTable.vue";
import KnowledgePage from "#webUi/pages/KnowledgePage.vue";
import { i18n } from "#webUi/i18n/index";
import { router as applicationRouter } from "#webUi/router/index";
import type { KnowledgeGraphResponse, KnowledgeUsageSummary } from "#webUi/types/api";

const graph: KnowledgeGraphResponse = {
  nodes: [
    {
      id: "keycloak",
      title: "Keycloak",
      type: "technology",
      summary: "DeltaCoの認証基盤",
      tags: ["authentication"],
      body_html: "<p>OIDCを提供します。</p>",
      evidence: [
        {
          statement: "KeycloakはOIDCを提供する",
          rationale: "認証プロトコルとしてOIDCを実装している",
          applicability: "OIDC認証を利用するシステム",
        },
      ],
      updated_at: "2026-07-23T10:00:00+09:00",
      created_at: "2026-07-23T09:00:00+09:00",
    },
    {
      id: "deltaco",
      title: "DeltaCo",
      type: "system",
      summary: "認証を利用するサービス",
      created_at: "2026-07-24T09:00:00+09:00",
    },
    { id: "orphan", title: "孤立した判断", type: "decision" },
  ],
  edges: [{ id: "keycloak-used-by-deltaco", source: "keycloak", target: "deltaco", type: "used_by" }],
  warnings: [{ code: "missing-source", message: "根拠を確認してください", node_id: "keycloak" }],
  stats: { nodes: 3, edges: 1, orphans: 1 },
};

const usage: KnowledgeUsageSummary = {
  stored_note_count: 3,
  accumulation_event_count: 2,
  accumulated_note_write_count: 4,
  last_accumulated_at: "2026-07-23T09:30:00+09:00",
  event_count: 2,
  matched_event_count: 2,
  injected_event_count: 1,
  injected_note_count: 2,
  last_injected_at: "2026-07-23T10:00:00+09:00",
  workflows: {},
  recent_events: [
    {
      timestamp: "2026-07-23T10:00:00+09:00",
      workflow: "report_generate_output",
      stage: "injected_to_llm",
      task_ids: ["task-1"],
      matched_count: 2,
      injected_count: 2,
      knowledge_ids: ["deltaco", "keycloak"],
      knowledge_by_task: [{ task_id: "task-1", knowledge_ids: ["deltaco", "keycloak"] }],
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("Knowledge Graph Web UI", () => {
  it("registers the dedicated Knowledge route", () => {
    expect(applicationRouter.resolve("/knowledge").name).toBe("knowledge");
  });

  it("renders scan-friendly details and navigates through related knowledge", async () => {
    i18n.global.locale.value = "ja";
    const wrapper = mount(KnowledgeInspector, {
      global: { plugins: [i18n] },
      props: { note: graph.nodes[0], graph },
    });

    expect(wrapper.get("h2").text()).toBe("Keycloak");
    expect(wrapper.text()).toContain("DeltaCoの認証基盤");
    expect(wrapper.text()).toContain("used_by");
    expect(wrapper.text()).toContain("DeltaCo");
    expect(wrapper.text()).toContain("KeycloakはOIDCを提供する");
    expect(wrapper.text()).toContain("認証プロトコルとしてOIDCを実装している");
    expect(wrapper.text()).toContain("OIDC認証を利用するシステム");
    expect(wrapper.text()).toContain("根拠を確認してください");
    expect(wrapper.get(".markdown-body").html()).toContain("OIDCを提供します。");
    expect(wrapper.get('[role="status"]').text()).toContain("Keycloak");
    expect(wrapper.get(".inspector-disclosure:not([open]) summary").text()).toBe("根拠");

    await wrapper.get(".relation-button").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["deltaco"]]);
  });

  it("shows newly created knowledge first and exposes accessible row actions", async () => {
    i18n.global.locale.value = "ja";
    const wrapper = mount(KnowledgeRecentTable, {
      global: { plugins: [i18n] },
      props: { graph },
    });

    expect(wrapper.get("caption").text()).toContain("追加日時の新しい順");
    expect(wrapper.findAll("th").every((header) => header.attributes("scope") === "col")).toBe(true);
    expect(wrapper.findAll("tbody tr").map((row) => row.get(".knowledge-table-title").text())).toEqual([
      "DeltaCo",
      "Keycloak",
      "孤立した判断",
    ]);
    expect(wrapper.get("time").attributes("datetime")).toBe("2026-07-24T09:00:00+09:00");

    await wrapper.get(".knowledge-table-title").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["deltaco"]]);
  });

  it("loads the graph and preserves audit filters in the route", async () => {
    i18n.global.locale.value = "ja";
    const fetchMock = vi.fn().mockImplementation(async (input: string) => ({
      ok: true,
      json: async () => (input.includes("/api/knowledge/usage") ? usage : graph),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/knowledge", name: "knowledge", component: KnowledgePage }],
    });
    await router.push("/knowledge");
    await router.isReady();
    const wrapper = mount(KnowledgePage, {
      global: {
        plugins: [i18n, router],
        stubs: {
          KnowledgeGraphCanvas: {
            props: ["graph", "selectedId"],
            template: "<button class=\"graph-stub\" @click=\"$emit('select', 'keycloak')\">graph</button>",
          },
        },
      },
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(wrapper.text()).toContain("孤立ノードのみ");
    await vi.waitFor(() => expect(wrapper.text()).toContain("KnowledgeはLLM入力に含まれています"));
    expect(wrapper.get(".usage-disclosure").attributes("open")).toBeUndefined();
    expect(wrapper.text()).toContain("LLM注入回数");
    expect(wrapper.text()).toContain("現在のノート");
    expect(wrapper.text()).toContain("保存操作");
    await vi.waitFor(() => expect(wrapper.text()).toContain("3"));
    expect(wrapper.get(".result-count").text()).toBe("3件を表示中");
    expect(wrapper.get('.view-mode-button[aria-pressed="true"]').text()).toContain("グラフ");
    await wrapper.findAll(".view-mode-button")[1].trigger("click");
    expect(wrapper.find(".graph-stub").exists()).toBe(false);
    expect(wrapper.get(".knowledge-table-panel").text()).toContain("新着ナレッジ");
    await wrapper.findAll(".view-mode-button")[0].trigger("click");
    expect(wrapper.find(".graph-stub").exists()).toBe(true);
    expect(wrapper.get("form button.button--primary").attributes("disabled")).toBeDefined();
    await wrapper.get('input[type="search"]').setValue("OIDC");
    expect(wrapper.text()).toContain("変更した条件はまだ適用されていません");
    expect(wrapper.get("form button.button--primary").attributes("disabled")).toBeUndefined();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get("form").trigger("submit");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(router.currentRoute.value.query).toEqual({ query: "OIDC", orphans: "1" });
    expect(fetchMock.mock.calls[2]?.[0]).toContain("query=OIDC");
    expect(wrapper.get(".applied-filters").text()).toContain("検索: OIDC");
    expect(wrapper.get(".applied-filters").text()).toContain("孤立ノードのみ");
    await wrapper.findAll(".view-mode-button")[1].trigger("click");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.get(".knowledge-table-title").text()).toBe("孤立した判断");
  });
});
