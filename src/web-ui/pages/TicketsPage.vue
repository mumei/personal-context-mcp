<script setup lang="ts">
import { computed, ref, nextTick } from "vue";
import { useTickets, type BoardTicket } from "#webUi/composables/useTickets";
import { useLocale } from "#webUi/composables/useLocale";
import TicketDetailDrawer from "#webUi/components/organisms/TicketDetailDrawer.vue";
import { compareTicketsByRecency, ticketParentColorKey, ticketParentStyle } from "#webUi/utils/ticketBoard";
const { tickets, error, connected, busy, update } = useTickets();
const { t } = useLocale();
const filter = ref("");
const parent = ref("");
const project = ref("");
const assignee = ref("");
const status = ref("");
const showDone = ref(false);
const detailId = ref("");
const detailTicket = computed(() => tickets.value.find((ticket) => ticket.ticket_id === detailId.value));
const activeStates = ["todo", "inProgress", "waiting", "blocked", "done"] as const;
const states = [...activeStates, "discarded"] as const;
const boardStates = computed(() => (status.value === "discarded" ? (["discarded"] as const) : activeStates));
const choices = computed(() => ({
  parents: [...new Map(tickets.value.map((t) => [t.task_id, t.parent_title]))],
  projects: [...new Set(tickets.value.map((t) => t.project))],
  assignees: [...new Set(tickets.value.map((t) => t.assignee?.name ?? ""))],
}));
const visible = computed(() =>
  tickets.value
    .filter(
      (ticket) =>
        (!parent.value || ticket.task_id === parent.value) &&
        (!project.value || ticket.project === project.value) &&
        (!assignee.value || ticket.assignee?.name === assignee.value) &&
        (!status.value || ticket.status === status.value) &&
        ticket.title.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase()) &&
        (ticket.status !== "discarded" || status.value === "discarded") &&
        (showDone.value ||
          ticket.status !== "done" ||
          Date.parse(ticket.completed_at ?? "") > Date.now() - 7 * 86400000),
    )
    .sort(compareTicketsByRecency),
);
const selected = ref<BoardTicket>();
const editor = ref<HTMLFormElement>();
const target = ref("");
const reason = ref("");
const evidence = ref("");
const checked = ref<boolean[]>([]);
function select(ticket: BoardTicket, value: string) {
  selected.value = ticket;
  target.value = value;
  reason.value = ticket.discard_reason ?? ticket.stop_reason ?? "";
  evidence.value = ticket.evidence.join("\n");
  checked.value = ticket.acceptance.map((a) => a.done);
  void nextTick(() => editor.value?.querySelector<HTMLElement>("select, textarea, input, button")?.focus());
}
async function save() {
  if (!selected.value) return;
  await update(selected.value, {
    status: target.value,
    ...(["waiting", "blocked"].includes(target.value) ? { stop_reason: reason.value } : {}),
    ...(target.value === "discarded" ? { discard_reason: reason.value } : {}),
    ...(target.value === "done"
      ? {
          acceptance: selected.value.acceptance.map((a, i) => ({ ...a, done: checked.value[i] })),
          evidence: evidence.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
  });
  if (!error.value) selected.value = undefined;
}
</script>
<template>
  <section class="ticket-page">
    <header>
      <h2>{{ t("tickets") }}</h2>
      <span role="status">{{ connected ? t("ticketLive") : t("ticketReconnecting") }}</span>
    </header>
    <div class="ticket-filters">
      <input v-model="filter" :placeholder="t('ticketSearch')" :aria-label="t('ticketSearch')" />
      <select v-model="parent" :aria-label="t('ticketParent')">
        <option value="">{{ t("ticketParent") }}</option>
        <option v-for="[id, name] in choices.parents" :key="id" :value="id">{{ name }}</option>
      </select>
      <select v-model="project" :aria-label="t('ticketProject')">
        <option value="">{{ t("ticketProject") }}</option>
        <option v-for="name in choices.projects" :key="name">{{ name }}</option>
      </select>
      <select v-model="assignee" :aria-label="t('ticketAssignee')">
        <option value="">{{ t("ticketAssignee") }}</option>
        <option v-for="name in choices.assignees" :key="name">{{ name }}</option>
      </select>
      <select v-model="status" :aria-label="t('ticketStatus')">
        <option value="">{{ t("ticketStatus") }}</option>
        <option v-for="s in states" :key="s" :value="s">{{ t(s) }}</option>
      </select>
      <label><input v-model="showDone" type="checkbox" />{{ t("ticketAllDone") }}</label>
    </div>
    <dl class="ticket-status-guide">
      <div>
        <dt>{{ t("waiting") }}</dt>
        <dd>{{ t("ticketWaitingHelp") }}</dd>
      </div>
      <div>
        <dt>{{ t("blocked") }}</dt>
        <dd>{{ t("ticketBlockedHelp") }}</dd>
      </div>
      <div>
        <dt>{{ t("discarded") }}</dt>
        <dd>{{ t("ticketDiscardedHelp") }}</dd>
      </div>
    </dl>
    <p v-if="error" role="alert">{{ error }}</p>
    <p class="ticket-sort-order">{{ t("ticketSortNewest") }}</p>
    <div class="ticket-board">
      <section v-for="s in boardStates" :key="s" class="ticket-column">
        <h3>{{ t(s) }} · {{ visible.filter((x) => x.status === s).length }}</h3>
        <article
          v-for="ticket in visible.filter((x) => x.status === s)"
          :key="ticket.ticket_id"
          class="ticket-card"
          :data-parent-color="ticketParentColorKey(ticket.task_id)"
          :style="ticketParentStyle(ticket.task_id)"
        >
          <RouterLink :to="`/tasks/${encodeURIComponent(ticket.task_id)}/current`"
            >{{ ticket.project }} · {{ ticket.parent_title }}</RouterLink
          >
          <h4>
            <button
              class="ticket-title"
              type="button"
              aria-haspopup="dialog"
              :data-ticket-id="ticket.ticket_id"
              @click="detailId = ticket.ticket_id"
            >
              {{ ticket.title }}
            </button>
          </h4>
          <p>P{{ ticket.priority }} · {{ ticket.assignee?.name || t("ticketUnassigned") }}</p>
          <p>
            {{ t("ticketAcceptance") }} {{ ticket.acceptance.filter((a) => a.done).length }}/{{
              ticket.acceptance.length
            }}
          </p>
          <p v-if="ticket.discard_reason || ticket.stop_reason">{{ ticket.discard_reason || ticket.stop_reason }}</p>
          <details class="ticket-checklist">
            <summary>{{ t("ticketShowAcceptance") }}</summary>
            <ul>
              <li v-for="(item, index) in ticket.acceptance" :key="index" :class="{ 'is-complete': item.done }">
                <input type="checkbox" :checked="item.done" disabled :aria-label="item.text" /><span>{{
                  item.text
                }}</span>
              </li>
            </ul>
          </details>
          <p v-if="ticket.depends_on.length">
            {{ t("ticketDependencies") }}:
            {{
              ticket.depends_on
                .map((id) => tickets.find((x) => x.ticket_id === id)?.title || t("ticketUnknown"))
                .join(", ")
            }}
          </p>
          <time :datetime="ticket.updated_at">{{ new Date(ticket.updated_at).toLocaleString() }}</time>
          <span class="ticket-status">{{ t(ticket.status) }}</span>
        </article>
      </section>
    </div>
    <TicketDetailDrawer
      :ticket="detailTicket"
      @close="
        detailId = '';
        selected = undefined;
      "
    >
      <section v-if="detailTicket && detailTicket.status !== 'done'">
        <button v-if="!selected" type="button" @click="select(detailTicket, detailTicket.status)">
          {{ t("ticketCorrectStatus") }}
        </button>
        <form v-else ref="editor" class="ticket-editor" @submit.prevent="save">
          <h3>{{ t("ticketCorrectStatus") }}</h3>
          <label
            >{{ t("ticketStatus")
            }}<select v-model="target">
              <option v-for="next in states" :key="next" :value="next">{{ t(next) }}</option>
            </select></label
          >
          <label v-if="['waiting', 'blocked', 'discarded'].includes(target)"
            >{{ target === "discarded" ? t("ticketDiscardReason") : t("ticketReason")
            }}<textarea v-model="reason" required />
          </label>
          <template v-if="target === 'done'">
            <label v-for="(a, i) in selected.acceptance" :key="i"
              ><input v-model="checked[i]" type="checkbox" />{{ a.text }}</label
            >
            <label>{{ t("ticketEvidence") }}<textarea v-model="evidence" required /></label>
          </template>
          <p v-if="error" role="alert">{{ error }}</p>
          <button :disabled="busy" type="submit">{{ t("ticketSave") }}</button>
          <button type="button" @click="selected = undefined">{{ t("cancel") }}</button>
        </form>
      </section>
    </TicketDetailDrawer>
  </section>
</template>
<style scoped>
.ticket-page {
  min-width: 0;
}
.ticket-page header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.ticket-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}
.ticket-filters input,
.ticket-filters select {
  max-width: 240px;
  min-height: 36px;
}
.ticket-board {
  display: grid;
  grid-template-columns: repeat(5, minmax(220px, 1fr));
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 16px;
}
.ticket-sort-order {
  margin: 0 0 8px;
  color: var(--color-ink-2);
  font-size: var(--text-xs);
  text-align: right;
}
.ticket-status-guide {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin: -4px 0 16px;
  color: #516765;
  font-size: 12px;
}
.ticket-status-guide div {
  display: flex;
  gap: 6px;
}
.ticket-status-guide dt {
  color: #243f3c;
  font-weight: 700;
}
.ticket-status-guide dd {
  margin: 0;
}
.ticket-column {
  min-width: 0;
  border-top: 3px solid #5b7776;
  background: #f1f4f4;
  padding: 10px;
}
.ticket-column h3 {
  font-size: 15px;
  margin: 0 0 12px;
}
.ticket-card {
  border: 1px solid var(--ticket-parent-border, #cdd6d5);
  border-left: 4px solid var(--ticket-parent-accent, #5b7776);
  background: var(--ticket-parent-surface, white);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 10px;
  overflow-wrap: anywhere;
}
.ticket-card h4 {
  font-size: 15px;
  margin: 8px 0;
}
.ticket-title {
  padding: 0;
  border: 0;
  background: none;
  color: #146b61;
  text-align: left;
  font: inherit;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.ticket-title:hover {
  text-decoration: underline;
}
.ticket-title:focus-visible {
  outline: 2px solid #146b61;
  outline-offset: 4px;
}
.ticket-checklist {
  font-size: 12px;
  margin: 8px 0;
}
.ticket-checklist summary {
  cursor: pointer;
  color: #146b61;
}
.ticket-checklist ul {
  padding: 0;
  list-style: none;
}
.ticket-checklist li {
  display: flex;
  align-items: start;
  gap: 6px;
  margin-top: 8px;
}
.ticket-checklist input {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
}
.ticket-checklist .is-complete span {
  color: #42665e;
  text-decoration: line-through;
}
.ticket-card p,
.ticket-card time,
.ticket-card a {
  font-size: 12px;
}
.ticket-status {
  display: inline-block;
  margin-top: 10px;
  padding: 2px 8px;
  background: #e4efec;
  color: #28564f;
  font-size: 12px;
  border-radius: 4px;
}
.ticket-filters label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ticket-filters input[type="checkbox"] {
  min-height: auto;
  width: 16px;
  height: 16px;
  flex: none;
}
.ticket-editor {
  border-block: 1px solid #bbb;
  padding: 16px;
  display: grid;
  gap: 12px;
}
.ticket-editor label {
  display: block;
}
.ticket-editor textarea {
  display: block;
  width: 100%;
}
@media (max-width: 600px) {
  .ticket-page header {
    align-items: start;
  }
  .ticket-board {
    grid-template-columns: 1fr;
    overflow: visible;
  }
  .ticket-filters > * {
    flex: 1 1 140px;
    max-width: 100%;
  }
}
</style>
