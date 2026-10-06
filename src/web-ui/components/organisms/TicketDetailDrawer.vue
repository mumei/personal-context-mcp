<script setup lang="ts">
/** Displays the live ticket and its journal in an accessible modal drawer.
 * 最新チケットと履歴を、キーボード操作可能なモーダルドロワーで表示します。 */
import { computed, ref, watch, onBeforeUnmount, nextTick } from "vue";
import { X } from "@lucide/vue";
import { useLocale } from "#webUi/composables/useLocale";
import { useTicketHistory } from "#webUi/composables/useTicketHistory";
import type { BoardTicket } from "#webUi/composables/useTickets";
const props = defineProps<{ ticket?: BoardTicket }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useLocale();
const dialog = ref<HTMLDialogElement>();
const { history, loading, error, truncated } = useTicketHistory(computed(() => props.ticket));
let opener: HTMLElement | null = null;
let openerTicket = "";
function containKeyboardFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const controls = [
    ...(dialog.value?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    ) ?? []),
  ].filter((element) => element.getClientRects().length);
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && window.document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && window.document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
async function closeDrawer() {
  dialog.value?.close();
  emit("close");
  await nextTick();
  const replacement = [...window.document.querySelectorAll<HTMLElement>("[data-ticket-id]")].find(
    (element) => element.dataset.ticketId === openerTicket,
  );
  (opener?.isConnected && opener !== window.document.body
    ? opener
    : (replacement ?? window.document.querySelector<HTMLElement>(".ticket-filters input"))
  )?.focus();
}
watch(
  [() => !!props.ticket, dialog],
  ([open]) => {
    if (open && !dialog.value?.open) {
      opener = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
      openerTicket = props.ticket?.ticket_id ?? "";
      dialog.value?.showModal();
    } else if (!open && dialog.value?.open) {
      dialog.value.close();
      const replacement = [...window.document.querySelectorAll<HTMLElement>("[data-ticket-id]")].find(
        (element) => element.dataset.ticketId === openerTicket,
      );
      (opener?.isConnected
        ? opener
        : (replacement ?? window.document.querySelector<HTMLElement>(".ticket-filters input"))
      )?.focus();
    }
  },
  { flush: "post" },
);
onBeforeUnmount(() => {
  dialog.value?.close();
});
</script>
<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="ticket-detail"
      aria-labelledby="ticket-detail-title"
      @cancel.prevent="closeDrawer"
      @keydown="containKeyboardFocus"
      @click="$event.target === dialog && closeDrawer()"
    >
      <div v-if="ticket" class="ticket-detail-inner">
        <header>
          <h2 id="ticket-detail-title">{{ ticket.title }}</h2>
          <button
            type="button"
            autofocus
            :title="t('ticketCloseDetail')"
            :aria-label="t('ticketCloseDetail')"
            @click="closeDrawer"
          >
            <X :size="20" />
          </button>
        </header>
        <div class="ticket-detail-content">
          <dl>
            <dt>{{ t("ticketParentLabel") }}</dt>
            <dd>
              <RouterLink :to="`/tasks/${encodeURIComponent(ticket.task_id)}/current`" @click="emit('close')">{{
                ticket.parent_title
              }}</RouterLink>
            </dd>
            <dt>{{ t("ticketProjectLabel") }}</dt>
            <dd>{{ ticket.project || "—" }}</dd>
            <dt>{{ t("ticketAssigneeLabel") }}</dt>
            <dd>{{ ticket.assignee?.name || t("ticketUnassigned") }}</dd>
            <dt>{{ t("ticketPriority") }}</dt>
            <dd>P{{ ticket.priority }}</dd>
            <dt>{{ t("ticketStatus") }}</dt>
            <dd>{{ t(ticket.status) }}</dd>
            <dt>{{ t("ticketUpdated") }}</dt>
            <dd>
              <time :datetime="ticket.updated_at">{{ new Date(ticket.updated_at).toLocaleString() }}</time>
            </dd>
          </dl>
          <slot />
          <section>
            <h3>{{ t("ticketDescription") }}</h3>
            <p class="preserve">{{ ticket.description || t("ticketNoDetails") }}</p>
          </section>
          <section>
            <h3>
              {{ t("ticketAcceptance") }} · {{ ticket.acceptance.filter((a) => a.done).length }}/{{
                ticket.acceptance.length
              }}
            </h3>
            <ul class="acceptance">
              <li v-for="(item, index) in ticket.acceptance" :key="index" :class="{ 'is-complete': item.done }">
                <input type="checkbox" :checked="item.done" disabled :aria-label="item.text" /><span>{{
                  item.text
                }}</span>
              </li>
            </ul>
          </section>
          <section>
            <h3>{{ t("ticketReason") }}</h3>
            <p class="preserve">{{ ticket.discard_reason || ticket.stop_reason || t("ticketNone") }}</p>
          </section>
          <section>
            <h3>{{ t("ticketEvidence") }}</h3>
            <ul v-if="ticket.evidence.length">
              <li v-for="(item, index) in ticket.evidence" :key="index" class="preserve">{{ item }}</li>
            </ul>
            <p v-else>{{ t("ticketNone") }}</p>
          </section>
          <section>
            <h3>{{ t("ticketHistory") }}</h3>
            <p v-if="loading" role="status">{{ t("ticketLoadingHistory") }}</p>
            <p v-if="error" role="alert">{{ t("ticketHistoryError") }}: {{ error }}</p>
            <p v-if="!loading && !error && !history.length">{{ t("ticketNoHistory") }}</p>
            <ol class="history">
              <li v-for="(entry, index) in history" :key="entry.activity_id || `${entry.date}-${index}`">
                <time :datetime="entry.occurred_at || entry.date">{{
                  entry.occurred_at ? new Date(entry.occurred_at).toLocaleString() : entry.date
                }}</time>
                <template v-for="field in ['done', 'next', 'notes', 'sources'] as const" :key="field"
                  ><h4 v-if="entry[field].length">{{ t(`ticketHistory_${field}`) }}</h4>
                  <ul v-if="entry[field].length">
                    <li v-for="(item, itemIndex) in entry[field]" :key="itemIndex" class="preserve">{{ item }}</li>
                  </ul></template
                >
              </li>
            </ol>
            <p v-if="truncated">{{ t("ticketHistoryTruncated") }}</p>
          </section>
          <footer>{{ ticket.ticket_id }}</footer>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
