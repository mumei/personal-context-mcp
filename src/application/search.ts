/**
 * Provides search capabilities for the application layer.
 * Responsibility: This module owns the search behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * application層のsearch機能を提供します。
 * 責務: このモジュールは、ここで宣言するsearchの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";
import type { SearchMatch, Task } from "#shared/types";
import { isTaskDeleted } from "#domain/tasks/state";

/**
 * Defines the public `SearchTermsMode` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`SearchTermsMode`を定義します。
 */
export type SearchTermsMode = "all" | "any";

/**
 * Defines the public `SearchTaskContextOptions` data contract exposed by this module.
 *
 * このモジュールが公開する`SearchTaskContextOptions`データ契約を定義します。
 */
export interface SearchTaskContextOptions {
  limit?: number;
  task_id?: string;
  project?: string;
  date?: string;
  section?: string | string[];
  terms_mode?: SearchTermsMode;
  include_deleted?: boolean;
}

interface SearchCandidate {
  task_id?: string;
  title?: string;
  project?: string;
  date?: string;
  path: string;
  section: string;
  text: string;
  score_bonus?: number;
}

function textFields(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap(textFields);
  }
  if (typeof value === "object") {
    return Object.values(value).flatMap(textFields);
  }
  return [];
}

function scoreText(text: string, query: string, terms: string[], termsMode: SearchTermsMode): number | undefined {
  const lower = text.toLowerCase();
  const matchedTerms = terms.filter((term) => lower.includes(term));
  if (matchedTerms.length === 0 || (termsMode === "all" && matchedTerms.length !== terms.length)) {
    return undefined;
  }

  const occurrences = matchedTerms.reduce((count, term) => count + lower.split(term).length - 1, 0);
  return matchedTerms.length * 10 + occurrences + (lower.includes(query) ? 8 : 0);
}

function excerpt(text: string, maxLength = 220): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

function normalizeOptions(
  limitOrOptions: number | SearchTaskContextOptions,
  options?: SearchTaskContextOptions,
): Required<Pick<SearchTaskContextOptions, "limit" | "terms_mode">> & SearchTaskContextOptions {
  const supplied = (typeof limitOrOptions === "number" ? options : limitOrOptions) ?? {};
  return {
    ...supplied,
    limit: typeof limitOrOptions === "number" ? limitOrOptions : (supplied.limit ?? 20),
    terms_mode: supplied.terms_mode ?? "all",
  };
}

function matchesFilters(candidate: SearchCandidate, options: SearchTaskContextOptions): boolean {
  const sections =
    options.section === undefined
      ? undefined
      : new Set(Array.isArray(options.section) ? options.section : [options.section]);
  return (
    (!options.task_id || candidate.task_id === options.task_id) &&
    (!options.project || candidate.project === options.project) &&
    (!options.date || candidate.date === options.date) &&
    (!sections || sections.has(candidate.section))
  );
}

function addMatch(
  matches: SearchMatch[],
  candidate: SearchCandidate,
  query: string,
  terms: string[],
  options: Required<Pick<SearchTaskContextOptions, "terms_mode">> & SearchTaskContextOptions,
): void {
  if (!matchesFilters(candidate, options)) {
    return;
  }
  const score = scoreText(candidate.text, query, terms, options.terms_mode);
  if (score === undefined) {
    return;
  }
  matches.push({
    task_id: candidate.task_id,
    title: candidate.title,
    project: candidate.project,
    date: candidate.date,
    path: candidate.path,
    section: candidate.section,
    excerpt: excerpt(candidate.text),
    score: score + (candidate.score_bonus ?? 0),
  });
}

async function loadEachDate<T>(
  repo: Repository,
  layout: Parameters<Repository["layoutName"]>[0],
  load: (date: string) => Promise<T>,
  visit: (date: string, document: T) => void,
): Promise<void> {
  const dates = await repo.listYamlDates(repo.layoutName(layout));
  for (const date of dates) {
    try {
      visit(date, await load(date));
    } catch {
      // A malformed historical document should not hide matches in other files.
    }
  }
}

