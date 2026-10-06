/**
 * Provides request log capabilities for the infrastructure layer.
 * Responsibility: This module owns the request log behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * インフラストラクチャ層のrequest log機能を提供します。
 * 責務: このモジュールは、ここで宣言するrequest logの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { nowIso, todayInTimeZone } from "#shared/date";
import type { Repository } from "#infra/repository/repository";
import type { RequestLogEntry, TaskMcpConfig } from "#shared/types";

const safeKeys = new Set([
  "date",
  "task_id",
  "project",
  "status",
  "mode",
  "dry_run",
  "format",
  "formats",
  "renderer",
  "extension",
  "limit",
  "lookback_days",
  "target_type",
  "report_date",
  "summary_id",
  "update_id",
  "update_ids",
  "source",
  "session_id",
  "promote_memory",
  "force",
]);

const countOnlyKeys = new Set([
  "done",
  "next",
  "confirm",
  "context_updates",
  "sources",
  "summary",
  "facts",
  "decisions",
  "risks",
  "notes",
  "preferences",
  "rules",
  "items",
]);

const resultSafeKeys = new Set([
  "date",
  "task_id",
  "project",
  "status",
  "mode",
  "dry_run",
  "format",
  "renderer",
  "extension",
  "target_type",
  "report_date",
  "summary_id",
  "update_id",
  "source",
  "session_id",
  "memory_promoted",
  "knowledge_updated",
  "knowledge_created_count",
  "knowledge_updated_count",
  "llm_provider",
  "model",
  "stop_reason",
  "codex_thread_id",
  "codex_turn_id",
  "claude_session_id",
  "changed_files",
  "source_activity_count",
  "total_count",
  "count",
  "before_count",
  "after_count",
]);

const resultCountKeys = new Set([
  "entries",
  "items",
  "results",
  "done",
  "next",
  "confirm",
  "notes",
  "sources",
  "fallback_reasons",
  "warnings",
  "errors",
  "reports",
]);

const resultSectionKeys = new Set([
  "report_entries",
  "task_summaries",
  "memory_summaries",
  "finalize",
  "apply",
  "archive",
  "summary",
]);

const safeFallbackReasonCode =
  /^(?:codex_app_server|claude_cli|copilot_cli|cursor_cli|gemini_cli|lm_studio):(?:method_not_found|model_unavailable|timeout|unsupported|provider_error)$/;

function summarizeString(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 117)}...`;
}

const maxErrorMessageChars = 2048;

/**
 * Bounds error text before it is persisted to the request audit log. Error
 * messages can include provider output, so retaining only the leading portion
 * prevents an unexpectedly large or secret-bearing tail from being recorded.
 */
export function summarizeErrorMessage(value: string): string {
  return value.length <= maxErrorMessageChars ? value : `${value.slice(0, maxErrorMessageChars - 3)}...`;
}

/**
 * Performs the public `summarizeToolArguments` operation provided by this module.
 *
 * このモジュールが提供する公開操作`summarizeToolArguments`を実行します。
 */
export function summarizeToolArguments(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (safeKeys.has(key)) {
      if (typeof value === "string") result[key] = summarizeString(value);
      else if (Array.isArray(value)) result[key] = value.length <= 10 ? value : { count: value.length };
      else if (typeof value === "number" || typeof value === "boolean" || value === null) result[key] = value;
      else if (value !== undefined) result[`${key}_present`] = true;
      continue;
    }
    if (countOnlyKeys.has(key)) {
      if (Array.isArray(value)) result[`${key}_count`] = value.length;
      else if (typeof value === "string") result[`${key}_present`] = value.length > 0;
      else if (value !== undefined) result[`${key}_present`] = true;
      continue;
    }
    if (typeof value === "string") result[`${key}_present`] = value.length > 0;
    else if (Array.isArray(value)) result[`${key}_count`] = value.length;
    else if (value !== undefined) result[`${key}_present`] = true;
  }
  return result;
}

/**
 * Produces a log-safe result summary. It deliberately records only allowlisted
 * scalar metadata and collection sizes, never generated text or nested values.
 *
 * ログへ安全に記録できる結果要約を生成します。許可リストに含まれるスカラーの
 * メタデータとコレクション件数だけを記録し、生成文やネストした値は記録しません。
 */
/**
 * Performs the public `summarizeToolResult` operation provided by this module.
 *
 * このモジュールが提供する公開操作`summarizeToolResult`を実行します。
 */
export function summarizeToolResult(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "fallback_reason_codes" && Array.isArray(value)) {
      result.fallback_reason_codes = value
        .filter((item): item is string => typeof item === "string" && safeFallbackReasonCode.test(item))
        .slice(0, 10);
      continue;
    }
    if (resultSafeKeys.has(key)) {
      if (typeof value === "string") result[key] = summarizeString(value);
      else if (typeof value === "number" || typeof value === "boolean" || value === null) result[key] = value;
      else if (value !== undefined) result[`${key}_present`] = true;
      continue;
    }
    if (resultCountKeys.has(key)) {
      if (Array.isArray(value)) result[`${key}_count`] = value.length;
      else if (value !== undefined) result[`${key}_present`] = true;
      continue;
    }
    if (key === "fallback" || key === "fallback_reason") {
      if (value !== undefined && value !== null && value !== "") result.fallback = true;
      continue;
    }
    if (resultSectionKeys.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
      const nested = summarizeToolResult(value);
      if (Object.keys(nested).length > 0) result[key] = nested;
    }
  }
  return result;
}

/**
 * Performs the public `writeRequestLog` operation provided by this module.
 *
 * このモジュールが提供する公開操作`writeRequestLog`を実行します。
 */
export async function writeRequestLog(
  repo: Repository,
  config: Pick<TaskMcpConfig, "timezone">,
  entry: Omit<RequestLogEntry, "timestamp">,
): Promise<void> {
  const now = new Date();
  const timestamp = nowIso();
  const date = todayInTimeZone(config.timezone, now);
  await repo.appendRequestLog(date, { timestamp, ...entry });
}
