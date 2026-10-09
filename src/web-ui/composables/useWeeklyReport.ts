/**
 * Coordinates weekly report range requests and generation.
 *
 * 週次レポートの期間取得と生成を調整します。
 * @packageDocumentation
 */
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getJson, mutateJson } from "#webUi/services/api";
import type { WeeklyHistoryResponse, WeeklyReportResponse } from "#webUi/types/api";

function capDate(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * Loads weekly reports with stale-response protection when the selected range changes.
 *
 * 選択期間が変わった際に古い応答を無視しながら週次レポートを取得します。
 */
export function useWeeklyReport() {
  const route = useRoute();
  const router = useRouter();
  const report = ref<WeeklyReportResponse | null>(null);
  const history = ref<WeeklyHistoryResponse | null>(null);
  const week = ref("");
  const through = ref("");
  const loading = ref(false);
  const generating = ref(false);
  const error = ref("");
  const format = computed(() => (route.params.format === "markdown" ? "markdown" : "text"));
  const latestRequest = { value: 0 };
  const periods = computed(() => history.value?.periods ?? []);
  const versions = computed(
    () =>
      history.value?.versions.filter(
        (item) => item.week_start === week.value && item.week_end === report.value?.week_end,
      ) ?? [],
  );
  const canGenerate = computed(
    () =>
      periods.value.find((item) => item.week_start === week.value && item.week_end === report.value?.week_end)
        ?.can_generate ?? false,
  );
  const maxThrough = computed(() => (report.value ? capDate(report.value.week_end, report.value.today) : ""));
  const rangeLabel = computed(() => (report.value ? `${report.value.week_start} – ${report.value.week_end}` : ""));
  const currentText = computed(() => {
    if (!report.value) return "";
    return format.value === "markdown" ? report.value.markdown.text : report.value.text.text;
  });
  const markdownHtml = computed(() => report.value?.markdown.html ?? "");

  async function load(targetWeek?: string, targetThrough?: string): Promise<void> {
    const requestId = ++latestRequest.value;
    loading.value = true;
    error.value = "";
    const params = new URLSearchParams();
    if (targetWeek) params.set("week", targetWeek);
    if (targetThrough) params.set("through", targetThrough);
    try {
      const catalog = await getJson<WeeklyHistoryResponse>("/api/report/weekly/history");
      if (requestId !== latestRequest.value) return;
      history.value = catalog;
      const selectedWeek = targetWeek ?? catalog.current_week;
      const period = catalog.periods.find((item) => item.week_start === selectedWeek);
      const saved = catalog.versions.find(
        (item) => item.week_start === selectedWeek && (!period || item.week_end === period.week_end),
      );
      params.set("week", selectedWeek);
      if (!targetThrough && saved) params.set("through", saved.through);
      const selectedQuery = params.toString();
      const result = await getJson<WeeklyReportResponse>(
        `/api/report/weekly${selectedQuery ? `?${selectedQuery}` : ""}`,
      );
      if (requestId !== latestRequest.value) return;
      report.value = result;
      week.value = result.week_start;
      through.value = result.through;
    } catch (cause) {
      if (requestId === latestRequest.value) {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (requestId === latestRequest.value) loading.value = false;
    }
  }

  function setWeek(value: string): void {
    if (!value) return;
    week.value = value;
    through.value = "";
    report.value = null;
    void router.push({ query: { ...route.query, week: value, through: undefined } });
  }

  function setThrough(value: string): void {
    if (!value || !report.value) return;
    through.value = value;
    report.value = null;
    void router.push({ query: { ...route.query, week: week.value, through: value } });
  }

  async function generate(partialThrough?: string): Promise<void> {
    if (!report.value || !canGenerate.value || generating.value) return;
    const selectedWeek = week.value;
    const selectedThrough = partialThrough ?? maxThrough.value;
    const requestId = latestRequest.value;
    generating.value = true;
    error.value = "";
    try {
      const result = await mutateJson<WeeklyReportResponse>("/api/report/weekly/generate", "POST", {
        week: selectedWeek,
        through: selectedThrough,
      });
      if (requestId === latestRequest.value) {
        report.value = result;
        through.value = result.through;
        const unchanged = route.query.week === selectedWeek && route.query.through === selectedThrough;
        await router.replace({ query: { ...route.query, week: selectedWeek, through: selectedThrough } });
        if (unchanged) await load(selectedWeek, selectedThrough);
      }
    } catch (cause) {
      if (requestId === latestRequest.value) error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      generating.value = false;
    }
  }

  watch(
    () => [route.query.week, route.query.through],
    ([targetWeek, targetThrough]) => {
      report.value = null;
      void load(
        typeof targetWeek === "string" ? targetWeek : undefined,
        typeof targetThrough === "string" ? targetThrough : undefined,
      );
    },
    { immediate: true },
  );
  return {
    report,
    history,
    periods,
    versions,
    canGenerate,
    week,
    through,
    loading,
    generating,
    error,
    format,
    maxThrough,
    rangeLabel,
    currentText,
    markdownHtml,
    setWeek,
    setThrough,
    load,
    generate,
  };
}
