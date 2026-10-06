/**
 * Registers public person-profile, relationship, and interaction MCP tools.
 * Responsibility: This module owns public schemas and maps them to person-domain operations.
 * Non-responsibility: It does not infer personal facts, expose them to an LLM, or promote them to Knowledge.
 *
 * 人物プロフィール、人物関係、接点履歴の公開MCPツールを登録します。
 * 責務: 公開スキーマを定義し、人物ドメイン操作へ接続します。
 * 非責務: 個人情報の推測、LLMへの公開、Knowledgeへの昇格は担当しません。
 *
 * @packageDocumentation
 */
import * as z from "zod/v4";
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
import { jsonText } from "#mcp/protocol/result";
import type { ToolRegistrationContext } from "#mcp/tools/context";
import { resolveActivityWriteDate } from "#shared/date";
import type { TaskMcpConfig } from "#shared/types";
import type { Repository } from "#infra/repository/repository";

const organizationSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  department: z.string().optional(),
});

const factSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  value: z.string().min(1),
  basis: z.enum(["confirmed", "observed", "inferred"]),
  sensitivity: z.enum(["private", "sensitive"]).default("private"),
  confidence: z.number().min(0).max(1).optional(),
  source_note: z.string().optional(),
  updated_at: z.string().optional(),
});

const contactSchema = z.object({
  type: z.string().min(1),
  value: z.string().min(1),
  label: z.string().optional(),
  sensitivity: z.enum(["private", "sensitive"]).default("private"),
});

const profileUpsertSchema = z.object({
  id: z.string(),
  display_name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  organizations: z.array(organizationSchema).optional(),
  contacts: z.array(contactSchema).optional(),
  roles: z.array(z.string()).optional(),
  relationship_type: z.string().optional(),
  relationship_status: z.enum(["active", "inactive"]).optional(),
  preferred_channels: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  timezone: z.string().optional(),
  facts: z.array(factSchema).optional(),
  fact_ids_to_remove: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
  fields_to_clear: z.array(z.enum(["relationship_type", "timezone"])).optional(),
  allow_duplicate: z.boolean().default(false),
});

const relationshipUpsertSchema = z.object({
  relationship_id: z.string(),
  from_person_id: z.string(),
  to_person_id: z.string(),
  type: z.string().min(1),
  label: z.string().optional(),
  status: z.enum(["active", "inactive"]).default("active"),
  notes: z.array(z.string()).default([]),
});

const interactionCaptureSchema = z.object({
  person_ids: z.array(z.string()).min(1),
  idempotency_key: z.string().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  backfill: z.boolean().default(false),
  occurred_at: z.string().optional(),
  channel: z.string().optional(),
  summary: z.string().min(1),
  outcomes: z.array(z.string()).default([]),
  follow_ups: z.array(z.string()).default([]),
  task_ids: z.array(z.string()).default([]),
  sensitivity: z.enum(["private", "sensitive"]).default("private"),
});

export const peopleCaptureSchema = z
  .object({
    profiles: z.array(profileUpsertSchema).default([]),
    relationships: z.array(relationshipUpsertSchema).default([]),
    interactions: z.array(interactionCaptureSchema).default([]),
  })
  .refine(
    (input) => input.profiles.length + input.relationships.length + input.interactions.length > 0,
    "At least one profile, relationship, or interaction update is required.",
  );

export type PeopleCaptureInput = z.infer<typeof peopleCaptureSchema>;

/** Applies one atomic People capture request. 1件のPeople一括記録要求を原子的に適用します。 */
export async function applyPeopleCapture(
  repo: Repository,
  config: TaskMcpConfig,
  input: PeopleCaptureInput,
): Promise<Awaited<ReturnType<typeof capturePersonUpdate>>> {
  return capturePersonUpdate(repo, {
    profiles: input.profiles,
    relationships: input.relationships,
    interactions: input.interactions.map(({ date, backfill, ...interaction }) => ({
      date: resolveActivityWriteDate(date, interaction.occurred_at, backfill, config),
      input: interaction,
    })),
  });
}

