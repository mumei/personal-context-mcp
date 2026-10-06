/**
 * Provides sync readme capabilities for the infrastructure layer.
 * Responsibility: This module owns the sync readme behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * インフラストラクチャ層のsync readme機能を提供します。
 * 責務: このモジュールは、ここで宣言するsync readmeの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import type { SaveResult } from "#shared/types";

/**
 * Defines the public `DataRootReadmeSyncRepository` data contract exposed by this module.
 *
 * このモジュールが公開する`DataRootReadmeSyncRepository`データ契約を定義します。
 */
export interface DataRootReadmeSyncRepository {
  ensureDataRootReadme(): Promise<SaveResult>;
}

/**
 * Defines the public `StartupLogger` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`StartupLogger`を定義します。
 */
export type StartupLogger = (message: string, error: unknown) => void;

/**
 * Performs the public `syncDataRootReadme` operation provided by this module.
 *
 * このモジュールが提供する公開操作`syncDataRootReadme`を実行します。
 */
export async function syncDataRootReadme(
  repo: DataRootReadmeSyncRepository,
  logger: StartupLogger = console.error,
): Promise<SaveResult | undefined> {
  try {
    return await repo.ensureDataRootReadme();
  } catch (error) {
    logger("Failed to sync data-root README:", error);
    return undefined;
  }
}
