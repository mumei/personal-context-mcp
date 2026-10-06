/**
 * Encapsulates the shared automation and LLM Provider audit state.
 * Responsibility: This module owns one canonical settings-status request and configured-runner derivation.
 * Non-responsibility: This module does not edit daily tasks or format presentation labels.
 *
 * 自動化とLLM Provider監査の共有状態をカプセル化します。
 * 責務: このモジュールは、設定状態APIの一元取得と設定済みrunnerの導出を担当します。
 * 非責務: このモジュールは、デイリータスクの変更や表示ラベルの整形を担当しません。
 *
 * @packageDocumentation
 */

import { computed, reactive } from "vue";
import { getJson } from "#webUi/services/api";
import type { AutomationStatus, DailyTaskRunner } from "#webUi/composables/settings/types";

/** Provides the shared settings audit state. */
export function useAutomationStatus() {
  const automation = reactive<AutomationStatus>({
    connected_client: {},
    llm_provider: {
      configured_provider: "auto",
      selected_provider: "",
      selected_model: "",
      selection_reason: "default",
      providers: [],
    },
    clients: [],
    model_options: {} as Record<DailyTaskRunner, Array<{ value: string; recommended: boolean }>>,
  });
  const configuredRunner = computed(() => automation.clients.find(({ state }) => state === "configured")?.runner);

  async function load(): Promise<void> {
    Object.assign(automation, await getJson<AutomationStatus>("/api/settings/automation-status"));
  }

  return { automation, configuredRunner, load };
}
