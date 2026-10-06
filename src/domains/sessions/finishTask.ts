/**
 * Provides finish task capabilities for the domain layer.
 * Responsibility: This module owns the finish task behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * domain層のfinish task機能を提供します。
 * 責務: このモジュールは、ここで宣言するfinish taskの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import {
  activityEntryForAgentUpdate,
  applyAgentUpdates,
  applyAgentUpdatesDryRun,
  previewAgentUpdate,
  submitAgentUpdate,
  type SubmitAgentUpdateInput,
} from "#domain/agent-updates/workflow";
import { generateReportEntriesFromActivities, type GenerateReportEntriesResult } from "#domain/reports/actions";
import { generateReport, type ReportFormat } from "#domain/reports/render";
import type { Repository } from "#infra/repository/repository";

/**
 * Defines the public `FinalizeDailyInput` data contract exposed by this module.
 *
 * このモジュールが公開する`FinalizeDailyInput`データ契約を定義します。
 */
export interface FinalizeDailyInput {
  dry_run?: boolean;
  formats?: ReportFormat[];
  update_ids?: string[];
  report_entry_generator?: ReportEntryGenerator;
}

/**
 * Defines the public `FinalizeDailyResult` data contract exposed by this module.
 *
 * このモジュールが公開する`FinalizeDailyResult`データ契約を定義します。
 */
export interface FinalizeDailyResult {
  date: string;
  dry_run: boolean;
  apply: Awaited<ReturnType<typeof applyAgentUpdates>> | Awaited<ReturnType<typeof applyAgentUpdatesDryRun>>;
  reportEntries?: Awaited<ReturnType<typeof generateReportEntriesFromActivities>>;
  reports?: Array<Awaited<ReturnType<typeof generateReport>>>;
}

/**
 * Defines the public `FinishTaskSessionInput` data contract exposed by this module.
 *
 * このモジュールが公開する`FinishTaskSessionInput`データ契約を定義します。
 */
export interface FinishTaskSessionInput extends SubmitAgentUpdateInput {
  dry_run?: boolean;
  formats?: ReportFormat[];
  report_entry_generator?: ReportEntryGenerator;
}

/**
 * Defines the public `FinishTaskSessionResult` data contract exposed by this module.
 *
 * このモジュールが公開する`FinishTaskSessionResult`データ契約を定義します。
 */
export interface FinishTaskSessionResult {
  date: string;
  dry_run: boolean;
  submitted: Awaited<ReturnType<typeof submitAgentUpdate>> | Awaited<ReturnType<typeof previewAgentUpdate>>;
  finalize: FinalizeDailyResult;
  message: string;
}

/**
 * Defines the public `ReportEntryGenerator` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`ReportEntryGenerator`を定義します。
 */
export type ReportEntryGenerator = (repo: Repository, date: string) => Promise<GenerateReportEntriesResult>;

/**
 * Performs the public `finalizeDaily` operation provided by this module.
 *
 * このモジュールが提供する公開操作`finalizeDaily`を実行します。
 */
export async function finalizeDaily(
  repo: Repository,
  date: string,
  input: FinalizeDailyInput = {},
): Promise<FinalizeDailyResult> {
  const dryRun = input.dry_run ?? true;
  if (dryRun) {
    return {
      date,
      dry_run: true,
      apply: await applyAgentUpdatesDryRun(repo, date, input.update_ids),
    };
  }

  return repo.withTransaction(async () => {
    const apply = await applyAgentUpdates(repo, date, input.update_ids);
    const reportEntryGenerator = input.report_entry_generator ?? generateReportEntriesFromActivities;
    const reportEntries = await reportEntryGenerator(repo, date);
    const formats: ReportFormat[] = input.formats && input.formats.length > 0 ? input.formats : ["text"];
    const reports = [];
    for (const format of formats) {
      reports.push(await generateReport(repo, date, true, format));
    }

    return {
      date,
      dry_run: false,
      apply,
      reportEntries,
      reports,
    };
  });
}

/**
 * Performs the public `finishTaskSession` operation provided by this module.
 *
 * このモジュールが提供する公開操作`finishTaskSession`を実行します。
 */
export async function finishTaskSession(
  repo: Repository,
  date: string,
  input: FinishTaskSessionInput,
): Promise<FinishTaskSessionResult> {
  const { dry_run, formats, report_entry_generator, ...updateInput } = input;
  if (dry_run) {
    const submitted = await previewAgentUpdate(repo, date, updateInput);
    const entry = activityEntryForAgentUpdate(submitted.update);
    const skipped = entry ? [] : [submitted.update.update_id];
    return {
      date,
      dry_run: true,
      submitted,
      finalize: {
        date,
        dry_run: true,
        apply: {
          entries: entry ? [entry] : [],
          skipped_updates: skipped,
          already_applied_updates: [],
          warnings: submitted.warnings,
        },
      },
      message: entry
        ? "Previewed the session update and activity entry without changing data."
        : `Previewed the session update as ${submitted.update.status}; no data was changed.`,
    };
  }

  return repo.withTransaction(async () => {
    const submitted = await submitAgentUpdate(repo, date, updateInput);
    const finalize = await finalizeDaily(repo, date, {
      dry_run: false,
      formats: formats && formats.length > 0 ? formats : ["text"],
      update_ids: [submitted.update.update_id],
      report_entry_generator,
    });
    const queue = await repo.loadAgentUpdates(date);
    const finalUpdate =
      queue.updates.find((update) => update.update_id === submitted.update.update_id) ?? submitted.update;
    const finalSubmitted = { ...submitted, update: finalUpdate };
    const appliedEntries = finalize.apply.entries.length;
    const message =
      finalUpdate.status === "applied"
        ? `Submitted update ${submitted.update.update_id}; ${dry_run ? "previewed" : "applied"} ${appliedEntries} entries.`
        : `Submitted update ${submitted.update.update_id} as ${finalUpdate.status}; review is required before it can be applied.`;

    return {
      date,
      dry_run: false,
      submitted: finalSubmitted,
      finalize,
      message,
    };
  });
}
