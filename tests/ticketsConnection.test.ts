// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTickets } from "#webUi/composables/useTickets";
import { getJson } from "#webUi/services/api";
vi.mock("#webUi/services/api", () => ({ getJson: vi.fn(async () => ({ tickets: [] })), mutateJson: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("ticket connection recovery", () => {
  it("falls back to reads, reconnects and cancels retry after unmount", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    let state: ReturnType<typeof useTickets>;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useTickets();
          return () => null;
        },
      }),
    );
    await flushPromises();
    expect(state!.connected.value).toBe(false);
    expect(getJson).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
