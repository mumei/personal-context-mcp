/**
 * Loads privacy-bounded Knowledge usage evidence for the audit UI.
 * It does not inspect prompts or infer whether an LLM followed the injected knowledge.
 *
 * 監査UI向けに、内容を含まないKnowledge利用証跡を取得します。
 * promptの閲覧や、LLMが注入された知識に従ったかの推測は行いません。
 *
 * @packageDocumentation
 */
import { ref } from "vue";
import { getJson } from "#webUi/services/api";
import type { KnowledgeUsageSummary } from "#webUi/types/api";

const EMPTY_USAGE: KnowledgeUsageSummary = {
  stored_note_count: 0,
  accumulation_event_count: 0,
  accumulated_note_write_count: 0,
  event_count: 0,
  matched_event_count: 0,
  injected_event_count: 0,
  injected_note_count: 0,
  workflows: {},
  recent_events: [],
};

/** Provides the read-only Knowledge usage audit workflow. 読み取り専用のKnowledge利用監査フローを提供します。 */
export function useKnowledgeUsage() {
  const usage = ref<KnowledgeUsageSummary>(EMPTY_USAGE);
  const loadingUsage = ref(false);
  const usageError = ref("");

  async function loadUsage(): Promise<void> {
    loadingUsage.value = true;
    usageError.value = "";
    try {
      usage.value = await getJson<KnowledgeUsageSummary>("/api/knowledge/usage?days=30&limit=20");
    } catch (cause) {
      usageError.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loadingUsage.value = false;
    }
  }

  return { usage, loadingUsage, usageError, loadUsage };
}