/**
 * Performs the public `searchTaskContext` operation provided by this module.
 *
 * このモジュールが提供する公開操作`searchTaskContext`を実行します。
 */
export async function searchTaskContext(repo: Repository, query: string, limit?: number): Promise<SearchMatch[]>;
/**
 * Performs the public `searchTaskContext` operation provided by this module.
 *
 * このモジュールが提供する公開操作`searchTaskContext`を実行します。
 */
export async function searchTaskContext(
  repo: Repository,
  query: string,
  options?: SearchTaskContextOptions,
): Promise<SearchMatch[]>;
/**
 * Performs the public `searchTaskContext` operation provided by this module.
 *
 * このモジュールが提供する公開操作`searchTaskContext`を実行します。
 */
/**
 * Performs the public `searchTaskContext` operation provided by this module.
 *
 * このモジュールが提供する公開操作`searchTaskContext`を実行します。
 */
export async function searchTaskContext(
  repo: Repository,
  query: string,
  limit: number,
  options: SearchTaskContextOptions,
): Promise<SearchMatch[]>;
export async function searchTaskContext(
  repo: Repository,
  query: string,
  limitOrOptions: number | SearchTaskContextOptions = 20,
  additionalOptions?: SearchTaskContextOptions,
): Promise<SearchMatch[]> {
  const options = normalizeOptions(limitOrOptions, additionalOptions);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0 || options.limit <= 0) {
    return [];
  }

  const tasksDoc = await repo.loadTasks();
  const tasksById = taskById(tasksDoc.tasks);
  const visibleTask = (taskId: string | undefined): boolean =>
    options.include_deleted === true || !isTaskDeleted(taskId ? tasksById.get(taskId) : undefined);
  const matches: SearchMatch[] = [];

  for (const task of tasksDoc.tasks) {
    if (!visibleTask(task.id)) continue;
    const taskText = textFields(task).join(" ");
    addMatch(
      matches,
      {
        task_id: task.id,
        title: task.title,
        project: task.project,
        path: repo.layoutPath("tasks"),
        section: "task",
        text: taskText,
        score_bonus: task.id.toLowerCase() === query.toLowerCase() ? 100 : 0,
      },
      query,
      terms,
      options,
    );

    try {
      const context = await repo.loadTaskContext(task);
      addMatch(
        matches,
        {
          task_id: task.id,
          title: task.title,
          project: task.project,
          path: repo.contextPathFor(task),
          section: "context",
          text: [...textFields(context.data), context.body].join(" "),
          score_bonus: 5,
        },
        query,
        terms,
        options,
      );
    } catch {
      // Validation reports unreadable contexts; search continues with other sources.
    }

    try {
      const memory = await repo.loadTaskMemory(task.id);
      addMatch(
        matches,
        {
          task_id: task.id,
          title: task.title,
          project: task.project,
          path: repo.layoutPath("taskMemory", `${task.id}.yaml`),
          section: "task_memory",
          text: textFields(memory).join(" "),
          score_bonus: 6,
        },
        query,
        terms,
        options,
      );
    } catch {
      // Validation reports unreadable memory; search continues with other sources.
    }
  }

  try {
    const globalMemory = await repo.loadGlobalMemory();
    addMatch(
      matches,
      {
        path: repo.layoutPath("globalMemory"),
        section: "global_memory",
        text: textFields(globalMemory).join(" "),
        score_bonus: 4,
      },
      query,
      terms,
      options,
    );
  } catch {
    // Ignore one malformed global file while retaining all other matches.
  }

  await loadEachDate(
    repo,
    "inputs",
    (date) => repo.loadInputs(date),
    (date, input) => {
      for (const item of input.items ?? []) {
        if (!visibleTask(item.related_task_id ?? undefined)) continue;
        const task = item.related_task_id ? tasksById.get(item.related_task_id) : undefined;
        addMatch(
          matches,
          {
            task_id: item.related_task_id ?? undefined,
            title: task?.title ?? item.title,
            project: item.project ?? task?.project,
            date,
            path: repo.layoutPath("inputs", `${date}.yaml`),
            section: "input",
            text: textFields(item).join(" "),
            score_bonus: 3,
          },
          query,
          terms,
          options,
        );
      }
    },
  );

  await loadEachDate(
    repo,
    "activities",
    (date) => repo.loadActivity(date),
    (date, activity) => {
      for (const entry of activity.entries ?? []) {
        if (!visibleTask(entry.task_id)) continue;
        const task = tasksById.get(entry.task_id);
        addMatch(
          matches,
          {
            task_id: entry.task_id,
            title: entry.title ?? task?.title,
            project: entry.project ?? task?.project,
            date,
            path: repo.layoutPath("activities", `${date}.yaml`),
            section: "activity",
            text: textFields(entry).join(" "),
            score_bonus: 3,
          },
          query,
          terms,
          options,
        );
      }
    },
  );

  await loadEachDate(
    repo,
    "reports",
    (date) => repo.loadReport(date),
    (date, report) => {
      for (const entry of report.entries ?? []) {
        if (!visibleTask(entry.task_id)) continue;
        const task = tasksById.get(entry.task_id);
        addMatch(
          matches,
          {
            task_id: entry.task_id,
            title: task?.title,
            project: task?.project,
            date,
            path: repo.layoutPath("reports", `${date}.yaml`),
            section: "report",
            text: textFields(entry).join(" "),
            score_bonus: 2,
          },
          query,
          terms,
          options,
        );
      }
    },
  );

  await loadEachDate(
    repo,
    "reportSummaries",
    (date) => repo.loadReportSummary(date),
    (date, summary) => {
      addMatch(
        matches,
        {
          date,
          path: repo.layoutPath("reportSummaries", `${date}.yaml`),
          section: "report_summary",
          text: textFields(summary).join(" "),
          score_bonus: 4,
        },
        query,
        terms,
        options,
      );
    },
  );

  await loadEachDate(
    repo,
    "memorySummaries",
    (date) => repo.loadMemorySummaries(date),
    (date, document) => {
      for (const summary of document.summaries ?? []) {
        if (!visibleTask(summary.task_id)) continue;
        const task = summary.task_id ? tasksById.get(summary.task_id) : undefined;
        addMatch(
          matches,
          {
            task_id: summary.task_id,
            title: task?.title,
            project: task?.project,
            date,
            path: repo.layoutPath("memorySummaries", `${date}.yaml`),
            section: "memory_summary",
            text: textFields(summary).join(" "),
            score_bonus: 5,
          },
          query,
          terms,
          options,
        );
      }
    },
  );

  await loadEachDate(
    repo,
    "agentUpdates",
    (date) => repo.loadAgentUpdates(date),
    (date, document) => {
      for (const update of document.updates ?? []) {
        if (!visibleTask(update.task_id)) continue;
        const task = update.task_id ? tasksById.get(update.task_id) : undefined;
        addMatch(
          matches,
          {
            task_id: update.task_id,
            title: update.title ?? task?.title,
            project: update.project ?? task?.project,
            date,
            path: repo.layoutPath("agentUpdates", `${date}.yaml`),
            section: "agent_update",
            text: textFields(update).join(" "),
            score_bonus: 3,
          },
          query,
          terms,
          options,
        );
      }
    },
  );

  return matches.sort((a, b) => b.score - a.score).slice(0, options.limit);
}

/**
 * Performs the public `taskById` operation provided by this module.
 *
 * このモジュールが提供する公開操作`taskById`を実行します。
 */
export function taskById(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map((task) => [task.id, task]));
}
