/**
 * Provides the compatibility facade for all public shared type contracts.
 * Responsibility: This module preserves the existing shared-types import path by re-exporting every public contract.
 * Non-responsibility: This module does not define domain contracts or introduce dependencies between them.
 *
 * すべての公開共通型契約に対する互換ファサードを提供します。
 * 責務: このモジュールは、すべての公開契約を再exportし、既存の共通型importパスを維持します。
 * 非責務: このモジュールは、ドメイン契約の定義やドメイン間の依存関係の追加を担当しません。
 *
 * @packageDocumentation
 */

export type { ActivityDocument, ActivityEntry } from "#shared/types/activity";
export type { AgentUpdate, AgentUpdatesDocument, AgentUpdateStatus, Confidence } from "#shared/types/agentUpdate";
export type { CleanupSummariesDocument, CleanupSummary, CleanupSummaryFile } from "#shared/types/cleanup";
export type { BackupCleanupConfig, LayoutConfig, LlmProvider, TaskMcpConfig } from "#shared/types/config";
export type { InputItem, InputsDocument } from "#shared/types/input";
export type {
  KnowledgeGraphEdge,
  KnowledgeGraphIndex,
  KnowledgeGraphResult,
  KnowledgeEvidence,
  KnowledgeIndexNode,
  KnowledgeNodeType,
  KnowledgeNote,
  KnowledgeRelation,
  KnowledgeRelationType,
} from "#shared/types/knowledge";
export type {
  GlobalMemoryDocument,
  MemoryMindMap,
  MemoryMindMapNode,
  MemorySourceRef,
  MemorySummariesDocument,
  MemorySummary,
  MemorySummaryStatus,
  MemorySummaryTarget,
  ReportSummaryDocument,
  TaskMemoryDocument,
} from "#shared/types/memory";
export type { FrontmatterDocument, RequestLogEntry, SaveResult } from "#shared/types/persistence";
export type {
  PersonContact,
  PersonFact,
  PersonFactBasis,
  PersonInteraction,
  PersonInteractionsDocument,
  PersonOrganization,
  PersonProfile,
  PersonRelationship,
  PersonRelationshipsDocument,
  PersonRelationshipStatus,
  PersonSensitivity,
} from "#shared/types/people";
export type { ReportDocument, ReportEntry } from "#shared/types/report";
export type { SearchMatch } from "#shared/types/search";
export type {
  HandoffAttentionItem,
  HandoffAttentionReason,
  HandoffHealth,
  SituationItem,
  SourceRef,
  UserSituation,
} from "#shared/types/situation";
export type { Task, TasksDocument, TaskStatus, TaskTier } from "#shared/types/task";
