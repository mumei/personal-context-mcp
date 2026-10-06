<script setup lang="ts">
/**
 * Renders the read-only Knowledge Graph with Cytoscape and exposes only audit navigation events.
 *
 * Cytoscapeで読み取り専用Knowledge Graphを描画し、監査用の選択イベントだけを公開します。
 */
import { Maximize2, Network } from "@lucide/vue";
import type { Core } from "cytoscape";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import IconButton from "#webUi/components/atoms/IconButton.vue";
import { useLocale } from "#webUi/composables/useLocale";
import type { KnowledgeGraphResponse } from "#webUi/types/api";

const props = defineProps<{ graph: KnowledgeGraphResponse; selectedId?: string }>();
const emit = defineEmits<{ select: [nodeId: string] }>();
const container = ref<HTMLDivElement>();
const { t } = useLocale();
const hoveredId = ref("");
const keyboardCursorId = ref("");
const ORPHAN_SUMMARY_ID = "__knowledge_orphan_summary__";
const connectedNodeIds = computed(() => new Set(props.graph.edges.flatMap((edge) => [edge.source, edge.target])));
const connectedNodes = computed(() => props.graph.nodes.filter((node) => connectedNodeIds.value.has(node.id)));
const orphanNodes = computed(() => props.graph.nodes.filter((node) => !connectedNodeIds.value.has(node.id)));
const orphanCount = computed(() => orphanNodes.value.length);
const degreeByNode = computed(() => {
  const degrees = new Map<string, number>();
  for (const edge of props.graph.edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  return degrees;
});
const componentAnchorIds = computed(() => {
  const adjacency = new Map<string, string[]>();
  for (const node of connectedNodes.value) adjacency.set(node.id, []);
  for (const edge of props.graph.edges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }
  const anchors = new Set<string>();
  const visited = new Set<string>();
  for (const node of connectedNodes.value) {
    if (visited.has(node.id)) continue;
    const component: string[] = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length) {
      const current = queue.shift();
      if (!current) continue;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    component.sort(
      (left, right) =>
        (degreeByNode.value.get(right) ?? 0) - (degreeByNode.value.get(left) ?? 0) || left.localeCompare(right),
    );
    if (component[0]) anchors.add(component[0]);
  }
  return anchors;
});
const legendTypes = computed(() => [...new Set(props.graph.nodes.map((node) => node.type))].sort());
const selectedTitle = computed(() => props.graph.nodes.find((node) => node.id === props.selectedId)?.title ?? "");
const hoveredTitle = computed(() => props.graph.nodes.find((node) => node.id === hoveredId.value)?.title ?? "");
let graphInstance: Core | undefined;
let resizeObserver: ResizeObserver | undefined;

const TYPE_LABEL_KEYS = {
  concept: "knowledgeType_concept",
  system: "knowledgeType_system",
  technology: "knowledgeType_technology",
  organization: "knowledgeType_organization",
  person: "knowledgeType_person",
  decision: "knowledgeType_decision",
  document: "knowledgeType_document",
} as const;

function typeLabel(value: string): string {
  const key = TYPE_LABEL_KEYS[value as keyof typeof TYPE_LABEL_KEYS];
  return key ? t(key) : value;
}

function graphColors(element: HTMLElement): Record<string, string> {
  const styles = window.getComputedStyle(element.ownerDocument.documentElement);
  const read = (name: string): string => styles.getPropertyValue(name).trim();
  return {
    ink: read("--color-cytoscape-ink"),
    paper: read("--color-cytoscape-paper"),
    focus: read("--color-cytoscape-focus"),
    edge: read("--color-cytoscape-edge"),
    concept: read("--color-cytoscape-concept"),
    system: read("--color-cytoscape-system"),
    technology: read("--color-cytoscape-technology"),
    organization: read("--color-cytoscape-organization"),
    person: read("--color-cytoscape-person"),
    decision: read("--color-cytoscape-decision"),
    document: read("--color-cytoscape-document"),
  };
}

function shortLabel(value: string): string {
  return value.length > 14 ? `${value.slice(0, 13)}…` : value;
}

function legendColor(type: string): string {
  const colors: Record<string, string> = {
    concept: "var(--color-graph-concept)",
    system: "var(--color-graph-system)",
    technology: "var(--color-graph-technology)",
    organization: "var(--color-graph-organization)",
    person: "var(--color-graph-person)",
    decision: "var(--color-graph-decision)",
    document: "var(--color-graph-document)",
  };
  return colors[type] ?? "var(--color-accent)";
}

async function renderGraph(): Promise<void> {
  graphInstance?.destroy();
  graphInstance = undefined;
  if (!container.value || !props.graph.nodes.length) return;
  const colors = graphColors(container.value);
  const { default: cytoscape } = await import("cytoscape");
  if (!container.value) return;
  graphInstance = cytoscape({
    container: container.value,
    elements: [
      ...props.graph.nodes.map((node) => ({
        data: { id: node.id, label: shortLabel(node.title), type: node.type },
        classes: [
          connectedNodeIds.value.has(node.id) ? "relation-node" : "orphan-node",
          (degreeByNode.value.get(node.id) ?? 0) > 1 ? "key-node" : "",
          componentAnchorIds.value.has(node.id) ? "cluster-anchor" : "",
        ]
          .filter(Boolean)
          .join(" "),
      })),
      ...(orphanCount.value
        ? [
            {
              data: {
                id: ORPHAN_SUMMARY_ID,
                label: t("knowledgeGraphOrphanGroup", { count: orphanCount.value }),
              },
              classes: "orphan-summary",
            },
          ]
        : []),
      ...props.graph.edges.map((edge) => ({
        data: { id: edge.id, source: edge.source, target: edge.target, relation: edge.label ?? edge.type },
      })),
    ],
    layout: { name: "preset" },
    minZoom: 0.18,
    maxZoom: 2.7,
    style: [
      {
        selector: "node",
        style: {
          label: "",
          width: 60,
          height: 60,
          color: colors.ink,
          "font-size": 30,
          "font-weight": 700,
          "min-zoomed-font-size": 7,
          "text-wrap": "wrap",
          "text-max-width": "224px",
          "text-valign": "bottom",
          "text-margin-y": 20,
          "text-outline-color": colors.paper,
          "text-outline-opacity": 1,
          "text-outline-width": 4,
          "background-color": colors.concept,
          "border-width": 2,
          "border-color": colors.paper,
          "overlay-opacity": 0,
        },
      },
      { selector: 'node[type = "concept"]', style: { "background-color": colors.concept } },
      { selector: 'node[type = "system"]', style: { "background-color": colors.system } },
      { selector: 'node[type = "technology"]', style: { "background-color": colors.technology } },
      { selector: 'node[type = "organization"]', style: { "background-color": colors.organization } },
      { selector: 'node[type = "person"]', style: { "background-color": colors.person } },
      { selector: 'node[type = "decision"]', style: { "background-color": colors.decision } },
      { selector: 'node[type = "document"]', style: { "background-color": colors.document } },
      {
        selector: ".cluster-anchor",
        style: { label: "data(label)" },
      },
      {
        selector: "edge",
        style: {
          label: "",
          width: 1.4,
          color: colors.ink,
          "font-size": 10,
          "font-weight": 700,
          "min-zoomed-font-size": 7,
          "line-color": colors.edge,
          "target-arrow-color": colors.edge,
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          "text-outline-color": colors.paper,
          "text-outline-opacity": 1,
          "text-outline-width": 3,
          "text-rotation": "autorotate",
          opacity: 0.75,
        },
      },
      { selector: ".hovered-edge", style: { label: "data(relation)", opacity: 1, width: 2.4 } },
      {
        selector: ".orphan-node",
        style: { width: 48, height: 48, opacity: 0.82 },
      },
      {
        selector: ".orphan-summary",
        style: {
          label: "data(label)",
          width: 1,
          height: 1,
          color: colors.ink,
          "font-size": 28,
          "font-weight": 700,
          "min-zoomed-font-size": 6,
          "text-outline-color": colors.paper,
          "text-outline-opacity": 1,
          "text-outline-width": 5,
          "background-opacity": 0,
          "border-width": 0,
          events: "no",
        },
      },
      {
        selector: ".key-node",
        style: { width: 72, height: 72, "border-width": 3 },
      },
      {
        selector: ".keyboard-cursor",
        style: { "border-width": 4, "border-color": colors.focus, width: 76, height: 76 },
      },
      {
        selector: ".selected",
        style: { "border-width": 5, "border-color": colors.ink, width: 80, height: 80 },
      },
      { selector: ".selected-edge", style: { width: 2.4, opacity: 1 } },
    ],
  });
  positionGraph();
  graphInstance.on("tap", "node", (event) => {
    if (event.target.id() !== ORPHAN_SUMMARY_ID) selectNode(event.target.id());
  });
  graphInstance.on("mouseover", "node", (event) => {
    if (event.target.id() === ORPHAN_SUMMARY_ID) return;
    graphInstance?.nodes().removeClass("hovered");
    hoveredId.value = event.target.id();
    event.target.addClass("hovered");
  });
  graphInstance.on("mouseout", "node", (event) => {
    if (hoveredId.value === event.target.id()) hoveredId.value = "";
    event.target.removeClass("hovered");
  });
  graphInstance.on("mouseover", "edge", (event) => event.target.addClass("hovered-edge"));
  graphInstance.on("mouseout", "edge", (event) => event.target.removeClass("hovered-edge"));
  updateSelection();
}

function positionGraph(): void {
  if (!graphInstance) return;
  const relationNodes = graphInstance.nodes(".relation-node");
  if (relationNodes.length) {
    relationNodes
      .union(relationNodes.connectedEdges())
      .layout({
        name: "cose",
        animate: false,
        fit: false,
        componentSpacing: 80,
        nodeDimensionsIncludeLabels: false,
        nodeRepulsion: () => 4096,
        idealEdgeLength: () => 84,
      })
      .run();
  }

  const relationBounds = relationNodes.length
    ? relationNodes.boundingBox({ includeLabels: false, includeOverlays: false })
    : { x1: 0, y1: 0, w: 0, h: 0 };
  const canvasWidth = Math.max(1040, relationBounds.w + 160);
  const relationOffsetX = (canvasWidth - relationBounds.w) / 2 - relationBounds.x1;
  const relationOffsetY = 80 - relationBounds.y1;
  relationNodes.positions((node) => ({
    x: node.position("x") + relationOffsetX,
    y: node.position("y") + relationOffsetY,
  }));

  const orphanElements = graphInstance.nodes(".orphan-node");
  if (orphanElements.length) {
    const centerX = canvasWidth / 2;
    const centerY = relationBounds.h + 390;
    const innerCount = orphanElements.length > 12 ? Math.ceil(orphanElements.length * 0.38) : 0;
    const innerNodes = innerCount ? orphanElements.slice(0, innerCount) : graphInstance.collection();
    const outerNodes = innerCount ? orphanElements.slice(innerCount) : orphanElements;
    positionRing(innerNodes, centerX, centerY, 260, 105, -Math.PI / 2);
    positionRing(
      outerNodes,
      centerX,
      centerY,
      orphanElements.length > 12 ? 470 : Math.max(180, orphanElements.length * 42),
      orphanElements.length > 12 ? 190 : 125,
      -Math.PI / 2 + Math.PI / Math.max(1, outerNodes.length),
    );
    graphInstance.getElementById(ORPHAN_SUMMARY_ID).position({ x: centerX, y: centerY });
  }
  graphInstance.resize();
  graphInstance.fit(graphInstance.elements(), 40);
}

function positionRing(
  nodes: ReturnType<Core["nodes"]>,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  startAngle: number,
): void {
  nodes.positions((node, index) => {
    const angle = startAngle + (Math.PI * 2 * index) / Math.max(1, nodes.length);
    return { x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY };
  });
}

function updateSelection(): void {
  graphInstance?.nodes().removeClass("selected");
  graphInstance?.edges().removeClass("selected-edge");
  if (!props.selectedId) {
    updateKeyboardCursor();
    return;
  }
  const selectedNode = graphInstance?.getElementById(props.selectedId);
  selectedNode?.addClass("selected");
  selectedNode?.connectedEdges().addClass("selected-edge");
  keyboardCursorId.value = props.selectedId;
  updateKeyboardCursor();
}

function updateKeyboardCursor(): void {
  graphInstance?.nodes().removeClass("keyboard-cursor");
  if (keyboardCursorId.value) graphInstance?.getElementById(keyboardCursorId.value).addClass("keyboard-cursor");
}

function selectNode(nodeId: string): void {
  keyboardCursorId.value = nodeId;
  hoveredId.value = nodeId;
  emit("select", nodeId);
}

function cycleNode(direction: 1 | -1): void {
  const ids = props.graph.nodes.map((node) => node.id);
  if (!ids.length) return;
  const currentIndex = ids.indexOf(keyboardCursorId.value || props.selectedId || "");
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + ids.length) % ids.length;
  keyboardCursorId.value = ids[nextIndex];
  hoveredId.value = ids[nextIndex];
}

