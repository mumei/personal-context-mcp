/**
 * Coordinates person profiles, relationships, and append-only interaction journals.
 * Responsibility: This module validates person references and owns person-domain mutation and retrieval rules.
 * Non-responsibility: It does not infer personal information, generalize Knowledge, or send person data to an LLM.
 *
 * 人物プロフィール、人物関係、追記型の接点履歴を調整します。
 * 責務: 人物参照を検証し、人物ドメインの更新・取得ルールを担当します。
 * 非責務: 個人情報の推測、Knowledgeへの一般化、人物データのLLM送信は担当しません。
 *
 * @packageDocumentation
 */
import { randomUUID } from "node:crypto";
import type { Repository } from "#infra/repository/repository";
import type {
  PersonContact,
  PersonFact,
  PersonInteraction,
  PersonOrganization,
  PersonProfile,
  PersonRelationship,
  PersonRelationshipStatus,
  PersonSensitivity,
  SaveResult,
} from "#shared/types";

export interface UpsertPersonProfileInput {
  id: string;
  display_name: string;
  aliases?: string[];
  organizations?: PersonOrganization[];
  contacts?: PersonContact[];
  roles?: string[];
  relationship_type?: string;
  relationship_status?: PersonRelationshipStatus;
  preferred_channels?: string[];
  languages?: string[];
  timezone?: string;
  facts?: Array<Omit<PersonFact, "updated_at"> & { updated_at?: string }>;
  fact_ids_to_remove?: string[];
  notes?: string[];
  fields_to_clear?: Array<"relationship_type" | "timezone">;
  allow_duplicate?: boolean;
}

export interface FindDuplicatePeopleInput {
  person_id?: string;
  display_name?: string;
  aliases?: string[];
  organizations?: PersonOrganization[];
  contacts?: PersonContact[];
  limit?: number;
}

export interface MergePersonProfilesInput {
  target_person_id: string;
  source_person_ids: string[];
}

export interface RecordPersonInteractionInput {
  person_ids: string[];
  idempotency_key?: string;
  occurred_at?: string;
  channel?: string;
  summary: string;
  outcomes?: string[];
  follow_ups?: string[];
  task_ids?: string[];
  sensitivity?: PersonSensitivity;
}

export interface UpsertPersonRelationshipInput {
  relationship_id: string;
  from_person_id: string;
  to_person_id: string;
  type: string;
  label?: string;
  status?: PersonRelationshipStatus;
  notes?: string[];
}

export interface CapturePersonUpdateInput {
  profiles: UpsertPersonProfileInput[];
  relationships: UpsertPersonRelationshipInput[];
  interactions: Array<{ date: string; input: RecordPersonInteractionInput }>;
}

function unique(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeIdentityText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, "");
}

function canonicalContact(contact: Pick<PersonContact, "type" | "value">): string | null {
  const type = normalizeIdentityText(contact.type);
  if (!["email", "phone", "mobile", "tel", "telephone"].includes(type)) return null;
  const value = type === "email" ? contact.value.trim().toLocaleLowerCase() : contact.value.replace(/[^\d+]/g, "");
  return value ? `${type === "email" ? "email" : "phone"}:${value}` : null;
}

function organizationKey(organization: PersonOrganization): string {
  return [organization.name, organization.role ?? "", organization.department ?? ""]
    .map(normalizeIdentityText)
    .join("|");
}

function contactKey(contact: PersonContact): string {
  return (
    canonicalContact(contact) ??
    `${normalizeIdentityText(contact.type)}:${normalizeIdentityText(contact.value)}:${normalizeIdentityText(contact.label ?? "")}`
  );
}

function mergeUniqueBy<T>(primary: T[], secondary: T[], key: (value: T) => string): T[] {
  const result = new Map(primary.map((value) => [key(value), value]));
  for (const value of secondary) if (!result.has(key(value))) result.set(key(value), value);
  return [...result.values()];
}

function assertCompatibleScalar(label: string, values: Array<string | undefined>): void {
  const distinct = [
    ...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  ];
  if (distinct.length > 1) throw new Error(`Cannot merge people with conflicting ${label}: ${distinct.join(" / ")}`);
}

