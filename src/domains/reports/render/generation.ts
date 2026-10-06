/**
 * Report format dispatch and output persistence.
 * レポート形式の振り分けと出力の永続化を提供します。
 *
 * @remarks
 * This module owns selecting a renderer, computing output paths, transaction
 * boundaries, and saving generated reports. It does not load report models or
 * define the content layout of any format.
 * このモジュールは、レンダラーの選択、出力パスの算出、トランザクション境界、生成済み
 * レポートの保存を担当します。レポートモデルの読み込みや各形式の内容レイアウトの定義は
 * 行いません。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";
import { renderHtmlReport } from "#domain/reports/render/html";
import { renderMarkdownReport } from "#domain/reports/render/markdown";
import type { GenerateTextReportResult, ReportFormat } from "#domain/reports/render/model";
import { reportExtension } from "#domain/reports/render/policy";
import { renderTextReport } from "#domain/reports/render/text";

/**
 * Renders a report using the requested output format without writing it.
 * 指定された出力形式でレポートをレンダリングし、保存は行いません。
 */
export async function renderReport(repo: Repository, date: string, format: ReportFormat): Promise<string> {
  if (format === "markdown") {
    return renderMarkdownReport(repo, date);
  }
  if (format === "html") {
    return renderHtmlReport(repo, date);
  }
  return renderTextReport(repo, date);
}

/**
 * Renders a report and optionally saves it within a repository transaction.
 * レポートをレンダリングし、必要に応じてリポジトリトランザクション内で保存します。
 */
export async function generateReport(
  repo: Repository,
  date: string,
  write: boolean,
  format: ReportFormat,
): Promise<GenerateTextReportResult> {
  if (write) {
    return repo.withTransaction(() => generateReportImpl(repo, date, true, format));
  }
  return generateReportImpl(repo, date, false, format);
}

async function generateReportImpl(
  repo: Repository,
  date: string,
  write: boolean,
  format: ReportFormat,
): Promise<GenerateTextReportResult> {
  const text = await renderReport(repo, date, format);
  if (!write) {
    return {
      date,
      renderer: format,
      path: repo.layoutPath("outputs", format, `${date}.${reportExtension(format)}`),
      text,
    };
  }
  const save = await repo.saveOutput(format, date, text, "generate-report", reportExtension(format));
  return {
    date,
    renderer: format,
    path: save.path,
    text,
    save,
  };
}

/**
 * Renders a plain-text report and optionally saves it.
 * プレーンテキストレポートをレンダリングし、必要に応じて保存します。
 */
export async function generateTextReport(
  repo: Repository,
  date: string,
  write: boolean,
): Promise<GenerateTextReportResult> {
  return generateReport(repo, date, write, "text");
}
