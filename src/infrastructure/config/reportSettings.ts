/**
 * Persists independent settings for weekly report periods.
 * Responsibility: This module validates and stores the configured week start day.
 * Non-responsibility: This module does not change runtime configuration or report data.
 *
 * 週次レポート期間の独立した設定を永続化します。
 * 責務: このモジュールは週開始曜日を検証し保存します。
 * 非責務: 実行時設定やレポートデータは変更しません。
 *
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import type { Repository } from "#infra/repository/repository";

export interface ReportSettings {
  week_start_day: number;
}

export interface ReportSettingsView extends ReportSettings {
  path: string;
}

/**
 * Returns the path used to store weekly report settings.
 *
 * 週次レポート設定の保存先を返します。
 */
export function reportSettingsPath(dataRoot: string): string {
  return join(dataRoot, "config", "report.yaml");
}

/**
 * Validates a week start day using Sunday=0 through Saturday=6.
 *
 * 日曜=0から土曜=6の週開始曜日を検証します。
 */
export function validateWeekStartDay(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 6) {
    throw new Error("Week start day must be an integer from 0 to 6.");
  }
  return value;
}

/**
 * Loads weekly report settings, defaulting to Monday for an absent file or key.
 *
 * 週次レポート設定を読み込み、ファイルまたは項目がなければ月曜を既定値にします。
 */
export function loadReportSettings(dataRoot: string): ReportSettings {
  let source: string;
  try {
    source = readFileSync(reportSettingsPath(dataRoot), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { week_start_day: 1 };
    throw error;
  }

  const parsed: unknown = YAML.parse(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Report settings must be a YAML object.");
  }
  const settings = parsed as Record<string, unknown>;
  return { week_start_day: settings.week_start_day === undefined ? 1 : validateWeekStartDay(settings.week_start_day) };
}

/**
 * Validates and transactionally writes the weekly report settings.
 *
 * 週次レポート設定を検証し、トランザクション内で保存します。
 */
export async function updateReportSettings(repo: Repository, update: ReportSettings): Promise<ReportSettingsView> {
  if (!update || typeof update !== "object" || Object.keys(update).some((key) => key !== "week_start_day")) {
    throw new Error("Report settings update must contain only week_start_day.");
  }
  const settings = { week_start_day: validateWeekStartDay(update.week_start_day) };
  const path = reportSettingsPath(repo.root);
  await repo.withTransaction(async () => {
    await repo.writeText(path, YAML.stringify(settings), "update-report-settings");
    const stored = loadReportSettings(repo.root);
    if (stored.week_start_day !== settings.week_start_day) {
      throw new Error("Report settings verification failed after write.");
    }
  });
  return { ...settings, path };
}
