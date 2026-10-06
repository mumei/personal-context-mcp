<script setup lang="ts">
import { Building2, Clock3, MessageSquareText, ShieldCheck, UserRoundSearch, UsersRound } from "@lucide/vue";
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import EmptyState from "#webUi/components/atoms/EmptyState.vue";
import PersonRelationshipGraph from "#webUi/components/organisms/PersonRelationshipGraph.vue";
import { usePeople } from "#webUi/composables/people/usePeople";
import { useLocale } from "#webUi/composables/useLocale";
import type { PersonRelationship } from "#webUi/types/api";

const route = useRoute();
const { t } = useLocale();
const { profiles, detail, query, status, loading, error, loadProfiles, loadDetail, applyFilters, selectPerson } =
  usePeople();
const selectedId = computed(() => (typeof route.params.personId === "string" ? route.params.personId : ""));

onMounted(async () => {
  await Promise.all([loadProfiles(), loadDetail(selectedId.value || undefined)]);
});

function organization(profile: (typeof profiles.value.profiles)[number]): string {
  const item = profile.organizations[0];
  return item ? [item.name, item.role].filter(Boolean).join(" · ") : t("peopleNoOrganization");
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function personName(personId: string): string {
  return profiles.value.profiles.find((profile) => profile.id === personId)?.display_name || personId;
}

function relatedPersonId(relationship: PersonRelationship): string {
  return relationship.from_person_id === detail.value?.profile.id
    ? relationship.to_person_id
    : relationship.from_person_id;
}

function relationshipType(relationship: PersonRelationship): string {
  if (relationship.type === "client" && relationship.to_person_id === detail.value?.profile.id) {
    return t("peopleRelationship_clientInverse");
  }
  const knownTypes: Record<string, string> = {
    client: t("peopleRelationship_client"),
    colleague: t("peopleRelationship_colleague"),
  };
  return knownTypes[relationship.type] || relationship.type;
}
</script>

<template>
  <div class="people-page">
    <section class="privacy-notice">
      <ShieldCheck :size="19" />
      <div>
        <strong>{{ t("peopleLocalOnly") }}</strong
        ><span>{{ t("peopleLocalOnlyDescription") }}</span>
      </div>
    </section>
    <form class="people-filters" role="search" @submit.prevent="applyFilters">
      <label>
        <span>{{ t("peopleSearch") }}</span>
        <input v-model="query" type="search" :placeholder="t('peopleSearchPlaceholder')" />
      </label>
      <label>
        <span>{{ t("peopleRelationshipStatus") }}</span>
        <select v-model="status">
          <option value="all">{{ t("all") }}</option>
          <option value="active">{{ t("peopleActive") }}</option>
          <option value="inactive">{{ t("peopleInactive") }}</option>
        </select>
      </label>
      <button type="submit">{{ t("knowledgeApplyFilters") }}</button>
    </form>
    <p v-if="error" class="people-error" role="alert">{{ error }}</p>
    <div class="people-workspace">
      <section class="people-list" :aria-label="t('peopleList')">
        <header>
          <UsersRound :size="18" /><strong>{{ t("peopleList") }}</strong
          ><span>{{ profiles.count }}</span>
        </header>
        <EmptyState v-if="!loading && !profiles.profiles.length" :message="t('peopleEmpty')" />
        <button
          v-for="profile in profiles.profiles"
          :key="profile.id"
          type="button"
          :class="{ selected: selectedId === profile.id }"
          @click="selectPerson(profile.id)"
        >
          <strong>{{ profile.display_name }}</strong>
          <span>{{ organization(profile) }}</span>
          <small
            >{{ profile.relationship_type || t("peopleRelationshipUnset") }} ·
            {{ t(`people_${profile.relationship_status}`) }}</small
          >
        </button>
      </section>
      <section v-if="detail" class="person-detail">
        <header class="person-heading">
          <div>
            <p>{{ detail.profile.id }}</p>
            <h2>{{ detail.profile.display_name }}</h2>
            <span>{{ organization(detail.profile) }}</span>
            <small class="person-updated"
              >{{ t("peopleLastUpdated") }}: {{ formatTime(detail.profile.updated_at) }}</small
            >
          </div>
          <span class="status">{{ t(`people_${detail.profile.relationship_status}`) }}</span>
        </header>

        <div class="detail-grid">
          <section class="profile-section">
            <h3><UserRoundSearch :size="17" />{{ t("peopleProfile") }}</h3>
            <dl class="profile-fields">
              <div>
                <dt>{{ t("peopleRelationshipType") }}</dt>
                <dd>{{ detail.profile.relationship_type || "-" }}</dd>
              </div>
              <div>
                <dt>{{ t("peopleContacts") }}</dt>
                <dd>{{ detail.profile.contacts.map((item) => `${item.type}: ${item.value}`).join(", ") || "-" }}</dd>
              </div>
              <div>
                <dt>{{ t("peoplePreferredChannels") }}</dt>
                <dd>{{ detail.profile.preferred_channels.join(", ") || "-" }}</dd>
              </div>
              <div>
                <dt>{{ t("peopleLanguages") }}</dt>
                <dd>{{ detail.profile.languages.join(", ") || "-" }}</dd>
              </div>
              <div>
                <dt>{{ t("peopleTimezone") }}</dt>
                <dd>{{ detail.profile.timezone || "-" }}</dd>
              </div>
              <div>
                <dt>{{ t("peopleAliases") }}</dt>
                <dd>{{ detail.profile.aliases.join(", ") || "-" }}</dd>
              </div>
              <div v-if="detail.profile.merged_from?.length">
                <dt>{{ t("peopleMergedFrom") }}</dt>
                <dd>{{ detail.profile.merged_from.join(", ") }}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h3><ShieldCheck :size="17" />{{ t("peopleFacts") }}</h3>
            <p v-if="!detail.profile.facts.length" class="muted">{{ t("peopleNoFacts") }}</p>
            <ul v-else class="fact-list">
              <li v-for="fact in detail.profile.facts" :key="fact.id">
                <div>
                  <strong>{{ fact.category }}</strong
                  ><span :class="['basis', fact.basis]">{{ t(`peopleBasis_${fact.basis}`) }}</span>
                </div>
                <p>{{ fact.value }}</p>
                <small v-if="fact.confidence !== undefined"
                  >{{ t("peopleConfidence") }}: {{ Math.round(fact.confidence * 100) }}%</small
                >
                <small v-if="fact.source_note">{{ t("peopleSource") }}: {{ fact.source_note }}</small>
              </li>
            </ul>
          </section>

          <section class="relationships-section">
            <h3><Building2 :size="17" />{{ t("peopleRelationships") }}</h3>
            <p v-if="!detail.relationships.length" class="muted">{{ t("peopleNoRelationships") }}</p>
            <template v-else>
              <PersonRelationshipGraph
                :profiles="profiles.profiles"
                :relationships="detail.relationships"
                :selected-id="detail.profile.id"
                @select="selectPerson"
              />
              <h4>{{ t("peopleRelationshipDetails") }}</h4>
              <ul class="relation-list">
                <li v-for="relationship in detail.relationships" :key="relationship.id">
                  <div class="relation-heading">
                    <strong>{{ personName(relatedPersonId(relationship)) }}</strong>
                    <span class="relation-type">{{ relationshipType(relationship) }}</span>
                  </div>
                  <p v-if="relationship.label">{{ relationship.label }}</p>
                  <ul v-if="relationship.notes.length" class="relation-notes">
                    <li v-for="(note, index) in relationship.notes" :key="index">{{ note }}</li>
                  </ul>
                </li>
              </ul>
            </template>
          </section>

          <section class="interactions">
            <h3><MessageSquareText :size="17" />{{ t("peopleInteractions") }}</h3>
            <p v-if="!detail.interactions.length" class="muted">{{ t("peopleNoInteractions") }}</p>
            <ol v-else>
              <li v-for="interaction in detail.interactions" :key="interaction.interaction_id">
                <div class="interaction-time">
                  <Clock3 :size="14" />{{ formatTime(interaction.occurred_at)
                  }}<span v-if="interaction.channel">{{ interaction.channel }}</span>
                </div>
                <strong>{{ interaction.summary }}</strong>
                <p v-if="interaction.outcomes.length">
                  {{ t("peopleOutcomes") }}: {{ interaction.outcomes.join(" / ") }}
                </p>
                <p v-if="interaction.follow_ups.length">
                  {{ t("peopleFollowUps") }}: {{ interaction.follow_ups.join(" / ") }}
                </p>
              </li>
            </ol>
          </section>
        </div>
      </section>
      <section v-else class="person-placeholder">
        <UserRoundSearch :size="30" />
        <p>{{ t("peopleSelectPerson") }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.people-page {
  display: grid;
  gap: var(--space-xs);
}
.privacy-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 13px;
  border: 1px solid var(--color-success-rule, var(--line));
  border-radius: var(--radius-control);
  color: var(--color-success, #19715d);
  background: var(--color-success-soft, #eef8f4);
}
.privacy-notice div {
  display: grid;
  gap: 2px;
}
.privacy-notice span {
  color: var(--muted);
  font-size: 12px;
}
.people-filters {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(150px, 220px) auto;
  align-items: end;
  gap: 9px;
  padding: 12px;
  border: 1px solid var(--line);
  background: var(--surface);
}
.people-filters label {
  display: grid;
  gap: 5px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
}
.people-filters input,
.people-filters select {
  min-height: var(--control-height);
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.people-filters button {
  min-height: var(--control-height);
  padding: 7px 13px;
  border: 0;
  border-radius: var(--radius-control);
  color: white;
  background: var(--color-accent);
  font-weight: 700;
}
.people-workspace {
  display: grid;
  min-height: 560px;
  grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
  gap: var(--space-xs);
}
.people-list,
.person-detail,
.person-placeholder {
  border: 1px solid var(--line);
  background: var(--surface);
}
.people-list {
  overflow-y: auto;
}
.people-list > header {
  display: flex;
  position: sticky;
  top: 0;
  z-index: 1;
  align-items: center;
  gap: 7px;
  padding: 11px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.people-list > header span {
  margin-left: auto;
  color: var(--muted);
}
.people-list > button {
  display: grid;
  width: 100%;
  gap: 4px;
  padding: 12px;
  text-align: left;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
}
.people-list > button:hover,
.people-list > button.selected {
  background: var(--color-accent-soft);
}
.people-list > button span,
.people-list > button small {
  color: var(--muted);
}
.person-detail {
  min-width: 0;
  container-type: inline-size;
}
.person-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px;
  border-bottom: 1px solid var(--line);
}
.person-heading p,
.person-heading h2,
.person-heading span {
  margin: 0;
}
.person-heading p {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
}
.person-heading h2 {
  margin-block: 4px;
  font-size: 22px;
}
.person-heading > div > span {
  color: var(--muted);
}
.person-updated {
  display: block;
  margin-top: 5px;
  color: var(--muted);
  font-size: 11px;
}
.status,
.basis {
  padding: 3px 7px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.detail-grid > section {
  min-width: 0;
  padding: 17px;
  border-bottom: 1px solid var(--line);
}
.detail-grid > section:nth-child(odd) {
  border-right: 1px solid var(--line);
}
.detail-grid > .profile-section {
  grid-column: 1 / -1;
  border-right: 0;
}
.detail-grid > .relationships-section {
  grid-column: 1 / -1;
  border-right: 0;
}
.detail-grid h3 {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 12px;
  font-size: 14px;
}
.profile-fields {
  display: grid;
  gap: 8px;
  margin: 0;
}
.profile-fields div {
  display: grid;
  grid-template-columns: minmax(100px, 35%) minmax(0, 1fr);
  gap: 8px;
}
.profile-fields dt {
  color: var(--muted);
  font-size: 12px;
}
.profile-fields dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.fact-list,
.relation-list,
.interactions ol {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.fact-list li,
.relation-list li,
.interactions li {
  padding: 10px;
  border-left: 3px solid var(--line-strong, var(--line));
  background: var(--color-paper-2);
}
.fact-list li > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.fact-list p,
.fact-list small,
.relation-list p,
.interactions p {
  display: block;
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: 12px;
}
.relation-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
}
.relationships-section h4 {
  margin: 15px 0 8px;
  font-size: 12px;
}
.relation-type {
  padding: 2px 6px;
  color: var(--color-accent);
  border: 1px solid var(--color-success-rule);
  border-radius: 3px;
  background: var(--color-accent-soft);
  font-size: 11px;
  font-weight: 700;
}
.relation-notes {
  display: grid;
  gap: 3px;
  margin: 7px 0 0;
  padding-left: 18px;
  color: var(--muted);
  font-size: 12px;
}
.relation-notes > li {
  padding: 0;
  border: 0;
  background: transparent;
}
.basis.confirmed {
  color: var(--color-success, #19715d);
}
.basis.inferred {
  color: var(--color-warning, #8a5a00);
}
.interactions {
  grid-column: 1 / -1;
  border-right: 0 !important;
}
@container (max-width: 620px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
  .detail-grid > section,
  .detail-grid > section:nth-child(odd),
  .detail-grid > .profile-section {
    grid-column: auto;
    border-right: 0;
  }
  .interactions {
    grid-column: auto;
  }
  .profile-fields div {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
.interaction-time {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
  color: var(--muted);
  font-size: 11px;
}
.interaction-time span {
  padding: 2px 5px;
  border: 1px solid var(--line);
  border-radius: 3px;
}
.person-placeholder {
  display: grid;
  min-height: 360px;
  place-content: center;
  justify-items: center;
  color: var(--muted);
}
.people-error {
  margin: 0;
  color: var(--danger);
}
.muted {
  color: var(--muted);
}
@media (max-width: 760px) {
  .people-filters,
  .people-workspace,
  .detail-grid {
    grid-template-columns: 1fr;
  }
  .people-workspace {
    min-height: 0;
  }
  .people-list {
    max-height: 300px;
  }
  .detail-grid > section,
  .detail-grid > section:nth-child(odd) {
    border-right: 0;
  }
  .interactions {
    grid-column: auto;
  }
}
</style>