<style scoped>
.ticket-detail {
  position: fixed;
  inset: 0 0 0 auto;
  margin: 0;
  width: min(560px, 100%);
  max-width: 100%;
  height: 100dvh;
  max-height: 100dvh;
  padding: 0;
  border: 0;
  border-left: 1px solid #cad5d3;
  color: #182e30;
  background: white;
}
.ticket-detail::backdrop {
  background: rgb(0 0 0 / 30%);
}
.ticket-detail-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
}
header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px;
  border-bottom: 1px solid #cad5d3;
}
h2 {
  margin: 0;
  font-size: 19px;
  overflow-wrap: anywhere;
}
header button {
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  padding: 0;
  display: grid;
  place-items: center;
}
.ticket-detail-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
  overflow-wrap: anywhere;
}
dl {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 8px 16px;
  margin: 0;
}
dt {
  color: #56706d;
}
dd {
  margin: 0;
}
section {
  border-top: 1px solid #dbe2e1;
  padding-top: 16px;
  margin-top: 20px;
}
h3 {
  font-size: 15px;
  margin: 0 0 10px;
}
h4 {
  font-size: 13px;
  margin: 10px 0 4px;
}
p,
li,
dl {
  font-size: 14px;
  line-height: 1.6;
}
.preserve {
  white-space: pre-wrap;
}
ul {
  padding-left: 20px;
}
li + li {
  margin-top: 8px;
}
.acceptance {
  list-style: none;
  padding: 0;
}
.acceptance li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.acceptance input {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  margin-top: 4px;
}
.acceptance .is-complete span {
  color: #42665e;
  text-decoration: line-through;
}
.history {
  padding-left: 20px;
}
.history > li {
  padding-bottom: 16px;
  border-bottom: 1px solid #e1e7e6;
}
time,
footer {
  font-size: 12px;
  color: #56706d;
}
footer {
  margin-top: 20px;
}
@media (max-width: 600px) {
  header,
  .ticket-detail-content {
    padding: 16px;
  }
  dl {
    grid-template-columns: 85px minmax(0, 1fr);
    gap: 8px;
  }
}
</style>
