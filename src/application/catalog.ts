/**
 * Provides catalog capabilities for the application layer.
 * Responsibility: This module owns the catalog behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * application層のcatalog機能を提供します。
 * 責務: このモジュールは、ここで宣言するcatalogの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";

/**
 * Defines the public `DataDates` data contract exposed by this module.
 *
 * このモジュールが公開する`DataDates`データ契約を定義します。
 */
export interface DataDates {
  inputs: string[];
  activities: string[];
  reports: string[];
  report_summaries: string[];
  agent_updates: string[];
  memory_summaries: string[];
}

/**
 * Defines the public `OutputDates` data contract exposed by this module.
 *
 * このモジュールが公開する`OutputDates`データ契約を定義します。
 */
export interface OutputDates {
  renderer: string;
  extension?: string;
  dates: string[];
}

/**
 * Performs the public `listDataDates` operation provided by this module.
 *
 * このモジュールが提供する公開操作`listDataDates`を実行します。
 */
export async function listDataDates(repo: Repository): Promise<DataDates> {
  const [inputs, activities, reports, reportSummaries, agentUpdates, memorySummaries] = await Promise.all([
    repo.listYamlDates(repo.layoutName("inputs")),
    repo.listYamlDates(repo.layoutName("activities")),
    repo.listYamlDates(repo.layoutName("reports")),
    repo.listYamlDates(repo.layoutName("reportSummaries")),
    repo.listYamlDates(repo.layoutName("agentUpdates")),
    repo.listYamlDates(repo.layoutName("memorySummaries")),
  ]);
  return {
    inputs,
    activities,
    reports,
    report_summaries: reportSummaries,
    agent_updates: agentUpdates,
    memory_summaries: memorySummaries,
  };
}

/**
 * Performs the public `listOutputDates` operation provided by this module.
 *
 * このモジュールが提供する公開操作`listOutputDates`を実行します。
 */
export async function listOutputDates(repo: Repository, renderer: string, extension?: string): Promise<OutputDates> {
  return {
    renderer,
    extension,
    dates: await repo.listOutputDates(renderer, extension),
  };
}
