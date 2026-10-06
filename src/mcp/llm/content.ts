/**
 * Strips JSON code fences from generated text.
 * 生成テキストからJSONコードフェンスを除去します。
 *
 * @remarks
 * This module only handles transport text and does not validate domain payloads.
 * このモジュールは転送テキストだけを扱い、ドメインpayloadの検証は担当しません。
 *
 * @packageDocumentation
 */

export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    return fenced[1]?.trim() ?? "";
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}