function ensureKeyboardCursor(): void {
  if (!keyboardCursorId.value && props.graph.nodes.length) {
    keyboardCursorId.value = props.graph.nodes[0].id;
    hoveredId.value = keyboardCursorId.value;
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.target !== event.currentTarget) return;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    cycleNode(1);
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    cycleNode(-1);
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (keyboardCursorId.value) selectNode(keyboardCursorId.value);
  }
}

function fitGraph(): void {
  graphInstance?.fit(graphInstance.elements(), 40);
}

onMounted(() => {
  if (container.value) {
    resizeObserver = new ResizeObserver(() => {
      graphInstance?.resize();
      fitGraph();
    });
    resizeObserver.observe(container.value);
  }
  void renderGraph();
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  graphInstance?.destroy();
});
watch(
  () => props.graph,
  async () => {
    await nextTick();
    await renderGraph();
  },
  { deep: true },
);
watch(() => props.selectedId, updateSelection);
watch(keyboardCursorId, updateKeyboardCursor);
</script>

<template>
  <section
    class="graph-frame"
    role="group"
    tabindex="0"
    :aria-label="t('knowledgeGraphCanvas')"
    :aria-describedby="props.graph.nodes.length ? 'knowledge-graph-keyboard-hint' : undefined"
    @focus="ensureKeyboardCursor"
    @keydown="handleKeydown"
  >
    <header v-if="props.graph.nodes.length" class="graph-header">
      <div v-if="legendTypes.length" class="graph-legend" :aria-label="t('knowledgeGraphLegend')">
        <span v-for="type in legendTypes" :key="type" class="legend-item">
          <i class="legend-swatch" :style="{ backgroundColor: legendColor(type) }"></i>{{ typeLabel(type) }}
        </span>
      </div>
      <p class="graph-scope">
        {{ t("knowledgeGraphScopeSummary", { connected: connectedNodes.length, orphan: orphanCount }) }}
      </p>
      <IconButton :label="t('knowledgeFitGraph')" @click="fitGraph">
        <Maximize2 :size="18" />
      </IconButton>
    </header>
    <p id="knowledge-graph-keyboard-hint" class="sr-only">{{ t("knowledgeGraphKeyboardHint") }}</p>
    <p v-if="selectedTitle" class="graph-node-title selected-title" aria-live="polite">
      {{ t("knowledgeGraphSelectedNode") }}: {{ selectedTitle }}
    </p>
    <p v-if="hoveredTitle && hoveredId !== selectedId" class="graph-node-title hovered-title" aria-live="polite">
      {{ t("knowledgeGraphHoveredNode") }}: {{ hoveredTitle }}
    </p>
    <p v-if="props.graph.nodes.length && !selectedTitle && !hoveredTitle" class="graph-node-title graph-help">
      {{ t("knowledgeGraphHelp") }}
    </p>
    <div
      v-if="props.graph.nodes.length"
      ref="container"
      class="graph-canvas"
      role="img"
      :aria-label="t('knowledgeGraphCanvasDescription')"
    ></div>
    <div v-else class="graph-empty">
      <Network :size="28" aria-hidden="true" />
      <strong>{{ t("knowledgeGraphNoRelationsTitle") }}</strong>
      <p>{{ t("knowledgeGraphNoRelationsDescription", { count: 0 }) }}</p>
    </div>
  </section>
