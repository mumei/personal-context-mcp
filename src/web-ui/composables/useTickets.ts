/** Owns server-sourced board state, SSE reconnection and revision-aware mutations.
 * サーバー正本のボード状態、SSE再接続、版番号付き更新を担当します。
 * @packageDocumentation */
import { onMounted, onBeforeUnmount, ref } from "vue";
import { getJson, mutateJson } from "#webUi/services/api";
import type { PublicTicket } from "#shared/types/ticket";
export type BoardTicket = PublicTicket & { parent_title: string; project: string };
export function useTickets() {
  const tickets = ref<BoardTicket[]>([]);
  const error = ref("");
  const connected = ref(false);
  const busy = ref(false);
  let stopped = false;
  let generation = 0;
  let controller: AbortController;
  let timer: ReturnType<typeof setTimeout>;
  const load = async () => {
    const request = ++generation;
    const data = await getJson<{ tickets: BoardTicket[] }>("/api/tickets");
    if (!stopped && request === generation) tickets.value = data.tickets;
  };
  const connect = async () => {
    controller = new AbortController();
    try {
      const token = sessionStorage.getItem("task-mcp-web-token");
      const response = await fetch("/api/tickets/events", {
        signal: controller.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok || !response.body) throw new Error(`Connection: ${response.status}`);
      connected.value = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = event.split("\n").find((line) => line.startsWith("data: "));
          if (data) {
            generation++;
            tickets.value = JSON.parse(data.slice(6)).tickets;
          }
        }
      }
    } catch (e) {
      if (!stopped) error.value = String(e);
    } finally {
      connected.value = false;
      if (!stopped) {
        await load().catch(() => undefined);
        timer = setTimeout(() => void connect(), 5000);
      }
    }
  };
  const update = async (ticket: BoardTicket, patch: Record<string, unknown>) => {
    busy.value = true;
    error.value = "";
    try {
      await mutateJson("/api/tickets", "PUT", {
        task_id: ticket.task_id,
        ticket_id: ticket.ticket_id,
        revision: ticket.revision,
        patch,
      });
      await load();
    } catch (e) {
      error.value = String(e);
      await load().catch(() => undefined);
    } finally {
      busy.value = false;
    }
  };
  onMounted(() => {
    void load().catch((e) => (error.value = String(e)));
    void connect();
  });
  onBeforeUnmount(() => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
  });
  return { tickets, error, connected, busy, update };
}
