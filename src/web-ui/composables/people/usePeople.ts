/**
 * Owns People audit query state, route synchronization, and API loading.
 * It does not mutate person data or transmit it to an LLM.
 *
 * People監査の検索状態、ルート同期、API取得を担当します。
 * 人物データの更新やLLMへの送信は行いません。
 *
 * @packageDocumentation
 */
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getJson } from "#webUi/services/api";
import type { PeopleListResponse, PersonDetailResponse } from "#webUi/types/api";

/** Provides the read-only People audit workflow. 読み取り専用のPeople監査フローを提供します。 */
export function usePeople() {
  const route = useRoute();
  const router = useRouter();
  const profiles = ref<PeopleListResponse>({ count: 0, profiles: [] });
  const detail = ref<PersonDetailResponse>();
  const query = ref(typeof route.query.query === "string" ? route.query.query : "");
  const status = ref<"all" | "active" | "inactive">(
    route.query.status === "active" || route.query.status === "inactive" ? route.query.status : "all",
  );
  const loading = ref(false);
  const error = ref("");

  async function loadProfiles(): Promise<void> {
    loading.value = true;
    error.value = "";
    const params = new URLSearchParams();
    if (query.value.trim()) params.set("query", query.value.trim());
    if (status.value !== "all") params.set("status", status.value);
    try {
      profiles.value = await getJson<PeopleListResponse>(`/api/people?${params.toString()}`);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  }

  async function loadDetail(personId?: string): Promise<void> {
    detail.value = undefined;
    if (!personId) return;
    loading.value = true;
    error.value = "";
    try {
      detail.value = await getJson<PersonDetailResponse>(`/api/people/${encodeURIComponent(personId)}`);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  }

  async function applyFilters(): Promise<void> {
    await router.replace({
      name: "people",
      params: route.params.personId ? { personId: route.params.personId } : {},
      query: {
        ...(query.value.trim() ? { query: query.value.trim() } : {}),
        ...(status.value !== "all" ? { status: status.value } : {}),
      },
    });
    await loadProfiles();
  }

  async function selectPerson(personId: string): Promise<void> {
    await router.push({ name: "people", params: { personId }, query: route.query });
  }

  watch(
    () => route.params.personId,
    (personId) => void loadDetail(typeof personId === "string" ? personId : undefined),
  );

  return { profiles, detail, query, status, loading, error, loadProfiles, loadDetail, applyFilters, selectPerson };
}
