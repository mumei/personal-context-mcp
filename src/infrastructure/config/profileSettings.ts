/**
 * Provides profile settings capabilities for the infrastructure layer.
 * Responsibility: This module owns the profile settings behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * インフラストラクチャ層のprofile settings機能を提供します。
 * 責務: このモジュールは、ここで宣言するprofile settingsの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import type { Repository } from "#infra/repository/repository";
import type { TaskMcpConfig } from "#shared/types";
import { repartitionActivities, type ActivityRepartitionResult } from "#domain/activities/repartition";

/**
 * Defines the public `ProfileSettings` data contract exposed by this module.
 *
 * このモジュールが公開する`ProfileSettings`データ契約を定義します。
 */
export interface ProfileSettings {
  timezone: string;
  activity_rollover_hour: number;
}

/**
 * Defines the public `ProfileSettingsView` data contract exposed by this module.
 *
 * このモジュールが公開する`ProfileSettingsView`データ契約を定義します。
 */
export interface ProfileSettingsView extends ProfileSettings {
  path: string;
  timezone_overridden_by_environment: boolean;
  activity_rollover_hour_overridden_by_environment: boolean;
  activity_repartition?: ActivityRepartitionResult;
}

/**
 * Performs the public `profileSettingsPath` operation provided by this module.
 *
 * このモジュールが提供する公開操作`profileSettingsPath`を実行します。
 */
export function profileSettingsPath(dataRoot: string): string {
  return join(dataRoot, "config", "profile.yaml");
}

/**
 * Performs the public `validateTimezone` operation provided by this module.
 *
 * このモジュールが提供する公開操作`validateTimezone`を実行します。
 */
export function validateTimezone(timezone: string): string {
  const value = timezone.trim();
  if (!value || value.length > 100) throw new Error("Timezone must be between 1 and 100 characters.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
  } catch {
    throw new Error(`Unsupported timezone: ${value}`);
  }
  return value;
}

/**
 * Performs the public `validateActivityRolloverHour` operation provided by this module.
 *
 * このモジュールが提供する公開操作`validateActivityRolloverHour`を実行します。
 */
export function validateActivityRolloverHour(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 23) {
    throw new Error("Activity rollover hour must be an integer from 0 to 23.");
  }
  return value;
}

/**
 * Performs the public `parseActivityRolloverHour` operation provided by this module.
 *
 * このモジュールが提供する公開操作`parseActivityRolloverHour`を実行します。
 */
export function parseActivityRolloverHour(value: unknown): number {
  const normalized =
    typeof value === "string"
      ? value.trim().replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
      : value;
  if (typeof normalized === "string" && !/^\d+$/.test(normalized)) {
    throw new Error("Activity rollover hour must be an integer from 0 to 23.");
  }
  return validateActivityRolloverHour(typeof normalized === "number" ? normalized : Number(normalized));
}

/**
 * Performs the public `loadStoredProfileSettings` operation provided by this module.
 *
 * このモジュールが提供する公開操作`loadStoredProfileSettings`を実行します。
 */
export function loadStoredProfileSettings(dataRoot: string): Partial<ProfileSettings> {
  let source: string;
  try {
    source = readFileSync(profileSettingsPath(dataRoot), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const parsed = YAML.parse(source) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") throw new Error("Profile settings must be a YAML object.");
  return {
    ...(typeof parsed.timezone === "string" ? { timezone: validateTimezone(parsed.timezone) } : {}),
    ...(typeof parsed.activity_rollover_hour === "number"
      ? { activity_rollover_hour: validateActivityRolloverHour(parsed.activity_rollover_hour) }
      : {}),
  };
}

/**
 * Performs the public `profileSettingsView` operation provided by this module.
 *
 * このモジュールが提供する公開操作`profileSettingsView`を実行します。
 */
export function profileSettingsView(config: TaskMcpConfig, env: NodeJS.ProcessEnv = process.env): ProfileSettingsView {
  return {
    timezone: config.timezone,
    activity_rollover_hour: config.activityRolloverHour,
    path: profileSettingsPath(config.dataRoot),
    timezone_overridden_by_environment: env.TASK_MCP_TIMEZONE !== undefined,
    activity_rollover_hour_overridden_by_environment: env.TASK_MCP_ACTIVITY_ROLLOVER_HOUR !== undefined,
  };
}

/**
 * Performs the public `updateProfileSettings` operation provided by this module.
 *
 * このモジュールが提供する公開操作`updateProfileSettings`を実行します。
 */
export async function updateProfileSettings(
  repo: Repository,
  config: TaskMcpConfig,
  update: ProfileSettings,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProfileSettingsView> {
  const timezone = validateTimezone(update.timezone);
  const activityRolloverHour = parseActivityRolloverHour(update.activity_rollover_hour);
  return repo.withTransaction(async () => {
    const effectiveTimezone = env.TASK_MCP_TIMEZONE === undefined ? timezone : config.timezone;
    const effectiveRolloverHour =
      env.TASK_MCP_ACTIVITY_ROLLOVER_HOUR === undefined ? activityRolloverHour : config.activityRolloverHour;
    const changed = effectiveTimezone !== config.timezone || effectiveRolloverHour !== config.activityRolloverHour;
    const activityRepartition = changed
      ? await repartitionActivities(repo, { timezone: effectiveTimezone, activityRolloverHour: effectiveRolloverHour })
      : undefined;
    await repo.writeText(
      profileSettingsPath(repo.root),
      YAML.stringify({ timezone, activity_rollover_hour: activityRolloverHour }),
      "update-profile-settings",
    );
    const stored = loadStoredProfileSettings(repo.root);
    if (stored.timezone !== timezone || stored.activity_rollover_hour !== activityRolloverHour) {
      throw new Error("Profile settings verification failed after write.");
    }
    if (env.TASK_MCP_TIMEZONE === undefined) config.timezone = timezone;
    if (env.TASK_MCP_ACTIVITY_ROLLOVER_HOUR === undefined) config.activityRolloverHour = activityRolloverHour;
    return {
      ...profileSettingsView(config, env),
      ...(activityRepartition ? { activity_repartition: activityRepartition } : {}),
    };
  });
}
