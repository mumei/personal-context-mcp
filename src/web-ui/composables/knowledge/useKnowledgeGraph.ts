/**
 * Owns Knowledge Graph query state, URL synchronization, API loading, and node selection.
 * It does not render Cytoscape or mutate knowledge data.
 *
 * Knowledge Graphの検索状態、URL同期、API取得、ノード選択を担当します。
 * Cytoscapeの描画やKnowledgeデータの変更は担当しません。
 *
 * @packageDocumentation
 */

import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getJson } from "#webUi/services/api";
import type { KnowledgeGraphResponse, KnowledgeNode, KnowledgeNoteResponse } from "#webUi/types/api";

const EMPTY_GRAPH: KnowledgeGraphResponse = {
  nodes: [],
  edges: [],
  warnings: [],
  stats: { nodes: 0, edges: 0, orphans: 0 },
};

function routeValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Provides the stateful read-only workflow used by the Knowledge Graph page.
 *
 * Knowledge Graphページが使用する、状態を持つ読み取り専用ワークフローを提供します。
 */
export function useKnowledgeGraph() {
  const route = useRoute();
  const router = useRouter();
  const graph = ref<KnowledgeGraphResponse>(EMPTY_GRAPH);
  const inspectionGraph = ref<KnowledgeGraphResponse>(EMPTY_GRAPH);
  const selectedNote = ref<KnowledgeNode>();
  const loading = ref(false);
  const loadingNote = ref(false);
  const error = ref("");
  const query = ref(routeValue(route.query.query));
  const type = ref(routeValue(route.query.type));
  const tag = ref(routeValue(route.query.tag));
  const orphanOnly = ref(route.query.orphans === "1");
  const appliedQuery = ref(query.value);
  const appliedType = ref(type.value);
  const appliedTag = ref(tag.value);
  const appliedOrphanOnly = ref(orphanOnly.value);
  const knownTypes = ref<string[]>([]);
  const knownTags = ref<string[]>([]);

  const filtersDirty = computed(
    () =>
      query.value.trim() !== appliedQuery.value ||
      type.value !== appliedType.value ||
      tag.value !== appliedTag.value ||
      orphanOnly.value !== appliedOrphanOnly.value,
  );
  const hasActiveFilters = computed(() =>
    Boolean(appliedQuery.value || appliedType.value || appliedTag.value || appliedOrphanOnly.value),
  );

  const orphanIds = computed(() => {
    const connected = new Set(graph.value.edges.flatMap((edge) => [edge.source, edge.target]));
    return new Set(graph.value.nodes.filter((node) => !connected.has(node.id)).map((node) => node.id));
  });

  const visibleGraph = computed<KnowledgeGraphResponse>(() => {
    if (!orphanOnly.value) return graph.value;
    const nodes = graph.value.nodes.filter((node) => orphanIds.value.has(node.id));
    return { ...graph.value, nodes, edges: [] };
  });

  function rememberFilterValues(response: KnowledgeGraphResponse): void {
    knownTypes.value = [...new Set([...knownTypes.value, ...response.nodes.map((node) => node.type)])].sort();
    knownTags.value = [...new Set([...knownTags.value, ...response.nodes.flatMap((node) => node.tags ?? [])])].sort();
  }

  async function loadGraph(): Promise<void> {
    loading.value = true;
    error.value = "";
    const params = new URLSearchParams({ depth: "1", limit: "250" });
    if (query.value.trim()) params.set("query", query.value.trim());
    if (type.value) params.set("type", type.value);
    if (tag.value) params.set("tag", tag.value);
    try {
      const response = await getJson<KnowledgeGraphResponse>(`/api/knowledge/graph?${params.toString()}`);
      graph.value = response;
      inspectionGraph.value = response;
      rememberFilterValues(response);
      if (selectedNote.value && !response.nodes.some((node) => node.id === selectedNote.value?.id)) {
        selectedNote.value = undefined;
      }
      if (orphanOnly.value && selectedNote.value && !orphanIds.value.has(selectedNote.value.id)) {
        selectedNote.value = undefined;
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  }

  async function applyFilters(): Promise<void> {
    const normalizedQuery = query.value.trim();
    await router.replace({
      name: "knowledge",
      query: {
        ...(normalizedQuery ? { query: normalizedQuery } : {}),
        ...(type.value ? { type: type.value } : {}),
        ...(tag.value ? { tag: tag.value } : {}),
        ...(orphanOnly.value ? { orphans: "1" } : {}),
      },
    });
    appliedQuery.value = normalizedQuery;
    appliedType.value = type.value;
    appliedTag.value = tag.value;
    appliedOrphanOnly.value = orphanOnly.value;
    await loadGraph();
  }

  async function clearFilters(): Promise<void> {
    query.value = "";
    type.value = "";
    tag.value = "";
    orphanOnly.value = false;
    await applyFilters();
  }

  async function selectNode(nodeId: string): Promise<void> {
    selectedNote.value = graph.value.nodes.find((node) => node.id === nodeId);
    loadingNote.value = true;
    error.value = "";
    try {
      const response = await getJson<KnowledgeNoteResponse>(
        `/api/knowledge/note/${encodeURIComponent(nodeId)}?depth=1`,
      );
      const detailGraph = response.graph ?? {
        nodes: response.nodes ?? graph.value.nodes,
        edges: response.edges ?? graph.value.edges,
        warnings: response.warnings ?? graph.value.warnings,
        stats: response.stats ?? graph.value.stats,
      };
      inspectionGraph.value = detailGraph;
      selectedNote.value = response.note ?? detailGraph.nodes.find((node) => node.id === nodeId) ?? selectedNote.value;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loadingNote.value = false;
    }
  }

  watch(
    () => route.query,
    (routeQuery) => {
      query.value = routeValue(routeQuery.query);
      type.value = routeValue(routeQuery.type);
      tag.value = routeValue(routeQuery.tag);
      orphanOnly.value = routeQuery.orphans === "1";
      appliedQuery.value = query.value;
      appliedType.value = type.value;
      appliedTag.value = tag.value;
      appliedOrphanOnly.value = orphanOnly.value;
    },
  );

  return {
    graph,
    inspectionGraph,
    visibleGraph,
    selectedNote,
    loading,
    loadingNote,
    error,
    query,
    type,
    tag,
    orphanOnly,
    appliedQuery,
    appliedType,
    appliedTag,
    appliedOrphanOnly,
    filtersDirty,
    hasActiveFilters,
    knownTypes,
    knownTags,
    loadGraph,
    applyFilters,
    clearFilters,
    selectNode,
  };
}
