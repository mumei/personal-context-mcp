/**
 * Public compatibility facade for report rendering and generation.
 * レポートのレンダリングと生成に対する公開互換ファサードです。
 *
 * @remarks
 * This module owns the stable import surface previously provided by the monolithic
 * renderer. It does not implement data loading, normalization, format-specific
 * layouts, or persistence; those responsibilities live under `render/`.
 * このモジュールは、従来の単一レンダラーが提供していた安定したインポート面を担当します。
 * データ読み込み、正規化、形式別レイアウト、永続化は実装せず、それらの責務は `render/`
 * 配下のモジュールが担当します。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";
import {
  generateReport as generateReportInternal,
  generateTextReport as generateTextReportInternal,
  renderReport as renderReportInternal,
} from "#domain/reports/render/generation";
import { renderHtmlReport as renderHtmlReportInternal } from "#domain/reports/render/html";
import { renderMarkdownReport as renderMarkdownReportInternal } from "#domain/reports/render/markdown";
import type { GenerateTextReportResult, ReportFormat } from "#domain/reports/render/model";
import { renderTextReport as renderTextReportInternal } from "#domain/reports/render/text";

/**
 * Output formats supported by report rendering and generation.
 * レポートのレンダリングと生成でサポートされる出力形式です。
 */
export type { ReportFormat } from "#domain/reports/render/model";

/**
 * Result returned after rendering a report, with optional persistence metadata.
 * レポートのレンダリング後に返される結果で、任意の永続化メタデータを含みます。
 */
export type { GenerateTextReportResult } from "#domain/reports/render/model";

/**
 * Renders the report for a date using the legacy plain-text layout.
 * 指定日のレポートを従来のプレーンテキストレイアウトでレンダリングします。
 */
export async function renderTextReport(repo: Repository, date: string): Promise<string> {
  return renderTextReportInternal(repo, date);
}

/**
 * Renders the report for a date as Markdown.
 * 指定日のレポートをMarkdownとしてレンダリングします。
 */
export async function renderMarkdownReport(repo: Repository, date: string): Promise<string> {
  return renderMarkdownReportInternal(repo, date);
}

/**
 * Renders the report for a date as a standalone HTML document.
 * 指定日のレポートを単独で表示可能なHTML文書としてレンダリングします。
 */
export async function renderHtmlReport(repo: Repository, date: string): Promise<string> {
  return renderHtmlReportInternal(repo, date);
}

/**
 * Renders a report using the requested output format without writing it.
 * 指定された出力形式でレポートをレンダリングし、保存は行いません。
 */
export async function renderReport(repo: Repository, date: string, format: ReportFormat): Promise<string> {
  return renderReportInternal(repo, date, format);
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
  return generateReportInternal(repo, date, write, format);
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
  return generateTextReportInternal(repo, date, write);
}
