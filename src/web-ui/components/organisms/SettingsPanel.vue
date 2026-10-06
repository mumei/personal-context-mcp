<script setup lang="ts">
import { Clipboard, Cpu, ExternalLink, PlugZap } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { parseDailySchedule, type DailyScheduleWeekday } from "#shared/dailySchedule";
import { useAutomationStatus } from "#webUi/composables/settings/useAutomationStatus";
import { useDailyScheduleForm } from "#webUi/composables/settings/useDailyScheduleForm";
import { useDailyTaskAutomation } from "#webUi/composables/settings/useDailyTaskAutomation";
import { useProfileSettings } from "#webUi/composables/settings/useProfileSettings";
import { useMaintenanceSettings } from "#webUi/composables/settings/useMaintenanceSettings";
import type { DailyTaskClientStatus, DailyTaskRunner } from "#webUi/composables/settings/types";
import { useLocale } from "#webUi/composables/useLocale";
import BaseButton from "#webUi/components/atoms/BaseButton.vue";
import SectionHeader from "#webUi/components/molecules/SectionHeader.vue";

const emit = defineEmits<{ saved: [message: string] }>();
const loading = ref(true);
const timezones = [
  "Asia/Tokyo",
  "UTC",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
];
const { language, t, setLanguage } = useLocale();
const profileSettings = useProfileSettings();
const maintenanceSettings = useMaintenanceSettings();
const { maintenance, running: maintenanceRunning } = maintenanceSettings;
const { profile } = profileSettings;
const automationStatus = useAutomationStatus();
const { automation, configuredRunner } = automationStatus;
const scheduleForm = useDailyScheduleForm();
const { executionTime, selectedWeekdays } = scheduleForm;
const dailyTask = useDailyTaskAutomation({
  automation,
  configuredRunner,
  profileTimezone: () => String(profile.timezone),
  schedule: scheduleForm,
  reloadStatus: automationStatus.load,
  translate: t,
  notify: (message) => emit("saved", message),
});
const {
  setupRunner,
  switchMode,
  awaitingCompletion,
  sourceStopNote,
  setup,
  setupIntegration,
  availableModels,
  isEditing,
  beginSetup,
  beginEdit,
  saveSetup,
  completeSetup,
  startSwitch,
  closeSetup,
  canConfigure,
} = dailyTask;
const weekdayOptions = computed<Array<{ value: DailyScheduleWeekday; label: string }>>(() => [
  { value: "MO", label: t("weekdayMonday") },
  { value: "TU", label: t("weekdayTuesday") },
  { value: "WE", label: t("weekdayWednesday") },
  { value: "TH", label: t("weekdayThursday") },
  { value: "FR", label: t("weekdayFriday") },
  { value: "SA", label: t("weekdaySaturday") },
  { value: "SU", label: t("weekdaySunday") },
]);

function runnerLabel(runner: DailyTaskRunner): string {
  return {
    codex: "Codex Automation",
    cursor: "Cursor Automations",
    claude_code_loop: "Claude Code /loop",
    claude_desktop: "Claude Desktop Scheduled Tasks",
    copilot_cli: "GitHub Copilot CLI",
    gemini_cli: "Gemini CLI",
  }[runner];
}

function providerLabel(provider: string): string {
  return (
    {
      codex_app_server: "Codex App Server",
      claude_cli: "Claude Code CLI",
      copilot_cli: "GitHub Copilot CLI",
      cursor_cli: "Cursor CLI",
      gemini_cli: "Gemini CLI",
      lm_studio: "LM Studio",
    }[provider] ?? provider
  );
}

function providerSelectionReason(reason: string): string {
  const key = {
    environment_override: "providerReasonOverride",
    claude_client: "providerReasonClaude",
    codex_client: "providerReasonCodex",
    copilot_client: "providerReasonCopilot",
    cursor_client: "providerReasonCursor",
    gemini_client: "providerReasonGemini",
    lm_studio_client: "providerReasonLmStudio",
    default: "providerReasonDefault",
  }[reason];
  return key ? t(key) : reason;
}

function stateLabel(client: DailyTaskClientStatus): string {
  if (client.state === "configured") return t("automationConfigured");
  if (configuredRunner.value) return t("automationUnused");
  return t("automationNotConfigured");
}

function stateClass(client: DailyTaskClientStatus): string {
  if (client.state === "configured") return "state-configured";
  return configuredRunner.value ? "state-unused" : "state-not_configured";
}

function scheduleLabel(schedule?: string): string {
  if (!schedule) return "-";
  const controls = parseDailySchedule(schedule);
  const labels = weekdayOptions.value
    .filter(({ value }) => controls.weekdays.includes(value))
    .map(({ label }) => label)
    .join("・");
  return controls.time + " · " + labels;
}