async function assertNoStrongDuplicate(
  repo: Repository,
  id: string,
  contacts: PersonContact[],
  allowDuplicate = false,
): Promise<void> {
  if (allowDuplicate) return;
  const strongContacts = new Set(contacts.map(canonicalContact).filter((value): value is string => value !== null));
  if (strongContacts.size === 0) return;
  const matches = (await repo.loadPersonProfiles()).filter(
    (profile) =>
      profile.id !== id &&
      !profile.deleted &&
      profile.contacts.some((contact) => {
        const key = canonicalContact(contact);
        return key !== null && strongContacts.has(key);
      }),
  );
  if (matches.length > 0) {
    throw new Error(
      `Duplicate person contact matches active profile(s): ${matches.map((profile) => profile.id).join(", ")}. Update or merge the existing profile; use allow_duplicate=true only after confirming they are different people.`,
    );
  }
}

function assertId(id: string, label: string): string {
  const normalized = id.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(normalized)) {
    throw new Error(`${label} must use lowercase letters, numbers, hyphens, or underscores.`);
  }
  return normalized;
}

function normalizeFacts(
  facts: UpsertPersonProfileInput["facts"],
  existing: PersonFact[],
  now: string,
  idsToRemove: string[] = [],
): PersonFact[] {
  const removed = new Set(idsToRemove.map((id) => assertId(id, "Person fact id")));
  const byId = new Map(existing.filter((fact) => !removed.has(fact.id)).map((fact) => [fact.id, fact]));
  for (const fact of facts ?? []) {
    const id = assertId(fact.id, "Person fact id");
    const confidence = fact.confidence;
    if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
      throw new Error(`Person fact confidence must be between 0 and 1: ${id}`);
    }
    const category = fact.category.trim();
    const value = fact.value.trim();
    if (!category || !value) throw new Error(`Person fact category and value are required: ${id}`);
    byId.set(id, {
      id,
      category,
      value,
      basis: fact.basis,
      sensitivity: fact.sensitivity,
      ...(confidence !== undefined ? { confidence } : {}),
      ...(fact.source_note?.trim() ? { source_note: fact.source_note.trim() } : {}),
      updated_at: fact.updated_at ?? now,
    });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** Creates or updates one person profile without inferring missing fields. 不明項目を推測せず人物プロフィールを作成または更新します。 */
export async function upsertPersonProfile(
  repo: Repository,
  input: UpsertPersonProfileInput,
): Promise<{ profile: PersonProfile; save: SaveResult }> {
  return repo.withTransaction(async () => {
    const id = assertId(input.id, "Person id");
    const displayName = input.display_name.trim();
    if (!displayName) throw new Error("Person display_name is required.");
    const existing = await repo.loadPersonProfile(id);
    if (existing?.merged_into)
      throw new Error(`Merged person profile must be updated through ${existing.merged_into}: ${id}`);
    const now = new Date().toISOString();
    const clear = new Set(input.fields_to_clear ?? []);
    const profile: PersonProfile = {
      id,
      display_name: displayName,
      aliases: input.aliases === undefined ? (existing?.aliases ?? []) : unique(input.aliases),
      organizations:
        input.organizations === undefined
          ? (existing?.organizations ?? [])
          : input.organizations.map((organization) => {
              const name = organization.name.trim();
              if (!name) throw new Error("Person organization name is required.");
              return {
                name,
                ...(organization.role?.trim() ? { role: organization.role.trim() } : {}),
                ...(organization.department?.trim() ? { department: organization.department.trim() } : {}),
              };
            }),
      contacts:
        input.contacts === undefined
          ? (existing?.contacts ?? [])
          : input.contacts.map((contact) => {
              const type = contact.type.trim();
              const value = contact.value.trim();
              if (!type || !value) throw new Error("Person contact type and value are required.");
              return {
                type,
                value,
                ...(contact.label?.trim() ? { label: contact.label.trim() } : {}),
                sensitivity: contact.sensitivity,
              };
            }),
      roles: input.roles === undefined ? (existing?.roles ?? []) : unique(input.roles),
      ...(!clear.has("relationship_type") && (input.relationship_type ?? existing?.relationship_type)
        ? { relationship_type: input.relationship_type?.trim() || existing?.relationship_type }
        : {}),
      relationship_status: input.relationship_status ?? existing?.relationship_status ?? "active",
      preferred_channels:
        input.preferred_channels === undefined
          ? (existing?.preferred_channels ?? [])
          : unique(input.preferred_channels),
      languages: input.languages === undefined ? (existing?.languages ?? []) : unique(input.languages),
      ...(!clear.has("timezone") && (input.timezone ?? existing?.timezone)
        ? { timezone: input.timezone?.trim() || existing?.timezone }
        : {}),
      facts: normalizeFacts(input.facts, existing?.facts ?? [], now, input.fact_ids_to_remove),
      notes: input.notes === undefined ? (existing?.notes ?? []) : unique(input.notes),
      created_at: existing?.created_at ?? now,
      updated_at: now,
      ...(existing?.deleted ? { deleted: true } : {}),
      ...(existing?.merged_from?.length ? { merged_from: existing.merged_from } : {}),
    };
    await assertNoStrongDuplicate(repo, id, profile.contacts, input.allow_duplicate);
    const save = await repo.savePersonProfile(profile, existing ? "update-person-profile" : "create-person-profile");
    return { profile, save };
  });
}

/** Finds possible duplicate profiles without merging them. 統合せずに重複人物候補と一致理由を検索します。 */
export async function findDuplicatePersonProfiles(
  repo: Repository,
  input: FindDuplicatePeopleInput,
): Promise<{
  count: number;
  candidates: Array<{ profile: PersonProfile; score: number; reasons: string[]; strong_match: boolean }>;
}> {
  const source = input.person_id ? await repo.loadPersonProfile(assertId(input.person_id, "Person id")) : null;
  if (input.person_id && !source) throw new Error(`Person not found: ${input.person_id}`);
  const displayName = input.display_name ?? source?.display_name ?? "";
  const aliases = input.aliases ?? source?.aliases ?? [];
  const organizations = input.organizations ?? source?.organizations ?? [];
  const contacts = input.contacts ?? source?.contacts ?? [];
  if (!displayName.trim() && aliases.length === 0 && organizations.length === 0 && contacts.length === 0) {
    throw new Error("Duplicate search requires person_id or identity fields.");
  }
  const names = new Set([displayName, ...aliases].map(normalizeIdentityText).filter(Boolean));
  const organizationNames = new Set(organizations.map((item) => normalizeIdentityText(item.name)).filter(Boolean));
  const strongContacts = new Set(contacts.map(canonicalContact).filter((value): value is string => value !== null));
  const candidates = (await repo.loadPersonProfiles())
    .filter((profile) => !profile.deleted && profile.id !== source?.id)
    .map((profile) => {
      const reasons: string[] = [];
      let score = 0;
      const profileContacts = profile.contacts.map(canonicalContact).filter((value): value is string => value !== null);
      const contactMatch = profileContacts.some((value) => strongContacts.has(value));
      if (contactMatch) {
        score += 100;
        reasons.push("exact strong contact");
      }
      const profileNames = [profile.display_name, ...profile.aliases].map(normalizeIdentityText);
      if (profileNames.some((value) => value && names.has(value))) {
        score += 40;
        reasons.push("matching name or alias");
      }
      if (profile.organizations.some((item) => organizationNames.has(normalizeIdentityText(item.name)))) {
        score += 15;
        reasons.push("shared organization");
      }
      return { profile, score, reasons, strong_match: contactMatch };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.profile.id.localeCompare(right.profile.id))
    .slice(0, Math.max(1, Math.min(100, input.limit ?? 20)));
  return { count: candidates.length, candidates };
}

/** Lists person profiles with local text filtering. ローカル文字列検索で人物プロフィールを一覧します。 */
export async function listPersonProfiles(
  repo: Repository,
  input: { query?: string; relationship_status?: PersonRelationshipStatus; include_deleted?: boolean } = {},
): Promise<{ count: number; profiles: PersonProfile[] }> {
  const query = input.query?.trim().toLocaleLowerCase();
  const profiles = (await repo.loadPersonProfiles())
    .filter((profile) => input.include_deleted || !profile.deleted)
    .filter((profile) => !input.relationship_status || profile.relationship_status === input.relationship_status)
    .filter((profile) => {
      if (!query) return true;
      const searchable = [
        profile.id,
        profile.display_name,
        ...profile.aliases,
        ...profile.roles,
        ...profile.contacts.flatMap((item) => [item.type, item.value, item.label ?? ""]),
        ...profile.organizations.flatMap((item) => [item.name, item.role ?? "", item.department ?? ""]),
        ...profile.facts.flatMap((fact) => [fact.category, fact.value]),
      ];
      return searchable.some((value) => value.toLocaleLowerCase().includes(query));
    })
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  return { count: profiles.length, profiles };
}

/** Lists bounded person interaction history, newest first. 人物の接点履歴を件数制限付きで新しい順に一覧します。 */
export async function listPersonInteractions(
  repo: Repository,
  input: { person_id?: string; date?: string; limit?: number } = {},
): Promise<{ count: number; interactions: PersonInteraction[] }> {
  if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error("Person interaction date must use YYYY-MM-DD format.");
  }
  const mergedIds = new Set<string>();
  if (input.person_id) {
    mergedIds.add(input.person_id);
    for (const profile of await repo.loadPersonProfiles()) {
      if (profile.merged_into === input.person_id) mergedIds.add(profile.id);
    }
    const profile = await repo.loadPersonProfile(input.person_id);
    for (const id of profile?.merged_from ?? []) mergedIds.add(id);
  }
  const dates = input.date ? [input.date] : (await repo.listPersonInteractionDates()).slice(-90);
  const interactions = (
    await Promise.all(dates.map(async (date) => (await repo.loadPersonInteractions(date)).interactions))
  )
    .flat()
    .filter((interaction) => !input.person_id || interaction.person_ids.some((id) => mergedIds.has(id)))
    .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
    .slice(0, Math.max(1, Math.min(500, input.limit ?? 50)));
  return { count: interactions.length, interactions };
}

/** Merges duplicate profiles while preserving immutable interaction journals. 追記型接点履歴を保持して重複人物を統合します。 */
export async function mergePersonProfiles(
  repo: Repository,
  input: MergePersonProfilesInput,
): Promise<{
  profile: PersonProfile;
  merged_sources: PersonProfile[];
  relationship_count: number;
  linked_interaction_count: number;
  saves: SaveResult[];
}> {
  return repo.withTransaction(async () => {
    const targetId = assertId(input.target_person_id, "Target person id");
    const sourceIds = unique(input.source_person_ids).map((id) => assertId(id, "Source person id"));
    if (sourceIds.length === 0) throw new Error("At least one source_person_id is required.");
    if (sourceIds.includes(targetId)) throw new Error("A source person cannot also be the merge target.");
    const target = await repo.loadPersonProfile(targetId);
    if (!target || target.deleted) throw new Error(`Unknown active target person: ${targetId}`);
    const sources: PersonProfile[] = [];
    for (const id of sourceIds) {
      const source = await repo.loadPersonProfile(id);
      if (!source || source.deleted) throw new Error(`Unknown active source person: ${id}`);
      sources.push(source);
    }
    assertCompatibleScalar("relationship_type", [
      target.relationship_type,
      ...sources.map((item) => item.relationship_type),
    ]);
    assertCompatibleScalar("timezone", [target.timezone, ...sources.map((item) => item.timezone)]);
    const factById = new Map(target.facts.map((fact) => [fact.id, fact]));
    for (const source of sources) {
      for (const fact of source.facts) {
        const existing = factById.get(fact.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(fact)) {
          throw new Error(`Cannot merge people with conflicting fact id: ${fact.id}`);
        }
        if (!existing) factById.set(fact.id, fact);
      }
    }
    const now = new Date().toISOString();
    let merged = target;
    for (const source of sources) {
      merged = {
        ...merged,
        aliases: unique([...merged.aliases, source.display_name, ...source.aliases]),
        organizations: mergeUniqueBy(merged.organizations, source.organizations, organizationKey),
        contacts: mergeUniqueBy(merged.contacts, source.contacts, contactKey),
        roles: unique([...merged.roles, ...source.roles]),
        preferred_channels: unique([...merged.preferred_channels, ...source.preferred_channels]),
        languages: unique([...merged.languages, ...source.languages]),
        notes: unique([...merged.notes, ...source.notes]),
        merged_from: unique([...(merged.merged_from ?? []), source.id, ...(source.merged_from ?? [])]),
      };
    }
    merged = { ...merged, facts: [...factById.values()].sort((a, b) => a.id.localeCompare(b.id)), updated_at: now };

    const sourceSet = new Set(sourceIds);
    const relationships = await repo.loadPersonRelationships();
    const rewritten = relationships.relationships
      .map((relationship) => ({
        ...relationship,
        from_person_id: sourceSet.has(relationship.from_person_id) ? targetId : relationship.from_person_id,
        to_person_id: sourceSet.has(relationship.to_person_id) ? targetId : relationship.to_person_id,
        updated_at:
          sourceSet.has(relationship.from_person_id) || sourceSet.has(relationship.to_person_id)
            ? now
            : relationship.updated_at,
      }))
      .filter((relationship) => relationship.from_person_id !== relationship.to_person_id);
    const relationshipByKey = new Map<string, PersonRelationship>();
    for (const relationship of rewritten) {
      const key = [
        relationship.from_person_id,
        relationship.to_person_id,
        relationship.type,
        relationship.label ?? "",
        relationship.status,
      ].join("|");
      const existing = relationshipByKey.get(key);
      relationshipByKey.set(
        key,
        existing
          ? { ...existing, notes: unique([...existing.notes, ...relationship.notes]), updated_at: now }
          : relationship,
      );
    }
    relationships.relationships = [...relationshipByKey.values()].sort((a, b) => a.id.localeCompare(b.id));

    const saves: SaveResult[] = [];
    saves.push(await repo.savePersonProfile(merged, "merge-person-profile-target"));
    saves.push(await repo.savePersonRelationships(relationships, "merge-person-profile-relationships"));
    for (const source of sources) {
      saves.push(
        await repo.savePersonProfile(
          { ...source, deleted: true, merged_into: targetId, merged_at: now, updated_at: now },
          "merge-person-profile-source",
        ),
      );
    }
    const interactions = await listPersonInteractions(repo, { person_id: targetId, limit: 500 });
    return {
      profile: merged,
      merged_sources: sources.map((source) => ({
        ...source,
        deleted: true,
        merged_into: targetId,
        merged_at: now,
        updated_at: now,
      })),
      relationship_count: relationships.relationships.filter(
        (relationship) => relationship.from_person_id === targetId || relationship.to_person_id === targetId,
      ).length,
      linked_interaction_count: interactions.count,
      saves,
    };
  });
}

/** Gets one profile with its relationships and recent interactions. 人物プロフィールを関係・最近の接点履歴と共に取得します。 */
export async function getPersonProfile(
  repo: Repository,
  id: string,
  input: { include_deleted?: boolean; interaction_limit?: number } = {},
): Promise<{
  profile: PersonProfile;
  relationships: PersonRelationship[];
  interactions: PersonInteraction[];
}> {
  const profile = await repo.loadPersonProfile(id);
  if (!profile || (profile.deleted && !input.include_deleted)) throw new Error(`Person not found: ${id}`);
  const relationships = (await repo.loadPersonRelationships()).relationships.filter(
    (relationship) => relationship.from_person_id === id || relationship.to_person_id === id,
  );
  const interactions = (await listPersonInteractions(repo, { person_id: id, limit: input.interaction_limit ?? 30 }))
    .interactions;
  return { profile, relationships, interactions };
}

/** Appends one immutable person interaction after validating every person reference. 全人物参照を検証して不変の接点履歴を1件追記します。 */
export async function recordPersonInteraction(
  repo: Repository,
  date: string,
  input: RecordPersonInteractionInput,
  now = new Date(),
): Promise<{ date: string; interaction: PersonInteraction; save: SaveResult }> {
  const personIds = unique(input.person_ids);
  if (personIds.length === 0) throw new Error("At least one person_id is required.");
  const summary = input.summary.trim();
  if (!summary) throw new Error("Interaction summary is required.");
  const occurredAt = input.occurred_at ?? now.toISOString();
  if (Number.isNaN(new Date(occurredAt).getTime())) throw new Error(`Invalid occurred_at: ${occurredAt}`);
  return repo.withTransaction(async () => {
    for (const id of personIds) {
      const person = await repo.loadPersonProfile(id);
      if (person?.merged_into)
        throw new Error(`Merged person_id must be replaced with canonical id ${person.merged_into}: ${id}`);
      if (!person || person.deleted) throw new Error(`Unknown active person_id: ${id}`);
    }
    const document = await repo.loadPersonInteractions(date);
    const duplicate = input.idempotency_key
      ? document.interactions.find((item) => item.idempotency_key === input.idempotency_key)
      : undefined;
    if (duplicate) {
      return {
        date,
        interaction: duplicate,
        save: { changed: false, path: repo.layoutPath("people", "interactions", `${date}.yaml`) },
      };
    }
    const interaction: PersonInteraction = {
      interaction_id: randomUUID(),
      ...(input.idempotency_key ? { idempotency_key: input.idempotency_key } : {}),
      person_ids: personIds,
      occurred_at: occurredAt,
      recorded_at: now.toISOString(),
      ...(input.channel?.trim() ? { channel: input.channel.trim() } : {}),
      summary,
      outcomes: unique(input.outcomes),
      follow_ups: unique(input.follow_ups),
      task_ids: unique(input.task_ids),
      sensitivity: input.sensitivity ?? "private",
    };
    document.interactions.push(interaction);
    const save = await repo.savePersonInteractions(date, document, "append-person-interaction");
    return { date, interaction, save };
  });
}

/** Creates or completely updates one typed relationship between two people. 2人間の型付き関係を作成または完全更新します。 */
export async function upsertPersonRelationship(
  repo: Repository,
  input: UpsertPersonRelationshipInput,
): Promise<{ relationship: PersonRelationship; save: SaveResult }> {
  const id = assertId(input.relationship_id, "Relationship id");
  const fromId = assertId(input.from_person_id, "from_person_id");
  const toId = assertId(input.to_person_id, "to_person_id");
  if (fromId === toId) throw new Error("A person relationship requires two different people.");
  return repo.withTransaction(async () => {
    for (const personId of [fromId, toId]) {
      const person = await repo.loadPersonProfile(personId);
      if (person?.merged_into) {
        throw new Error(`Merged person_id must be replaced with canonical id ${person.merged_into}: ${personId}`);
      }
      if (!person || person.deleted) throw new Error(`Unknown active person_id: ${personId}`);
    }
    const document = await repo.loadPersonRelationships();
    const existing = document.relationships.find((relationship) => relationship.id === id);
    const now = new Date().toISOString();
    const type = input.type.trim();
    if (!type) throw new Error("Person relationship type is required.");
    const relationship: PersonRelationship = {
      id,
      from_person_id: fromId,
      to_person_id: toId,
      type,
      ...(input.label?.trim() ? { label: input.label.trim() } : {}),
      status: input.status ?? "active",
      notes: unique(input.notes),
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    document.relationships = [...document.relationships.filter((item) => item.id !== id), relationship].sort(
      (left, right) => left.id.localeCompare(right.id),
    );
    const save = await repo.savePersonRelationships(
      document,
      existing ? "update-person-relationship" : "create-person-relationship",
    );
    return { relationship, save };
  });
}

/** Atomically captures profiles, typed relationships, and dated interactions. 人物・関係・接点を1トランザクションで記録します。 */
export async function capturePersonUpdate(
  repo: Repository,
  input: CapturePersonUpdateInput,
): Promise<{
  profiles: Array<Awaited<ReturnType<typeof upsertPersonProfile>>>;
  relationships: Array<Awaited<ReturnType<typeof upsertPersonRelationship>>>;
  interactions: Array<Awaited<ReturnType<typeof recordPersonInteraction>>>;
}> {
  return repo.withTransaction(async () => {
    const profiles = [];
    for (const profile of input.profiles) profiles.push(await upsertPersonProfile(repo, profile));
    const relationships = [];
    for (const relationship of input.relationships) {
      relationships.push(await upsertPersonRelationship(repo, relationship));
    }
    const interactions = [];
    for (const interaction of input.interactions) {
      interactions.push(await recordPersonInteraction(repo, interaction.date, interaction.input));
    }
    return { profiles, relationships, interactions };
  });
}

/** Changes a person's logical-deletion state without deleting history. 履歴を削除せず人物の論理削除状態を変更します。 */
export async function setPersonDeleted(
  repo: Repository,
  id: string,
  deleted: boolean,
): Promise<{ profile: PersonProfile; save: SaveResult }> {
  return repo.withTransaction(async () => {
    const profile = await repo.loadPersonProfile(id);
    if (!profile) throw new Error(`Person not found: ${id}`);
    if (!deleted && profile.merged_into) {
      throw new Error(
        `Merged person profile cannot be restored independently; canonical profile: ${profile.merged_into}`,
      );
    }
    const updated: PersonProfile = {
      ...profile,
      updated_at: new Date().toISOString(),
      ...(deleted ? { deleted: true } : {}),
    };
    if (!deleted) delete updated.deleted;
    const save = await repo.savePersonProfile(updated, deleted ? "delete-person-profile" : "restore-person-profile");
    return { profile: updated, save };
  });
}
