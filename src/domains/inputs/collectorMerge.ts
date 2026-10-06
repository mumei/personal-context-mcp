/**
 * Merges collector-owned inputs and renders the local schedule section without an LLM.
 * Collector由来の入力を統合し、LLMを使用せず予定欄を描画します。
 * @packageDocumentation
 */
import type { InputItem, InputsDocument } from "#shared/types";

const owner = "external-input-collector";
const legacySources = new Set(["calendar", "mail", "github"]);
const timeRange = /\d{1,2}:\d{2}\s*[〜～~–−-]\s*\d{1,2}:\d{2}/u;

/** Refreshes collector data while retaining independently managed inputs; retained IDs win collisions.
 * 独立管理の入力を保持してCollectorデータを更新します。同一IDでは保持対象を優先します。
 */
export function mergeCollectorInputs(previous: InputsDocument, collected: InputsDocument): InputsDocument {
  const retained = previous.items.filter(
    (item) => item.collector_owner !== owner && (Boolean(item.input_id) || !legacySources.has(item.source ?? "")),
  );
  const merged = new Map<string, InputItem>();
  for (const item of [...collected.items.map((item) => ({ ...item, collector_owner: owner })), ...retained]) {
    const key = item.input_id
      ? `id:${item.input_id}`
      : JSON.stringify([item.source, item.title, item.received_at, item.url]);
    merged.set(key, item);
  }
  return { ...previous, ...collected, items: [...merged.values()] };
}

function scheduleTime(item: InputItem): number {
  const text = typeof item.start_at === "string" ? item.start_at : item.title;
  if (/終日|all.day/i.test(text)) return -1;
  const match = text.match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 1440;
}

/** Replaces only section one using merged schedule inputs, preserving other local collector sections.
 * 統合済み予定で第1節のみを置換し、その他のローカル収集結果を保持します。
 */
export function renderMergedSchedule(markdown: string, inputs: InputsDocument): string {
  const events = inputs.items.filter(
    (item) =>
      item.source === "calendar" ||
      item.kind === "event" ||
      item.type === "event" ||
      typeof item.start_at === "string" ||
      (item.source === "user" && timeRange.test(item.title)),
  );
  events.sort((a, b) => scheduleTime(a) - scheduleTime(b) || a.title.localeCompare(b.title, "ja"));
  const lines = [
    ...new Set(
      events.map(
        (item) =>
          `- ${item.title.replace(/\r?\n/g, " ")}${item.url && !item.title.includes(item.url) ? ` ${item.url}` : ""}`,
      ),
    ),
  ];
  return markdown.replace(
    /(^1\.\s+[^\n]*\n)[\s\S]*?(?=^2\.\s+)/m,
    (_match, heading: string) => `${heading}\n${(lines.length ? lines : ["- 予定なし"]).join("\n")}\n\n`,
  );
}
