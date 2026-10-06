/** Refreshes the selected ticket journal independently of board snapshots.
 * 選択チケットの履歴をボード更新と独立して取得し、古い応答の混入を防ぎます。
 * @packageDocumentation */
import { ref, watch, onBeforeUnmount, type Ref } from "vue";
import { getJson } from "#webUi/services/api";
import type { BoardTicket } from "#webUi/composables/useTickets";
import type { TicketHistoryEntry } from "#shared/types/ticket";

export function useTicketHistory(ticket: Readonly<Ref<BoardTicket | undefined>>) {
  const history = ref<TicketHistoryEntry[]>([]);
  const loading = ref(false);
  const error = ref("");
  const truncated = ref(false);
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(
    () => ticket.value?.ticket_id,
    () => {
      const request = ++generation;
      clearTimeout(timer);
      history.value = [];
      error.value = "";
      truncated.value = false;
      const current = ticket.value;
      loading.value = !!current;
      if (!current) return;
      const refresh = async () => {
        try {
          const query = new URLSearchParams({ task_id: current.task_id, ticket_id: current.ticket_id });
          const result = await getJson<{ history: TicketHistoryEntry[]; truncated: boolean }>(
            `/api/tickets/detail?${query}`,
          );
          if (generation !== request) return;
          history.value = result.history;
          truncated.value = result.truncated;
          error.value = "";
        } catch (cause) {
          if (generation === request) error.value = String(cause);
        } finally {
          if (generation === request) {
            loading.value = false;
            timer = setTimeout(() => void refresh(), 5000);
          }
        }
      };
      void refresh();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    generation++;
    clearTimeout(timer);
  });
  return { history, loading, error, truncated };
}
