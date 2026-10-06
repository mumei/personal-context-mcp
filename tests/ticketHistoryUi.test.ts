// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { useTicketHistory } from "#webUi/composables/useTicketHistory";
import type { BoardTicket } from "#webUi/composables/useTickets";
import { getJson } from "#webUi/services/api";
vi.mock("#webUi/services/api", () => ({ getJson: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
it("ignores late responses from another card and stops refreshes when closed", async () => {
  vi.useFakeTimers();
  const current = ref<BoardTicket>();
  let resolveOld: (value: unknown) => void = () => {};
  vi.mocked(getJson).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  vi.mocked(getJson).mockResolvedValue({ history: [{ date: "new" }], truncated: false });
  let state!: ReturnType<typeof useTicketHistory>;
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useTicketHistory(current);
        return () => null;
      },
    }),
  );
  current.value = { task_id: "parent", ticket_id: "a" } as BoardTicket;
  await flushPromises();
  current.value = { task_id: "parent", ticket_id: "b" } as BoardTicket;
  await flushPromises();
  resolveOld({ history: [{ date: "old" }], truncated: false });
  await flushPromises();
  expect(state.history.value[0].date).toBe("new");
  await vi.advanceTimersByTimeAsync(5000);
  expect(getJson).toHaveBeenCalledTimes(3);
  current.value = undefined;
  await flushPromises();
  await vi.advanceTimersByTimeAsync(10000);
  expect(getJson).toHaveBeenCalledTimes(3);
  expect(state.history.value).toEqual([]);
  wrapper.unmount();
});