/** Registers all public People tools. すべての公開Peopleツールを登録します。 */
export function registerPeopleTools({ server, repo, config }: ToolRegistrationContext): void {
  server.registerTool(
    "people_find_duplicates",
    {
      description:
        "Find possible duplicate active people before creating a profile or when identity overlap is suspected. Exact email or phone matches are strong; names, aliases, and organizations are suggestions only and never trigger an automatic merge.",
      inputSchema: z
        .object({
          person_id: z.string().optional(),
          display_name: z.string().optional(),
          aliases: z.array(z.string()).optional(),
          organizations: z.array(organizationSchema).optional(),
          contacts: z.array(contactSchema).optional(),
          limit: z.number().int().positive().max(100).default(20),
        })
        .refine(
          (input) =>
            Boolean(
              input.person_id ||
              input.display_name ||
              input.aliases?.length ||
              input.organizations?.length ||
              input.contacts?.length,
            ),
          "person_id or identity fields are required.",
        ),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => jsonText(await findDuplicatePersonProfiles(repo, input)),
  );

  server.registerTool(
    "people_list_profiles",
    {
      description:
        "List local person profiles. Person data is distinct from Knowledge, Task Memory, and Global Memory and is never sent to an LLM automatically.",
      inputSchema: z.object({
        query: z.string().optional(),
        relationship_status: z.enum(["active", "inactive"]).optional(),
        include_deleted: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => jsonText(await listPersonProfiles(repo, input)),
  );

  server.registerTool(
    "people_get_profile",
    {
      description:
        "Get one local person profile with typed relationships and recent append-only interactions. Treat inferred facts as hypotheses, not confirmed personal information.",
      inputSchema: z.object({
        person_id: z.string(),
        include_deleted: z.boolean().default(false),
        interaction_limit: z.number().int().positive().max(200).default(30),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ person_id, ...input }) => jsonText(await getPersonProfile(repo, person_id, input)),
  );

  server.registerTool(
    "people_upsert_profile",
    {
      description:
        "Create or update one local person profile. Exact email or phone reuse by another active profile is rejected unless allow_duplicate=true is explicitly set after confirming they are different people. Record only user-provided or clearly observed information. Mark every fact as confirmed, observed, or inferred; never convert an inference into a confirmed fact.",
      inputSchema: profileUpsertSchema,
    },
    async (input) => jsonText(await upsertPersonProfile(repo, input)),
  );

  server.registerTool(
    "people_capture_update",
    {
      description:
        "Atomically capture newly provided or clearly observed person profiles, typed relationships, and dated interactions in one call. Use proactively when durable person information appears in the conversation; do not wait for an explicit request to register it. Call people_find_duplicates before creating a new ID, never infer missing fields, preserve confirmed/observed/inferred fact provenance, and use idempotency_key for retryable interactions. Exact email or phone duplicates are rejected by default.",
      inputSchema: peopleCaptureSchema,
    },
    async (input) => jsonText(await applyPeopleCapture(repo, config, input)),
  );

  server.registerTool(
    "people_merge_profiles",
    {
      description:
        "Merge confirmed duplicate active profiles into one canonical target. Arrays and compatible facts are combined, mutable relationships are rewired and deduplicated, source profiles become audited merged_into redirects, and immutable interaction journals remain unchanged but are included when reading the target. Conflicting relationship_type, timezone, or same-ID facts are rejected without partial writes.",
      inputSchema: z.object({
        target_person_id: z.string(),
        source_person_ids: z.array(z.string()).min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (input) => jsonText(await mergePersonProfiles(repo, input)),
  );

  server.registerTool(
    "people_record_interaction",
    {
      description:
        "Append an immutable dated interaction with one or more people. Use this for meetings, messages, commitments, outcomes, and follow-ups; do not put interaction history into person facts.",
      inputSchema: z.object({
        person_ids: z.array(z.string()).min(1),
        idempotency_key: z.string().optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        backfill: z.boolean().default(false),
        occurred_at: z.string().optional(),
        channel: z.string().optional(),
        summary: z.string().min(1),
        outcomes: z.array(z.string()).default([]),
        follow_ups: z.array(z.string()).default([]),
        task_ids: z.array(z.string()).default([]),
        sensitivity: z.enum(["private", "sensitive"]).default("private"),
      }),
    },
    async ({ date, backfill, ...input }) =>
      jsonText(
        await recordPersonInteraction(repo, resolveActivityWriteDate(date, input.occurred_at, backfill, config), input),
      ),
  );

  server.registerTool(
    "people_list_interactions",
    {
      description: "List local append-only person interactions, optionally filtered by person or operational date.",
      inputSchema: z.object({
        person_id: z.string().optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        limit: z.number().int().positive().max(500).default(50),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => jsonText(await listPersonInteractions(repo, input)),
  );

  server.registerTool(
    "people_upsert_relationship",
    {
      description:
        "Create or completely update one typed relationship between two existing active people. This models person-to-person relationships, not the user's relationship_type stored on each profile.",
      inputSchema: relationshipUpsertSchema,
    },
    async (input) => jsonText(await upsertPersonRelationship(repo, input)),
  );

  server.registerTool(
    "people_delete_profile",
    {
      description:
        "Logically delete a person profile while preserving relationships and interaction history for audit. Deleted profiles are excluded from normal retrieval.",
      inputSchema: z.object({ person_id: z.string() }),
    },
    async ({ person_id }) => jsonText(await setPersonDeleted(repo, person_id, true)),
  );

  server.registerTool(
    "people_restore_profile",
    {
      description: "Restore a logically deleted person profile without changing its preserved history.",
      inputSchema: z.object({ person_id: z.string() }),
    },
    async ({ person_id }) => jsonText(await setPersonDeleted(repo, person_id, false)),
  );
}
