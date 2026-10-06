/**
 * @packageDocumentation
 * Parses sections and tables from a saved morning briefing.
 * It does not generate briefings, assess progress, or persist data.
 * 保存済みモーニングブリーフのセクションと表を解析する。
 * ブリーフィングの生成、進捗の判定、データの永続化は担当しない。
 */
import type { MorningBriefDocument, MorningBriefSection } from "#web/types";

const morningBriefSectionTitles = [
  "今日の予定",
  "重要な未読メール",
  "GitHub Issue確認",
  "今日注意が必要なタスク",
  "本日のワタシ用タスク表",
  "今日の推奨アクション",
];

function tableCells(line: string): string[] | undefined {
  if (line.includes("\t")) {
    const cells = line.split("\t").map((cell) => cell.trim());
    return cells.length > 1 ? cells : undefined;
  }
  if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
    return line
      .trim()
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
  }
  return undefined;
}

function isTableDivider(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function concisePreview(value: string, maxLength = 80): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function githubSectionPreview(items: string[], paragraphs: string[]): string | undefined {
  const candidates = [...items, ...paragraphs];
  const repositoryCount = candidates.find(
    (value) => /\d/.test(value) && /(?:リポジトリ|repositor(?:y|ies))/i.test(value),
  );
  const source = repositoryCount ?? candidates[0];
  return source ? concisePreview(source) : undefined;
}

/**
 * Converts morning briefing text into a structured document for display.
 * モーニングブリーフ本文を表示用の構造化文書へ変換する。
 */
export function parseMorningBrief(date: string, text: string | null): MorningBriefDocument {
  if (!text) {
    return {
      date,
      title: `${date.replaceAll("-", "/")} ブリーフィング`,
      available: false,
      sections: morningBriefSectionTitles.map((title, index) => ({
        number: index + 1,
        title,
        available: false,
        items: [],
        paragraphs: [],
      })),
    };
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const title = lines.find((line) => line.trim().length > 0)?.trim() ?? `${date} ブリーフィング`;
  const parsed = new Map<number, MorningBriefSection>();
  let current: { number: number; title: string; lines: string[] } | undefined;
  const flush = () => {
    if (!current) return;
    const content = current.lines.map((line) => line.trim()).filter((line) => line.length > 0 && !/^=+$/.test(line));
    const tableRows = content.map(tableCells).filter((cells): cells is string[] => Boolean(cells));
    const table =
      tableRows.length >= 2
        ? { headers: tableRows[0] ?? [], rows: tableRows.slice(1).filter((cells) => !isTableDivider(cells)) }
        : undefined;
    const tableLines = new Set(content.filter((line) => tableCells(line)));
    const items = content.filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
    const paragraphs = content.filter((line) => !line.startsWith("- ") && !tableLines.has(line));
    const preview = current.number === 3 ? githubSectionPreview(items, paragraphs) : undefined;
    parsed.set(current.number, {
      number: current.number,
      title: current.title,
      available: true,
      ...(preview ? { preview } : {}),
      items,
      paragraphs,
      ...(table ? { table } : {}),
    });
  };
  for (const line of lines) {
    const heading = line.trim().match(/^(\d+)\.\s+(.+)$/);
    if (heading) {
      flush();
      current = { number: Number(heading[1]), title: heading[2]?.trim() ?? "", lines: [] };
    } else if (current) current.lines.push(line);
  }
  flush();
  const maxSection = Math.max(morningBriefSectionTitles.length, ...parsed.keys());
  const sections = Array.from({ length: maxSection }, (_, index) => {
    const number = index + 1;
    return (
      parsed.get(number) ?? {
        number,
        title: morningBriefSectionTitles[index] ?? `セクション ${number}`,
        available: false,
        items: [],
        paragraphs: [],
      }
    );
  });
  return { date, title, available: true, sections };
}
