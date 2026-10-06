// @vitest-environment jsdom
import { mount, RouterLinkStub } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppHeader from "#webUi/components/organisms/AppHeader.vue";
import AppSidebar from "#webUi/components/organisms/AppSidebar.vue";
import AuditLayout from "#webUi/components/templates/AuditLayout.vue";
import { i18n } from "#webUi/i18n/index";
import { useDashboard } from "#webUi/composables/useDashboard";

function mobileMediaQuery(matches = true): MediaQueryList {
  return {
    matches,
    media: "(max-width: 900px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

function router() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/summary", name: "summary", component: { template: "<div />" } }],
  });
}

afterEach(() => {
  const { state } = useDashboard();
  state.sidebarOpen = false;
  state.sidebarTrigger = null;
  state.loading = false;
  state.error = "";
  vi.unstubAllGlobals();
});

describe("Web UI accessibility", () => {
  it("announces the mobile drawer state and returns focus after Escape", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mobileMediaQuery()),
    );
    const appRouter = router();
    await appRouter.push("/summary");
    await appRouter.isReady();
    const header = mount(AppHeader, { attachTo: document.body, global: { plugins: [i18n, appRouter] } });
    const sidebar = mount(AppSidebar, {
      attachTo: document.body,
      global: { plugins: [i18n, appRouter], stubs: { RouterLink: RouterLinkStub } },
    });

    const trigger = header.get("#app-menu-trigger");
    expect(trigger.attributes("aria-controls")).toBe("app-mobile-sidebar");
    expect(trigger.attributes("aria-expanded")).toBe("false");
    await vi.waitFor(() => expect(sidebar.get("#app-mobile-sidebar").attributes("aria-hidden")).toBe("true"));
    expect(sidebar.get("#app-mobile-sidebar").attributes()).toHaveProperty("inert");
    await trigger.trigger("click");
    await vi.waitFor(() => expect(sidebar.get("#app-mobile-sidebar").attributes("role")).toBe("dialog"));
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(sidebar.get("#app-mobile-sidebar").attributes("aria-modal")).toBe("true");
    expect(sidebar.get("#app-mobile-sidebar").attributes("aria-hidden")).toBeUndefined();
    expect(sidebar.get("#app-mobile-sidebar").attributes()).not.toHaveProperty("inert");
    await vi.waitFor(() => expect(document.activeElement).toBe(sidebar.get(".mobile-close").element));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(sidebar.findAll(".filters button").at(-1)?.element);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(sidebar.get(".mobile-close").element);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(trigger.attributes("aria-expanded")).toBe("false"));
    expect(document.activeElement).toBe(trigger.element);

    await trigger.trigger("click");
    await vi.waitFor(() => expect(trigger.attributes("aria-expanded")).toBe("true"));
    await appRouter.push({ path: "/summary", query: { date: "2026-08-24" } });
    await vi.waitFor(() => expect(trigger.attributes("aria-expanded")).toBe("false"));

    sidebar.unmount();
    header.unmount();
  });

  it("labels the sidebar search and exposes selected task status filters", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mobileMediaQuery(false)),
    );
    const wrapper = mount(AppSidebar, {
      global: { plugins: [i18n, router()], stubs: { RouterLink: RouterLinkStub } },
    });

    expect(wrapper.get('label[for="task-filter"]').text()).toBe("タスクを絞り込み");
    expect(wrapper.get("#task-filter").attributes("type")).toBe("search");
    expect(wrapper.get(".filters").attributes("role")).toBe("group");
    expect(wrapper.get(".filters button").attributes("aria-pressed")).toBe("true");
  });

  it("exposes shared loading and error state to assistive technology", () => {
    const { state } = useDashboard();
    state.loading = true;
    state.error = "読み込みに失敗しました";
    const wrapper = mount(AuditLayout, {
      global: {
        plugins: [i18n, router()],
        stubs: { AppSidebar: true, AppHeader: true, RouteDiagnostics: true, NoticeBanner: true },
      },
      slots: { default: "本文" },
    });

    expect(wrapper.get("main").attributes("aria-busy")).toBe("true");
    expect(wrapper.get('[role="status"]').text()).toBe("読み込み中...");
    expect(wrapper.get('[role="alert"]').text()).toBe("読み込みに失敗しました");
  });
});
