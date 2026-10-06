/**
 * @packageDocumentation
 * Provides the backward-compatible facade that collects exports from the web application layer.
 * It does not implement business logic, HTTP routing, or configuration parsing.
 * Web アプリケーション層の後方互換 export を集約するファサードを提供する。
 * 業務ロジック、HTTP ルーティング、設定解析の実装自体は担当しない。
 */
export type {
  GeneratedMorningTaskSections,
  MorningBriefDocument,
  MorningBriefSection,
  MorningBriefTable,
  MorningProgressDocument,
  MorningProgressState,
  MorningTaskProgress,
  OverviewModel,
  WebServerOptions,
} from "#web/types";

export { isWebServerEnabled, parseWebServerOptions } from "#web/config/options";
export { generateWebLlm, webExternalProvider } from "#web/llm";
export { renderMarkdownBody } from "#web/markdown";
export { parseMorningBrief } from "#web/briefing/parser";
export {
  BriefingGenerationConflictError,
  generateMorningTaskSections,
  generateWebMorningSummary,
  mergeMorningTaskSections,
} from "#web/briefing/generation";
export { checkMorningTaskProgress } from "#web/briefing/progress";
export { generateWebTaskMindMap } from "#web/tasks/mindMap";
export { organizeWebTaskInformation } from "#web/tasks/organization";
export { resolveWebAgentUpdatesWithAi } from "#web/agentUpdates/resolution";
export { buildOverview, loadWebReportOutputs } from "#web/overview/buildOverview";
export { buildActivityCalendar } from "#web/activity/calendar";
export { isAuthorized, unauthorized } from "#web/http/authentication";
export { json, readJsonBody, routeUrl, text } from "#web/http/response";
