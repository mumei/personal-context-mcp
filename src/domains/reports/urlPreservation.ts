/**
 * Preserves user-facing URLs while LLM-generated report text is reorganized.
 * Responsibility: This module restores URL-bearing Done/Next lines that an LLM omitted from report output.
 * Non-responsibility: This module does not decide which activities require report regeneration or persist reports.
 *
 * LLMによるレポート文の再整理中に、ユーザー向けURLを保持します。
 * 責務: このモジュールは、LLMがレポート出力から省略したURLを含むDone/Next行を復元します。
 * 非責務: このモジュールは、再生成対象Activityの判断やレポートの永続化を担当しません。
 *
 * @packageDocumentation
 */

export interface ReportUrlFields {
  done?: string[];
  next?: string[];
}

const userFacingUrlPattern = /https?:\/\/[^\s<>"']+/gi;

function urls(value: string): string[] {
  return value.match(userFacingUrlPattern) ?? [];
}

function urlLines(values: string[] | undefined): string[] {
  return (values ?? []).filter((value) => urls(value).length > 0);
}

/**
 * Restores source lines when one or more of their URLs are absent from the generated report entry.
 * URLの一部または全部が生成済みReport Entryにない場合、元の行を同じ区分へ復元します。
 */
export function preserveReportEntryUrls(target: ReportUrlFields, sources: ReportUrlFields[]): void {
  target.done ??= [];
  target.next ??= [];

  for (const field of ["done", "next"] as const) {
    const targetValues = target[field] ?? [];
    target[field] = targetValues;
    for (const line of sources.flatMap((source) => urlLines(source[field]))) {
      const generatedText = [...target.done, ...target.next].join("\n");
      if (urls(line).some((url) => !generatedText.includes(url)) && !targetValues.includes(line)) {
        targetValues.push(line);
      }
    }
  }
}
