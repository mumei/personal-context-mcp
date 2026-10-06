// @vitest-environment jsdom
import { mount, flushPromises, RouterLinkStub } from "@vue/test-utils";
import { ref, type Ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TicketsPage from "#webUi/pages/TicketsPage.vue";
import { i18n } from "#webUi/i18n/index";

const model = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("#webUi/composables/useTickets", () => ({ useTickets: () => model.current }));
vi.mock("#webUi/services/api", () => ({
  getJson: vi.fn(async () => ({
    history: [{ date: "2026-09-14", done: ["Scoped history"], next: [], notes: [], sources: [] }],
    truncated: false,
  })),
}));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => vi.clearAllMocks());
describe("ticket board", () => {
  it("groups parent colors and renders every state column in newest-update order", async () => {
    i18n.global.locale.value = "ja";
    const makeTicket = (ticketId: string, taskId: string, status: "todo" | "inProgress", updatedAt: string) => ({
      ticket_id: ticketId,
      task_id: taskId,
      title: ticketId,
      description: "",
      parent_title: taskId,
      project: "App",
      status,
      priority: 1,
      order: 0,
      acceptance: [],
      depends_on: [],
      evidence: [],
      updated_at: updatedAt,
      revision: 1,
    });
    model.current = {
      tickets: ref([
        makeTicket("older-a", "parent-a", "todo", "2026-09-18T00:00:00Z"),
        makeTicket("newer-a", "parent-a", "todo", "2026-09-20T00:00:00Z"),
        makeTicket("middle-b", "parent-b", "todo", "2026-09-19T00:00:00Z"),
        makeTicket("progress-old", "parent-b", "inProgress", "2026-09-18T00:00:00Z"),
        makeTicket("progress-new", "parent-a", "inProgress", "2026-09-20T00:00:00Z"),
      ]),
      error: ref(""),
      connected: ref(true),
      busy: ref(false),
      update: vi.fn(),
    };

    const wrapper = mount(TicketsPage, {
      global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub, Teleport: true } },
    });
    const columns = wrapper.findAll(".ticket-column");
    expect(wrapper.text()).toContain("更新が新しい順");
    expect(columns[0].findAll(".ticket-title").map((item) => item.text())).toEqual(["newer-a", "middle-b", "older-a"]);
    expect(columns[1].findAll(".ticket-title").map((item) => item.text())).toEqual(["progress-new", "progress-old"]);

    const cards = wrapper.findAll(".ticket-card");
    const parentA = cards.filter((card) => card.text().includes("parent-a"));
    const parentB = cards.filter((card) => card.text().includes("parent-b"));
    expect(new Set(parentA.map((card) => card.attributes("data-parent-color"))).size).toBe(1);
    expect(new Set(parentB.map((card) => card.attributes("data-parent-color"))).size).toBe(1);
    expect(parentA[0].attributes("data-parent-color")).not.toBe(parentB[0].attributes("data-parent-color"));
  });

  it("uses readable categories, filtering and explicit revision-aware actions without optimistic moves", async () => {
    i18n.global.locale.value = "ja";
    const update = vi.fn();
    model.current = {
      tickets: ref([
        {
          ticket_id: "internal-secret-id",
          task_id: "parent",
          title: "Verify audio",
          description: "Detailed instructions",
          parent_title: "Delivery",
          project: "App",
          status: "todo",
          priority: 2,
          order: 0,
          assignee: { name: "Audio research" },
          acceptance: [{ text: "Tests passed", done: false }],
          depends_on: [],
          evidence: [],
          updated_at: "2026-09-13T00:00:00Z",
          revision: 1,
        },
      ]),
      error: ref(""),
      connected: ref(true),
      busy: ref(false),
      update,
    };
    const wrapper = mount(TicketsPage, {
      attachTo: document.body,
      global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub, Teleport: true } },
    });
    expect(wrapper.text()).toContain("Delivery");
    expect(wrapper.text()).toContain("Audio research");
    expect(wrapper.text()).not.toContain("internal-secret-id");
    expect(wrapper.findComponent(RouterLinkStub).props("to")).toBe("/tasks/parent/current");
    expect(wrapper.find(".ticket-card select").exists()).toBe(false);
    const title = wrapper.find<HTMLButtonElement>(".ticket-title");
    title.element.focus();
    await title.trigger("click");
    await flushPromises();
    expect(wrapper.find("dialog").attributes()).toHaveProperty("open");
    expect(wrapper.find("dialog").text()).toContain("Detailed instructions");
    expect(wrapper.find("dialog").text()).toContain("Scoped history");
    await wrapper
      .findAll("dialog button")
      .find((button) => button.text() === "状態を修正")!
      .trigger("click");
    await wrapper.find("form select").setValue("inProgress");
    expect(update).not.toHaveBeenCalled();
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }), { status: "inProgress" });
    const board = model.current as { tickets: Ref<Array<Record<string, unknown>>> };
    board.tickets.value = board.tickets.value.map((ticket) => ({
      ...ticket,
      status: "done",
      description: "Updated via SSE",
      acceptance: [{ text: "Tests passed", done: true }],
    }));
    await flushPromises();
    expect(wrapper.find("dialog").text()).toContain("Updated via SSE");
    expect(wrapper.findAll("dialog button").some((button) => button.text() === "状態を修正")).toBe(false);
    await wrapper.find("dialog").trigger("cancel");
    await flushPromises();
    expect(wrapper.find("dialog").attributes()).not.toHaveProperty("open");
    expect(document.activeElement).toBe(wrapper.find(".ticket-filters input").element);
    await wrapper.find(".ticket-filters input").setValue("absent");
    expect(wrapper.findAll(".ticket-card")).toHaveLength(0);
    wrapper.unmount();
  });
  it("hides discarded work by default and supports reason-aware restoration", async () => {
    i18n.global.locale.value = "ja";
    const update = vi.fn();
    model.current = {
      tickets: ref([
        {
          ticket_id: "obsolete-id",
          task_id: "parent",
          title: "Old implementation",
          description: "Superseded details",
          parent_title: "Delivery",
          project: "App",
          status: "discarded",
          discard_reason: "新しいチケットへ統合したため",
          priority: 3,
          order: 0,
          acceptance: [{ text: "Old condition", done: false }],
          depends_on: [],
          evidence: [],
          updated_at: "2026-09-14T00:00:00Z",
          revision: 4,
        },
      ]),
      error: ref(""),
      connected: ref(true),
      busy: ref(false),
      update,
    };
    const wrapper = mount(TicketsPage, {
      attachTo: document.body,
      global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub, Teleport: true } },
    });
    expect(wrapper.text()).toContain("返信・依存作業・指定日を待ち、条件が整えば再開");
    expect(wrapper.text()).toContain("重複・要件変更・不要化により実施しない作業");
    expect(wrapper.findAll(".ticket-card")).toHaveLength(0);
    await wrapper.find<HTMLSelectElement>('select[aria-label="状態"]').setValue("discarded");
    expect(wrapper.findAll(".ticket-column")).toHaveLength(1);
    expect(wrapper.find(".ticket-column h3").text()).toContain("廃棄");
    expect(wrapper.text()).toContain("Old implementation");
    expect(wrapper.text()).toContain("新しいチケットへ統合したため");
    await wrapper.find(".ticket-title").trigger("click");
    await flushPromises();
    await wrapper
      .findAll("dialog button")
      .find((button) => button.text() === "状態を修正")!
      .trigger("click");
    await wrapper.find("form select").setValue("todo");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }), { status: "todo" });
    wrapper.unmount();
  });
});
