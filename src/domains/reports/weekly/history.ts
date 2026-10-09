/**
 * Lists stored weekly versions separately from manually generatable periods.
 * Historical ranges retain their original boundaries after settings changes.
 *
 * 保存済み週次版と手動生成可能な期間を区別して一覧化します。
 * 設定変更後も履歴は元の集計期間を保持します。
 * @packageDocumentation
 */
import { readdir } from "node:fs/promises";
import type { Repository } from "#infra/repository/repository";
import type { TaskMcpConfig } from "#shared/types";
import { loadReportSettings } from "#infra/config/reportSettings";
import { parseWeeklyRecord } from "#domain/reports/weekly/generation";
import { parseWeeklyDate, resolveWeeklyPeriod, weeklyDateOffset } from "#domain/reports/weekly/range";

/** Lists evidence-backed period choices and actual saved versions without generating anything.
 * 証拠のある期間候補と実在する保存版を、生成を行わず一覧化します。
 */
export async function listWeeklyHistory(repo: Repository, config: TaskMcpConfig) {
  const startDay = loadReportSettings(repo.root).week_start_day;
  const current = resolveWeeklyPeriod(config, startDay);
  const versions: {
    week_start: string;
    week_end: string;
    through: string;
    generated_at: string;
    provisional: boolean;
  }[] = [];
  let names: string[] = [];
  try {
    names = await readdir(repo.pathFor(repo.layoutName("outputs"), "weekly"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const name of names) {
    const match = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(name);
    if (!match) continue;
    const text = await repo.readTextIfExists(repo.layoutName("outputs"), "weekly", name, "report.json");
    if (!text) continue;
    const { period, generated_at } = parseWeeklyRecord(text, match[1]!, match[2]!);
    versions.push({
      week_start: period.week_start,
      week_end: period.week_end,
      through: period.through,
      generated_at,
      provisional: period.provisional,
    });
  }
  versions.sort((a, b) => b.through.localeCompare(a.through) || b.generated_at.localeCompare(a.generated_at));
  const periods = new Map<string, { week_start: string; week_end: string; through: string; can_generate: boolean }>();
  const add = (period: { week_start: string; week_end: string; through: string }, can_generate: boolean) => {
    const key = `${period.week_start}_${period.week_end}`;
    if (!periods.has(key))
      periods.set(key, {
        week_start: period.week_start,
        week_end: period.week_end,
        through: period.through,
        can_generate,
      });
  };
  add(current, true);
  for (const folder of ["activities", "reports"] as const) {
    for (const date of await repo.listYamlDates(repo.layoutName(folder))) {
      parseWeeklyDate(date);
      if (date <= current.today) add(resolveWeeklyPeriod(config, startDay, date), true);
    }
  }
  for (const version of versions) {
    const normalized = resolveWeeklyPeriod(config, startDay, version.week_start);
    add(version, normalized.week_start === version.week_start);
  }
  const earliest = [...periods.values()].reduce(
    (start, item) => (item.week_start < start ? item.week_start : start),
    current.week_start,
  );
  const first = resolveWeeklyPeriod(config, startDay, earliest).week_start;
  for (let start = first; start <= current.week_start; start = weeklyDateOffset(start, 7)) {
    add(resolveWeeklyPeriod(config, startDay, start), true);
  }
  return {
    today: current.today,
    current_week: current.week_start,
    week_start_day: startDay,
    periods: [...periods.values()].sort((a, b) => b.week_start.localeCompare(a.week_start)),
    versions,
  };
}
