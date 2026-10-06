/**
 * Defines canonical person, relationship, and interaction contracts.
 * Responsibility: This module owns the persisted shapes for person-scoped information.
 * Non-responsibility: It does not validate identities, infer personal facts, or expose data to an LLM.
 *
 * 人物、人物関係、接点履歴の正規データ契約を定義します。
 * 責務: 人物に紐づく情報の永続化形式を担当します。
 * 非責務: 本人確認、個人情報の推測、LLMへのデータ公開は担当しません。
 *
 * @packageDocumentation
 */

export type PersonFactBasis = "confirmed" | "observed" | "inferred";
export type PersonSensitivity = "private" | "sensitive";
export type PersonRelationshipStatus = "active" | "inactive";

export interface PersonOrganization {
  name: string;
  role?: string;
  department?: string;
}

export interface PersonContact {
  type: string;
  value: string;
  label?: string;
  sensitivity: PersonSensitivity;
}

export interface PersonFact {
  id: string;
  category: string;
  value: string;
  basis: PersonFactBasis;
  sensitivity: PersonSensitivity;
  confidence?: number;
  source_note?: string;
  updated_at: string;
}

export interface PersonProfile {
  id: string;
  display_name: string;
  aliases: string[];
  organizations: PersonOrganization[];
  contacts: PersonContact[];
  roles: string[];
  relationship_type?: string;
  relationship_status: PersonRelationshipStatus;
  preferred_channels: string[];
  languages: string[];
  timezone?: string;
  facts: PersonFact[];
  notes: string[];
  created_at: string;
  updated_at: string;
  deleted?: boolean;
  merged_into?: string;
  merged_at?: string;
  merged_from?: string[];
}

export interface PersonRelationship {
  id: string;
  from_person_id: string;
  to_person_id: string;
  type: string;
  label?: string;
  status: PersonRelationshipStatus;
  notes: string[];
  created_at: string;
  updated_at: string;
}

export interface PersonRelationshipsDocument {
  relationships: PersonRelationship[];
}

export interface PersonInteraction {
  interaction_id: string;
  idempotency_key?: string;
  person_ids: string[];
  occurred_at: string;
  recorded_at: string;
  channel?: string;
  summary: string;
  outcomes: string[];
  follow_ups: string[];
  task_ids: string[];
  sensitivity: PersonSensitivity;
}

export interface PersonInteractionsDocument {
  date: string;
  interactions: PersonInteraction[];
}
