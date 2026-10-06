import { describe, expect, it } from "vitest";
import {
  capturePersonUpdate,
  findDuplicatePersonProfiles,
  getPersonProfile,
  listPersonInteractions,
  listPersonProfiles,
  mergePersonProfiles,
  recordPersonInteraction,
  setPersonDeleted,
  upsertPersonProfile,
  upsertPersonRelationship,
} from "#domain/people/actions";
import { createTempRepo } from "./helpers.ts";

describe("People domain", () => {
  it("captures profiles, relationships, and interactions atomically", async () => {
    const { repo } = await createTempRepo();
    const result = await capturePersonUpdate(repo, {
      profiles: [
        { id: "person-1", display_name: "Person 1" },
        { id: "person-2", display_name: "Person 2" },
      ],
      relationships: [
        {
          relationship_id: "person-1-to-person-2",
          from_person_id: "person-1",
          to_person_id: "person-2",
          type: "colleague",
        },
      ],
      interactions: [
        {
          date: "2026-08-13",
          input: {
            person_ids: ["person-1", "person-2"],
            idempotency_key: "people-capture-test",
            summary: "Discussed the implementation",
          },
        },
      ],
    });

    expect(result).toMatchObject({
      profiles: [{ profile: { id: "person-1" } }, { profile: { id: "person-2" } }],
      relationships: [{ relationship: { id: "person-1-to-person-2" } }],
      interactions: [{ interaction: { summary: "Discussed the implementation" } }],
    });
    await expect(getPersonProfile(repo, "person-2")).resolves.toMatchObject({
      relationships: [{ id: "person-1-to-person-2" }],
      interactions: [{ summary: "Discussed the implementation" }],
    });

    await expect(
      capturePersonUpdate(repo, {
        profiles: [{ id: "rolled-back", display_name: "Rolled Back" }],
        relationships: [
          {
            relationship_id: "invalid-reference",
            from_person_id: "rolled-back",
            to_person_id: "missing-person",
            type: "client",
          },
        ],
        interactions: [],
      }),
    ).rejects.toThrow("Unknown active person_id");
    expect(await repo.loadPersonProfile("rolled-back")).toBeNull();
  });

  it("stores profiles separately and preserves fact provenance while updating", async () => {
    const { repo } = await createTempRepo();
    await upsertPersonProfile(repo, {
      id: "tanaka-taro",
      display_name: "田中 太郎",
      organizations: [{ name: "Example Inc.", role: "開発責任者" }],
      contacts: [{ type: "email", value: "tanaka@example.com", sensitivity: "sensitive" }],
      relationship_type: "client",
      preferred_channels: ["Slack", "Slack"],
      facts: [
        {
          id: "communication-style",
          category: "communication",
          value: "技術的な根拠を重視する可能性がある",
          basis: "inferred",
          sensitivity: "private",
          confidence: 0.6,
        },
      ],
    });
    await upsertPersonProfile(repo, {
      id: "tanaka-taro",
      display_name: "田中 太郎",
      roles: ["decision-maker"],
    });

    const result = await getPersonProfile(repo, "tanaka-taro");
    expect(result.profile).toMatchObject({
      id: "tanaka-taro",
      relationship_type: "client",
      preferred_channels: ["Slack"],
      roles: ["decision-maker"],
      facts: [{ id: "communication-style", basis: "inferred", confidence: 0.6 }],
      contacts: [{ type: "email", value: "tanaka@example.com", sensitivity: "sensitive" }],
    });
    await expect(listPersonProfiles(repo, { query: "Example" })).resolves.toMatchObject({ count: 1 });

    await upsertPersonProfile(repo, {
      id: "tanaka-taro",
      display_name: "田中 太郎",
      fact_ids_to_remove: ["communication-style"],
    });
    expect((await getPersonProfile(repo, "tanaka-taro")).profile.facts).toEqual([]);
  });

  it("records idempotent append-only interactions and typed relationships", async () => {
    const { repo } = await createTempRepo();
    for (const [id, name] of [
      ["tanaka-taro", "田中 太郎"],
      ["suzuki-hanako", "鈴木 花子"],
    ]) {
      await upsertPersonProfile(repo, { id, display_name: name });
    }
    await upsertPersonRelationship(repo, {
      relationship_id: "tanaka-manager-suzuki",
      from_person_id: "tanaka-taro",
      to_person_id: "suzuki-hanako",
      type: "manager_of",
      notes: ["同じ提案チーム"],
    });
    const input = {
      person_ids: ["tanaka-taro", "suzuki-hanako"],
      idempotency_key: "meeting-2026-08-12",
      occurred_at: "2026-08-12T10:00:00.000Z",
      channel: "meeting",
      summary: "導入条件を確認した",
      outcomes: ["運用負荷を整理する"],
      follow_ups: ["次回資料を送る"],
      task_ids: ["proposal-task"],
    };
    const first = await recordPersonInteraction(repo, "2026-08-12", input);
    const retry = await recordPersonInteraction(repo, "2026-08-12", input);

    expect(first.save.changed).toBe(true);
    expect(retry.save.changed).toBe(false);
    await expect(listPersonInteractions(repo, { person_id: "tanaka-taro" })).resolves.toMatchObject({
      count: 1,
      interactions: [{ summary: "導入条件を確認した", sensitivity: "private" }],
    });
    await expect(getPersonProfile(repo, "tanaka-taro")).resolves.toMatchObject({
      relationships: [{ id: "tanaka-manager-suzuki", type: "manager_of" }],
      interactions: [{ interaction_id: first.interaction.interaction_id }],
    });
  });

  it("logically deletes a profile without deleting interaction history", async () => {
    const { repo } = await createTempRepo();
    await upsertPersonProfile(repo, { id: "person-1", display_name: "Person 1" });
    await recordPersonInteraction(repo, "2026-08-12", {
      person_ids: ["person-1"],
      summary: "Recorded interaction",
    });
    await setPersonDeleted(repo, "person-1", true);

    await expect(getPersonProfile(repo, "person-1")).rejects.toThrow("Person not found");
    await expect(getPersonProfile(repo, "person-1", { include_deleted: true })).resolves.toMatchObject({
      profile: { deleted: true },
      interactions: [{ summary: "Recorded interaction" }],
    });
    await expect(listPersonProfiles(repo)).resolves.toMatchObject({ count: 0 });

    await setPersonDeleted(repo, "person-1", false);
    const restored = await getPersonProfile(repo, "person-1");
    expect(restored.profile.deleted).toBeUndefined();
  });

  it("finds duplicate candidates and rejects strong contact reuse by default", async () => {
    const { repo } = await createTempRepo();
    await upsertPersonProfile(repo, {
      id: "canonical-person",
      display_name: "田中 太郎",
      aliases: ["田中さん"],
      organizations: [{ name: "RhoCo" }],
      contacts: [{ type: "email", value: "contact@example.com", sensitivity: "sensitive" }],
    });

    await expect(
      findDuplicatePersonProfiles(repo, {
        display_name: "田中さん",
        organizations: [{ name: "RhoCo" }],
        contacts: [{ type: "email", value: "CONTACT@EXAMPLE.COM", sensitivity: "sensitive" }],
      }),
    ).resolves.toMatchObject({
      count: 1,
      candidates: [
        {
          profile: { id: "canonical-person" },
          score: 155,
          strong_match: true,
          reasons: ["exact strong contact", "matching name or alias", "shared organization"],
        },
      ],
    });
    await expect(
      upsertPersonProfile(repo, {
        id: "duplicate-person",
        display_name: "別の田中太郎",
        contacts: [{ type: "email", value: "contact@example.com", sensitivity: "sensitive" }],
      }),
    ).rejects.toThrow("Duplicate person contact matches active profile(s): canonical-person");
    await expect(
      upsertPersonProfile(repo, {
        id: "confirmed-distinct-person",
        display_name: "同じ共有メールを使う別人",
        contacts: [{ type: "email", value: "contact@example.com", sensitivity: "sensitive" }],
        allow_duplicate: true,
      }),
    ).resolves.toMatchObject({ profile: { id: "confirmed-distinct-person" } });
  });

  it("merges confirmed duplicates while preserving immutable interaction journals", async () => {
    const { repo } = await createTempRepo();
    await upsertPersonProfile(repo, {
      id: "canonical-person",
      display_name: "田中 太郎",
      contacts: [{ type: "email", value: "contact@example.com", sensitivity: "sensitive" }],
      notes: ["代表プロフィール"],
    });
    await upsertPersonProfile(repo, {
      id: "tanaka-san",
      display_name: "田中さん",
      aliases: ["Tanaka"],
      organizations: [{ name: "RhoCo", role: "代表取締役" }],
      notes: ["統合元メモ"],
    });
    await upsertPersonProfile(repo, { id: "self", display_name: "利用者 サンプル" });
    await upsertPersonRelationship(repo, {
      relationship_id: "canonical-client",
      from_person_id: "self",
      to_person_id: "canonical-person",
      type: "client",
      notes: ["既存関係"],
    });
    await upsertPersonRelationship(repo, {
      relationship_id: "duplicate-client",
      from_person_id: "self",
      to_person_id: "tanaka-san",
      type: "client",
      notes: ["統合元の関係メモ"],
    });
    await recordPersonInteraction(repo, "2026-08-13", {
      person_ids: ["self", "tanaka-san"],
      summary: "技術相談を受けた",
    });

    const merged = await mergePersonProfiles(repo, {
      target_person_id: "canonical-person",
      source_person_ids: ["tanaka-san"],
    });

    expect(merged).toMatchObject({
      profile: {
        id: "canonical-person",
        aliases: expect.arrayContaining(["田中さん", "Tanaka"]),
        notes: ["代表プロフィール", "統合元メモ"],
        merged_from: ["tanaka-san"],
      },
      merged_sources: [{ id: "tanaka-san", deleted: true, merged_into: "canonical-person" }],
      relationship_count: 1,
      linked_interaction_count: 1,
    });
    await expect(getPersonProfile(repo, "canonical-person")).resolves.toMatchObject({
      relationships: [{ id: "canonical-client", notes: ["既存関係", "統合元の関係メモ"] }],
      interactions: [{ summary: "技術相談を受けた", person_ids: ["self", "tanaka-san"] }],
    });
    await expect(getPersonProfile(repo, "tanaka-san")).rejects.toThrow("Person not found");
    await expect(getPersonProfile(repo, "tanaka-san", { include_deleted: true })).resolves.toMatchObject({
      profile: { merged_into: "canonical-person", deleted: true },
    });
    expect((await repo.loadPersonInteractions("2026-08-13")).interactions[0]?.person_ids).toEqual([
      "self",
      "tanaka-san",
    ]);
    await expect(setPersonDeleted(repo, "tanaka-san", false)).rejects.toThrow(
      "Merged person profile cannot be restored independently",
    );
  });

  it("rejects conflicting merges atomically", async () => {
    const { repo } = await createTempRepo();
    await upsertPersonProfile(repo, { id: "tokyo-person", display_name: "Tokyo", timezone: "Asia/Tokyo" });
    await upsertPersonProfile(repo, { id: "utc-person", display_name: "UTC", timezone: "UTC" });

    await expect(
      mergePersonProfiles(repo, { target_person_id: "tokyo-person", source_person_ids: ["utc-person"] }),
    ).rejects.toThrow("conflicting timezone");
    const source = await getPersonProfile(repo, "utc-person");
    expect(source.profile.id).toBe("utc-person");
    expect(source.profile.deleted).toBeUndefined();
    expect(source.profile.merged_into).toBeUndefined();
    const target = await getPersonProfile(repo, "tokyo-person");
    expect(target.profile.merged_from).toBeUndefined();
  });
});
