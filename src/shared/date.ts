/**
 * Provides date capabilities for the shared foundation layer.
 * Responsibility: This module owns the date behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * 共通基盤層のdate機能を提供します。
 * 責務: このモジュールは、ここで宣言するdateの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import type { TaskMcpConfig } from "#shared/types";

/**
 * Performs the public `todayInTimeZone` operation provided by this module.
 *
 * このモジュールが提供する公開操作`todayInTimeZone`を実行します。
 */
export function todayInTimeZone(timezone: string, now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

/**
 * Performs the public `operationalDateInTimeZone` operation provided by this module.
 *
 * このモジュールが提供する公開操作`operationalDateInTimeZone`を実行します。
 */
export function operationalDateInTimeZone(timezone: string, activityRolloverHour = 0, now = new Date()): string {
  const shifted = new Date(now.getTime() - activityRolloverHour * 60 * 60 * 1000);
  return todayInTimeZone(timezone, shifted);
}

/**
 * Defines the public `OperationalDateRange` data contract exposed by this module.
 *
 * このモジュールが公開する`OperationalDateRange`データ契約を定義します。
 */
export interface OperationalDateRange {
  date: string;
  timezone: string;
  rollover_hour: number;
  start: string;
  end: string;
  label: string;
}

/**
 * Performs the public `operationalDateRange` operation provided by this module.
 *
 * このモジュールが提供する公開操作`operationalDateRange`を実行します。
 */
export function operationalDateRange(
  date: string,
  config: Pick<TaskMcpConfig, "timezone"> & Partial<Pick<TaskMcpConfig, "activityRolloverHour">>,
): OperationalDateRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date: ${date}`);
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  const hour = config.activityRolloverHour ?? 0;
  const hourText = String(hour).padStart(2, "0");
  const start = `${date} ${hourText}:00`;
  const end = `${nextDate} ${hourText}:00`;
  return {
    date,
    timezone: config.timezone,
    rollover_hour: hour,
    start,
    end,
    label: `${start} - ${end} (${config.timezone})`,
  };
}

/**
 * Performs the public `resolveActivityWriteDate` operation provided by this module.
 *
 * このモジュールが提供する公開操作`resolveActivityWriteDate`を実行します。
 */
export function resolveActivityWriteDate(
  input: string | undefined,
  occurredAt: string | undefined,
  backfill: boolean,
  config: Pick<TaskMcpConfig, "timezone"> & Partial<Pick<TaskMcpConfig, "activityRolloverHour">>,
  now = new Date(),
): string {
  if (backfill) {
    if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      throw new Error("backfill=true requires an explicit date in YYYY-MM-DD format.");
    }
    return input;
  }
  if (input && input !== "today") {
    throw new Error("Explicit activity dates require backfill=true. Omit date for normal journal writes.");
  }
  let occurred = now;
  if (occurredAt) {
    occurred = new Date(occurredAt);
    if (Number.isNaN(occurred.getTime())) throw new Error(`Invalid occurred_at: ${occurredAt}`);
  }
  return operationalDateInTimeZone(config.timezone, config.activityRolloverHour ?? 0, occurred);
}

/**
 * Performs the public `resolveDate` operation provided by this module.
 *
 * このモジュールが提供する公開操作`resolveDate`を実行します。
 */
export function resolveDate(
  input: string | undefined,
  config: Pick<TaskMcpConfig, "timezone"> & Partial<Pick<TaskMcpConfig, "activityRolloverHour">>,
  now = new Date(),
): string {
  const today = operationalDateInTimeZone(config.timezone, config.activityRolloverHour ?? 0, now);
  if (!input || input === "today") {
    return today;
  }
  if (input === "tomorrow") {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }
  throw new Error(`Invalid date: ${input}`);
}

/**
 * Performs the public `dateDaysAgo` operation provided by this module.
 *
 * このモジュールが提供する公開操作`dateDaysAgo`を実行します。
 */
export function dateDaysAgo(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Performs the public `nowIso` operation provided by this module.
 *
 * このモジュールが提供する公開操作`nowIso`を実行します。
 */
export function nowIso(): string {
  return new Date().toISOString();
}
