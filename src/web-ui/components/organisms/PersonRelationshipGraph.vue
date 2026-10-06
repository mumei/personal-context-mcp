<script setup lang="ts">
/**
 * Renders a local, read-only graph of people, organizations, and typed relationships.
 * Responsibility: This component translates People data into Cytoscape nodes and edges and emits person selection.
 * Non-responsibility: It does not load, infer, or mutate person information.
 *
 * 人物・所属組織・型付き関係をローカルの読み取り専用グラフとして描画します。
 * 責務: PeopleデータをCytoscapeのノードとエッジへ変換し、人物選択を通知します。
 * 非責務: 人物情報の取得、推測、更新は担当しません。
 */
import { Maximize2, RotateCcw } from "@lucide/vue";
import type { Core } from "cytoscape";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import IconButton from "#webUi/components/atoms/IconButton.vue";
import { useLocale } from "#webUi/composables/useLocale";
import type { PersonProfile, PersonRelationship } from "#webUi/types/api";

const props = defineProps<{
  profiles: PersonProfile[];
  relationships: PersonRelationship[];
  selectedId: string;
}>();
const emit = defineEmits<{ select: [personId: string] }>();
const container = ref<HTMLDivElement>();
const { t } = useLocale();
let graphInstance: Core | undefined;

function colors(element: HTMLElement): Record<string, string> {
  const styles = window.getComputedStyle(element.ownerDocument.documentElement);
  const read = (name: string): string => styles.getPropertyValue(name).trim();
  return {
    ink: read("--color-ink"),
    paper: read("--color-paper"),
    edge: read("--color-graph-edge"),
    person: read("--color-graph-person"),
    organization: read("--color-graph-organization"),
    accent: read("--color-accent"),
  };
}

function relationshipLabel(type: string): string {
  if (type === "client") return t("peopleRelationship_client");
  if (type === "colleague") return t("peopleRelationship_colleague");
  return type;
}

async function renderGraph(): Promise<void> {
  if (!container.value) return;
  const palette = colors(container.value);
  const { default: cytoscape } = await import("cytoscape");
  if (!container.value) return;
  graphInstance?.destroy();

  const organizations = new Map<string, string>();
  const organizationEdges = props.profiles.flatMap((profile) =>
    profile.organizations.map((organization, index) => {
      const organizationId = `organization:${organization.name}`;
      organizations.set(organizationId, organization.name);
      return {
        data: {
          id: `membership:${profile.id}:${index}`,
          source: profile.id,
          target: organizationId,
          label: organization.role || t("peopleOrganizationMember"),
          kind: "membership",
        },
        classes: "directed",
      };
    }),
  );

  graphInstance = cytoscape({
    container: container.value,
    elements: [
      ...props.profiles.map((profile) => ({
        data: { id: profile.id, label: profile.display_name, kind: "person" },
        classes: profile.id === props.selectedId ? "selected" : "",
      })),
      ...[...organizations].map(([id, label]) => ({ data: { id, label, kind: "organization" } })),
      ...props.relationships.map((relationship) => ({
        data: {
          id: relationship.id,
          source: relationship.from_person_id,
          target: relationship.to_person_id,
          label: relationshipLabel(relationship.type),
          kind: "relationship",
        },
        classes: relationship.type === "colleague" ? "symmetric" : "directed",
      })),
      ...organizationEdges,
    ],
    layout: { name: "cose", animate: false, fit: true, padding: 42, nodeRepulsion: () => 340000 },
    minZoom: 0.35,
    maxZoom: 2.5,
    style: [
      {
        selector: "node",
        style: {
          label: "data(label)",
          width: 46,
          height: 46,
          color: palette.ink,
          "font-size": 11,
          "font-weight": 700,
          "text-wrap": "wrap",
          "text-max-width": "110px",
          "text-valign": "bottom",
          "text-margin-y": 8,
          "background-color": palette.person,
          "border-width": 2,
          "border-color": palette.paper,
          "overlay-opacity": 0,
        },
      },
      {
        selector: 'node[kind = "organization"]',
        style: {
          shape: "round-rectangle",
          width: 62,
          height: 34,
          "background-color": palette.organization,
        },
      },
      {
        selector: "edge",
        style: {
          label: "data(label)",
          width: 1.5,
          color: palette.ink,
          "font-size": 9,
          "line-color": palette.edge,
          "target-arrow-color": palette.edge,
          "target-arrow-shape": "none",
          "curve-style": "bezier",
          "text-background-color": palette.paper,
          "text-background-opacity": 0.92,
          "text-background-padding": "3px",
          "text-rotation": "autorotate",
          opacity: 0.88,
        },
      },
      {
        selector: "edge.directed",
        style: { "target-arrow-shape": "triangle" },
      },
      {
        selector: ".selected",
        style: {
          width: 56,
          height: 56,
          "background-color": palette.accent,
          "border-width": 4,
          "border-color": palette.ink,
        },
      },
    ],
  });
  graphInstance.on("tap", 'node[kind = "person"]', (event) => emit("select", event.target.id()));
}

function fitGraph(): void {
  graphInstance?.fit(undefined, 36);
}

function resetGraph(): void {
  if (!graphInstance) return;
  graphInstance.zoom(1);
  graphInstance.center();
}

onMounted(() => void renderGraph());
onBeforeUnmount(() => graphInstance?.destroy());
watch(
  () => [props.profiles, props.relationships, props.selectedId],
  () => void renderGraph(),
  { deep: true },
);
</script>

<template>
  <div class="relationship-graph" :aria-label="t('peopleRelationshipGraph')">
    <div class="graph-tools">
      <IconButton :label="t('knowledgeFitGraph')" @click="fitGraph"><Maximize2 :size="17" /></IconButton>
      <IconButton :label="t('knowledgeResetView')" @click="resetGraph"><RotateCcw :size="17" /></IconButton>
    </div>
    <div ref="container" class="graph-canvas" role="img" :aria-label="t('peopleRelationshipGraphDescription')"></div>
  </div>
</template>

<style scoped>
.relationship-graph {
  position: relative;
  min-width: 0;
  min-height: 330px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-surface);
  background: var(--color-paper-2);
}
.graph-canvas {
  width: 100%;
  height: 330px;
}
.graph-tools {
  display: flex;
  position: absolute;
  z-index: 2;
  top: 8px;
  right: 8px;
  gap: 5px;
}
.graph-tools :deep(button) {
  border: 1px solid var(--line);
  background: var(--color-paper);
}
</style>