</template>

<style scoped>
.graph-frame {
  display: grid;
  position: relative;
  min-width: 0;
  min-height: 430px;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-surface);
  background: var(--color-paper-2);
}
.graph-frame:focus-visible {
  outline: 3px solid var(--color-accent);
  outline-offset: 2px;
}
.graph-canvas {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 360px;
}
.graph-header {
  display: flex;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-2xs);
  border-bottom: 1px solid var(--line);
  background: color-mix(in oklch, var(--color-paper) 94%, transparent);
}
.graph-header > :deep(button) {
  flex: none;
  border: 1px solid var(--line);
  background: color-mix(in oklch, var(--color-paper) 96%, transparent);
}
.graph-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3xs) var(--space-2xs);
  color: var(--muted);
  font-size: var(--text-xs);
  line-height: 1.2;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.legend-swatch {
  width: var(--space-2xs);
  height: var(--space-2xs);
  border: 1px solid color-mix(in oklch, var(--color-ink) 22%, transparent);
  border-radius: 999px;
}
.graph-scope {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2xs);
  margin: 0;
  color: var(--muted);
  font-size: var(--text-xs);
}
.graph-empty {
  display: grid;
  grid-row: 1 / -1;
  min-height: 360px;
  place-content: center;
  justify-items: center;
  gap: var(--space-2xs);
  padding: var(--space-md);
  color: var(--muted);
  text-align: center;
}
.graph-empty strong {
  color: var(--text);
  font-size: var(--text-md);
}
.graph-empty p {
  max-width: 52ch;
  margin: 0;
}
.graph-node-title {
  position: absolute;
  z-index: 2;
  right: 10px;
  bottom: 10px;
  max-width: min(70%, 440px);
  margin: 0;
  padding: 6px 8px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-paper) 96%, transparent);
  color: var(--color-ink);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hovered-title {
  bottom: 42px;
}
.graph-help {
  color: var(--muted);
  font-weight: 600;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 640px) {
  .graph-scope {
    width: 100%;
    flex-basis: 100%;
    justify-content: flex-start;
  }
  .graph-node-title {
    max-width: calc(100% - 20px);
  }
}
</style>
