/**
 * Encapsulates the daily-task setup and exclusive client-switch workflow.
 * Responsibility: This module owns setup form state, preparation, completion, editing, and status refresh behavior.
 * Non-responsibility: This module does not render setup controls, translate client labels, or choose notification layout.
 *
 * デイリータスク設定と排他的なクライアント切り替えをカプセル化します。
 * 責務: このモジュールは、設定form状態、準備、確定、編集、状態再取得のworkflowを担当します。
 * 非責務: このモジュールは、設定controlの描画、クライアント名の翻訳、通知layoutを担当しません。
 *
 * @packageDocumentation
 */

import { computed, reactive, ref, type ComputedRef } from "vue";
import { getJson, mutateJson } from "#webUi/services/api";
import type { MessageKey } from "#webUi/composables/useLocale";
import type {
  AutomationStatus,
  DailyTaskClientStatus,
  DailyTaskIntegration,
  DailyTaskRunner,
  DailyTaskSettings,
  DailyTaskSetupResponse,
} from "#webUi/composables/settings/types";
import type { useDailyScheduleForm } from "#webUi/composables/settings/useDailyScheduleForm";

interface DailyTaskAutomationOptions {
  automation: AutomationStatus;
  configuredRunner: ComputedRef<DailyTaskRunner | undefined>;
  profileTimezone: () => string;
  schedule: ReturnType<typeof useDailyScheduleForm>;
  reloadStatus: () => Promise<void>;
  translate: (key: MessageKey) => string;
  notify: (message: string) => void;
}

const emptyIntegration = (): DailyTaskIntegration => ({
  mode: "",
  status: "",
  setup_url: "",
  setup_command: "",
  notes: [],
});

/** Provides the complete daily-task setup workflow used by the Settings view. */
export function useDailyTaskAutomation(options: DailyTaskAutomationOptions) {
  const setupRunner = ref<DailyTaskRunner>();
  const switchMode = ref(false);
  const sourceRunner = ref<DailyTaskRunner>();
  const awaitingCompletion = ref(false);
  const sourceStopNote = ref("");
  const setup = reactive<DailyTaskSettings>({
    version: 1,
    name: "",
    enabled: true,
    runner: "codex",
    schedule: "RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=30",
    timezone: "Asia/Tokyo",
    model: "",
    reasoning_effort: "medium",
    workspace: "",
    claude_loop_interval: "24h",
    prompt: "",
  });
  const setupIntegration = reactive<DailyTaskIntegration>(emptyIntegration());
  const availableModels = computed(() => {
    const modelOptions = options.automation.model_options[setup.runner] ?? [];
    return setup.model && !modelOptions.some(({ value }) => value === setup.model)
      ? [{ value: setup.model, recommended: false }, ...modelOptions]
      : modelOptions;
  });
  const isEditing = computed(() => options.configuredRunner.value === setupRunner.value);

  function resetIntegration(): void {
    Object.assign(setupIntegration, emptyIntegration());
  }

  function beginSetup(runner: DailyTaskRunner): void {
    setupRunner.value = runner;
    setup.runner = runner;
    setup.name = options.translate("dailyTaskDefaultName");
    setup.timezone = options.profileTimezone();
    setup.prompt = options.translate("dailyTaskDefaultPrompt");
    setup.model = options.automation.model_options[runner]?.find(({ recommended }) => recommended)?.value ?? "auto";
    options.schedule.reset();
    awaitingCompletion.value = false;
    sourceStopNote.value = "";
    resetIntegration();
  }

  async function beginEdit(client: DailyTaskClientStatus): Promise<void> {
    switchMode.value = false;
    sourceRunner.value = client.runner;
    const current = await getJson<DailyTaskSettings>("/api/settings/daily-task");
    Object.assign(setup, current, { runner: client.runner });
    options.schedule.load(current.schedule);
    setupRunner.value = client.runner;
    awaitingCompletion.value = false;
    sourceStopNote.value = "";
    resetIntegration();
  }

  async function saveSetup(): Promise<void> {
    setup.schedule = options.schedule.serialize();
    const needsConfirmation = switchMode.value || setup.runner !== "codex";
    const result = await mutateJson<DailyTaskSetupResponse>(
      needsConfirmation ? "/api/settings/daily-task/prepare" : "/api/settings/daily-task",
      needsConfirmation ? "POST" : "PUT",
      setup,
    );
    Object.assign(setupIntegration, result.integration);
    if (needsConfirmation) {
      sourceRunner.value = result.source_runner;
      sourceStopNote.value = result.source_stop_note ?? "";
      awaitingCompletion.value = true;
      options.notify(options.translate("automationSetupPrepared"));
      return;
    }
    await options.reloadStatus();
    options.notify(options.translate("automationSetupSaved"));
    closeSetup();
  }

  async function completeSetup(): Promise<void> {
    const wasSwitch = switchMode.value;
    await mutateJson("/api/settings/daily-task/complete", "POST", {
      ...setup,
      source_runner: sourceRunner.value,
    });
    await options.reloadStatus();
    options.notify(options.translate(wasSwitch ? "automationSwitched" : "automationSetupSaved"));
    closeSetup();
  }

  function startSwitch(): void {
    sourceRunner.value = options.configuredRunner.value;
    switchMode.value = true;
    setupRunner.value = undefined;
  }

  function closeSetup(): void {
    setupRunner.value = undefined;
    switchMode.value = false;
    sourceRunner.value = undefined;
    awaitingCompletion.value = false;
    sourceStopNote.value = "";
    resetIntegration();
  }

  function canConfigure(client: DailyTaskClientStatus): boolean {
    return (!options.configuredRunner.value || switchMode.value) && client.state !== "configured";
  }

  return {
    setupRunner,
    switchMode,
    sourceRunner,
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
  };
}