onMounted(async () => {
  await Promise.all([profileSettings.load(), automationStatus.load(), maintenanceSettings.load()]);
  loading.value = false;
});

async function saveProfile() {
  await profileSettings.save();
  emit("saved", t("profileSaved"));
}

async function saveMaintenance() {
  await maintenanceSettings.save();
  emit("saved", t("maintenanceSaved"));
}

async function runMaintenance() {
  await maintenanceSettings.runNow();
  emit("saved", t("maintenanceCompleted"));
}

async function copySetup() {
  if (!setupIntegration.setup_command) return;
  await window.navigator.clipboard.writeText(setupIntegration.setup_command);
  emit("saved", t("setupCopied"));
}

function openSetup() {
  if (setupIntegration.setup_url) window.open(setupIntegration.setup_url, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <p v-if="loading">{{ t("loading") }}</p>
  <div v-else class="stack">
    <section class="surface form">
      <SectionHeader :title="t('displaySettings')" />
      <label
        >{{ t("displayLanguage")
        }}<select :value="language" @change="setLanguage(($event.target as HTMLSelectElement).value)">
          <option value="ja">{{ t("japanese") }}</option>
          <option value="en">{{ t("english") }}</option>
        </select></label
      >
    </section>

    <form class="surface form" @submit.prevent="saveProfile">
      <SectionHeader :title="t('dateSettings')" :description="t('dateSettingsDescription')" />
      <div class="fields">
        <label
          >{{ t("timezone")
          }}<select v-model="profile.timezone">
            <option v-for="zone in timezones" :key="zone">{{ zone }}</option>
          </select></label
        ><label
          >{{ t("rolloverHour")
          }}<input v-model="profile.activity_rollover_hour" inputmode="numeric" pattern="[0-9０-９]{1,2}" required
        /></label>
      </div>
      <BaseButton variant="primary">{{ t("saveSettings") }}</BaseButton>
    </form>

    <form class="surface form" @submit.prevent="saveMaintenance">
      <SectionHeader :title="t('backupMaintenance')" :description="t('backupMaintenanceDescription')" />
      <label class="toggle-label">
        <input v-model="maintenance.enabled" type="checkbox" />
        <span>{{ t("automaticCleanup") }}</span>
      </label>
      <div class="fields">
        <label>{{ t("maintenanceRunAt") }}<input v-model="maintenance.run_at" type="time" required /></label>
        <label
          >{{ t("keepAllDays") }}<input v-model.number="maintenance.keep_all_days" type="number" min="1" required
        /></label>
        <label
          >{{ t("keepDailyDays") }}<input v-model.number="maintenance.keep_daily_days" type="number" min="1" required
        /></label>
        <label
          >{{ t("keepWeeklyDays") }}<input v-model.number="maintenance.keep_weekly_days" type="number" min="1" required
        /></label>
        <label
          >{{ t("keepMonthlyDays")
          }}<input v-model.number="maintenance.keep_monthly_days" type="number" min="1" required
        /></label>
        <label
          >{{ t("archiveGraceDays")
          }}<input v-model.number="maintenance.archive_grace_days" type="number" min="1" required
        /></label>
        <label
          >{{ t("maxDailyVersions")
          }}<input v-model.number="maintenance.max_versions_per_file_per_day" type="number" min="1" max="100" required
        /></label>
      </div>
      <p v-if="maintenance.last_run" class="maintenance-status">
        {{ t("lastMaintenance") }}: {{ maintenance.last_run.operational_date }} · {{ t("archivedFiles") }}
        {{ maintenance.last_run.archived_count }}
      </p>
      <div class="setup-actions">
        <BaseButton type="button" :disabled="maintenanceRunning" @click="runMaintenance">{{
          t("runMaintenanceNow")
        }}</BaseButton>
        <BaseButton variant="primary">{{ t("saveSettings") }}</BaseButton>
      </div>
    </form>

    <section class="surface form provider-audit">
      <SectionHeader :title="t('llmProviderSettings')" :description="t('llmProviderSettingsDescription')" />
      <div class="provider-current">
        <Cpu :size="20" />
        <dl>
          <div>
            <dt>{{ t("configuredProvider") }}</dt>
            <dd>{{ automation.llm_provider.configured_provider }}</dd>
          </div>
          <div>
            <dt>{{ t("selectedProvider") }}</dt>
            <dd>{{ providerLabel(automation.llm_provider.selected_provider) }}</dd>
          </div>
          <div>
            <dt>{{ t("selectedModel") }}</dt>
            <dd>{{ automation.llm_provider.selected_model }}</dd>
          </div>
          <div>
            <dt>{{ t("selectionReason") }}</dt>
            <dd>{{ providerSelectionReason(automation.llm_provider.selection_reason) }}</dd>
          </div>
        </dl>
      </div>
      <div class="provider-list">
        <article v-for="provider in automation.llm_provider.providers" :key="provider.id" class="provider-row">
          <div>
            <strong>{{ providerLabel(provider.id) }}</strong>
            <span v-if="provider.selected" class="current-badge">{{ t("inUse") }}</span>
          </div>
          <small>{{ t("model") }}: {{ provider.model }}</small>
          <small>
            {{ t(provider.id === "lm_studio" ? "endpoint" : "command") }}:
            <code>{{ provider.command }}</code>
          </small>
        </article>
      </div>
    </section>

    <section class="surface form automation-audit">
      <SectionHeader :title="t('dailyTaskSettings')" :description="t('automationAuditDescription')" />
      <div class="current-client">
        <PlugZap :size="20" />
        <div>
          <span>{{ t("currentMcpClient") }}</span>
          <strong>{{ automation.connected_client.name || t("clientNotDetected") }}</strong>
          <small>{{ automation.connected_client.version || "-" }}</small>
        </div>
      </div>

      <div class="client-list">
        <article v-for="client in automation.clients" :key="client.runner" class="client-row">
          <div>
            <div class="client-title">
              <strong>{{ runnerLabel(client.runner) }}</strong>
              <span v-if="automation.connected_client.runner === client.runner" class="current-badge">{{
                t("currentClient")
              }}</span>
            </div>
            <p :class="stateClass(client)">{{ stateLabel(client) }}</p>
            <small v-if="client.state === 'configured'">
              {{ client.enabled ? t("automationActive") : t("automationPaused") }} · {{ scheduleLabel(client.schedule)
              }}<template v-if="client.model"> · {{ client.model }}</template>
            </small>
          </div>
          <BaseButton v-if="client.state === 'configured' && !switchMode" type="button" @click="beginEdit(client)">{{
            t("changeAutomation")
          }}</BaseButton>
          <BaseButton v-if="canConfigure(client)" type="button" @click="beginSetup(client.runner)">{{
            t(switchMode ? "selectSwitchTarget" : "configureAutomation")
          }}</BaseButton>
        </article>
      </div>
      <div v-if="configuredRunner && !setupRunner" class="setup-actions">
        <BaseButton v-if="!switchMode" type="button" @click="startSwitch">{{ t("switchAutomationClient") }}</BaseButton>
        <BaseButton v-else type="button" @click="closeSetup">{{ t("cancelSwitch") }}</BaseButton>
      </div>
    </section>

    <form v-if="setupRunner" class="surface form setup-form" @submit.prevent="saveSetup">
      <SectionHeader
        :title="runnerLabel(setup.runner) + ' ' + t(switchMode ? 'switchSetup' : 'setup')"
        :description="t('setupLanguageDescription')"
      />
      <div class="fields">
        <label>{{ t("name") }}<input v-model="setup.name" required /></label
        ><label
          >{{ t("model")
          }}<select v-model="setup.model" required>
            <option v-for="option in availableModels" :key="option.value" :value="option.value">
              {{ option.value }}{{ option.recommended ? ` (${t("recommended")})` : "" }}
            </option>
          </select></label
        ><label>{{ t("executionTime") }}<input v-model="executionTime" type="time" step="60" required /></label
        ><label
          >{{ t("timezone")
          }}<select v-model="setup.timezone">
            <option v-for="zone in timezones" :key="zone">{{ zone }}</option>
          </select></label
        ><label>{{ t("workspace") }}<input v-model="setup.workspace" required /></label
        ><label v-if="setup.runner === 'claude_code_loop'"
          >{{ t("loopInterval") }}<input v-model="setup.claude_loop_interval" pattern="[0-9]+[mhd]" required
        /></label>
        <fieldset class="full weekday-fieldset">
          <legend>{{ t("executionWeekdays") }}</legend>
          <label v-for="day in weekdayOptions" :key="day.value" class="weekday-option">
            <input v-model="selectedWeekdays" type="checkbox" :value="day.value" />{{ day.label }}
          </label>
          <small v-if="selectedWeekdays.length === 0" class="validation-error">{{ t("weekdayRequired") }}</small>
        </fieldset>
        <label class="full">{{ t("prompt") }}<textarea v-model="setup.prompt" rows="12" required /></label>
      </div>
      <div class="setup-actions">
        <BaseButton type="button" @click="closeSetup">{{ t("cancel") }}</BaseButton>
        <BaseButton v-if="!awaitingCompletion" variant="primary" :disabled="selectedWeekdays.length === 0">{{
          isEditing ? t("saveChanges") : t("configureAutomation")
        }}</BaseButton>
      </div>

      <section v-if="setupIntegration.status" class="integration" :class="setupIntegration.status">
        <strong>{{
          awaitingCompletion && setupIntegration.mode === "managed"
            ? t("switchReady")
            : setupIntegration.status === "synchronized"
              ? t("automationConfigured")
              : t("setupRequired")
        }}</strong>
        <ul v-if="setupIntegration.notes.length">
          <li v-for="note in setupIntegration.notes" :key="note">{{ t(note) }}</li>
        </ul>
        <p v-if="sourceStopNote" class="switch-note">{{ t(sourceStopNote) }}</p>
        <label v-if="setupIntegration.setup_command" class="setup-command"
          >{{ t("setupInstructions") }}<textarea :value="setupIntegration.setup_command" rows="7" readonly />
        </label>
        <div class="setup-actions">
          <BaseButton v-if="setupIntegration.setup_command" type="button" @click="copySetup"
            ><Clipboard :size="16" />{{ t("copySetup") }}</BaseButton
          ><BaseButton v-if="setupIntegration.setup_url" type="button" @click="openSetup"
            ><ExternalLink :size="16" />{{ t("openClientSettings") }}</BaseButton
          >
          <BaseButton v-if="awaitingCompletion" type="button" variant="primary" @click="completeSetup">{{
            t(switchMode ? "completeSwitch" : "completeExternalSetup")
          }}</BaseButton>
        </div>
      </section>
    </form>
  </div>
</template>

<style scoped>
.stack {
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
}
.form {
  display: grid;
  min-width: 0;
  gap: 18px;
  padding: 22px;
}
.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.fields label,
.form > label,
.setup-command {
  display: grid;
  min-width: 0;
  gap: 7px;
  font-size: 13px;
  font-weight: 700;
}
.fields .full {
  grid-column: 1 / -1;
}
.toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
}
.toggle-label input {
  width: auto;
}
.maintenance-status {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.weekday-fieldset {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line);
}
.weekday-fieldset legend {
  padding: 0 5px;
  font-size: 13px;
  font-weight: 700;
}
.weekday-option {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--surface-soft);
  font-size: 13px;
}
.weekday-option input {
  width: auto;
  margin: 0;
}
.validation-error {
  width: 100%;
  color: var(--danger);
}
input,
select,
textarea {
  min-width: 0;
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  color: var(--color-ink);
  background: var(--color-paper);
  font-weight: 400;
}
textarea {
  resize: vertical;
}
.form > :deep(.button) {
  justify-self: end;
}
.provider-current {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-left: 4px solid var(--accent);
  background: var(--color-accent-soft);
}
.provider-current dl {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 18px;
  margin: 0;
}
.provider-current dl > div {
  min-width: 0;
}
.provider-current dt {
  color: var(--muted);
  font-size: 12px;
}
.provider-current dd {
  margin: 3px 0 0;
  overflow-wrap: anywhere;
  font-weight: 700;
}
.provider-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.provider-row {
  display: grid;
  min-width: 0;
  gap: 7px;
  padding: 13px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-soft);
}
.provider-row > div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}
.provider-row small {
  color: var(--muted);
  overflow-wrap: anywhere;
}
.provider-row code {
  font-size: inherit;
}
.current-client {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-left: 4px solid var(--accent);
  background: var(--color-accent-soft);
}
.current-client div {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.current-client span,
.current-client small,
.client-row small {
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.client-list {
  border-top: 1px solid var(--line);
}
.client-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 15px 2px;
  border-bottom: 1px solid var(--line);
}
.client-row > div {
  min-width: 0;
}
.client-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.client-row p {
  margin: 4px 0;
  font-size: 13px;
  font-weight: 700;
}
.state-configured {
  color: var(--accent);
}
.state-not_configured,
.state-unused {
  color: var(--color-warning);
}
.current-badge {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--accent);
  color: var(--color-on-accent);
  font-size: 11px;
  font-weight: 700;
}
.setup-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}
.setup-actions :deep(button) {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.integration {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--line);
  border-left: 4px solid var(--color-warning-rule);
  background: var(--color-warning-soft);
}
.integration.synchronized {
  border-left-color: var(--accent);
  background: var(--color-accent-soft);
}
.integration ul {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.switch-note {
  margin: 0;
  padding: 10px 12px;
  border-left: 3px solid var(--color-warning-rule);
  background: var(--color-warning-soft);
  font-size: 13px;
}
.setup-command textarea {
  font-family: var(--font-mono);
  font-size: 12px;
}
@media (max-width: 650px) {
  .fields {
    grid-template-columns: 1fr;
  }
  .provider-current dl,
  .provider-list {
    grid-template-columns: 1fr;
  }
  .fields .full {
    grid-column: 1;
  }
  .client-row {
    align-items: stretch;
    flex-direction: column;
  }
  .client-row :deep(button) {
    width: 100%;
  }
}
</style>
