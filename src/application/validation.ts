/**
 * Provides validation capabilities for the application layer.
 * Responsibility: This module owns the validation behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * application層のvalidation機能を提供します。
 * 責務: このモジュールは、ここで宣言するvalidationの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "#infra/repository/repository";
import type { Task } from "#shared/types";
import { buildTaskActivityIdentityMap } from "#domain/tasks/identity";

/**
 * Defines the public `ValidationIssue` data contract exposed by this module.
 *
 * このモジュールが公開する`ValidationIssue`データ契約を定義します。
 */
export interface ValidationIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
  task_id?: string;
  date?: string;
}

/**
 * Defines the public `ValidationResult` data contract exposed by this module.
 *
 * このモジュールが公開する`ValidationResult`データ契約を定義します。
 */
export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addStructureIssue(issues: ValidationIssue[], path: string, message: string, date?: string): void {
  issues.push({ severity: "error", path, date, message: `Invalid document structure: ${message}` });
}

function addUnknownTaskIssue(
  issues: ValidationIssue[],
  path: string,
  date: string,
  taskId: unknown,
  source: string,
): void {
  if (typeof taskId === "string" && taskId.length > 0) {
    issues.push({
      severity: "warning",
      path,
      task_id: taskId,
      date,
      message: `${source} references unknown task_id: ${taskId}`,
    });
  }
}

async function listFiles(directory: string, suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          return listFiles(path, suffix);
        }
        return entry.isFile() && entry.name.endsWith(suffix) ? [path] : [];
      }),
    );
    return files.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function listDates(
  repo: Repository,
  layout: Parameters<Repository["layoutName"]>[0],
  issues: ValidationIssue[],
): Promise<string[]> {
  try {
    return await repo.listYamlDates(repo.layoutName(layout));
  } catch (error) {
    issues.push({
      severity: "error",
      path: repo.layoutPath(layout),
      message: `Cannot list documents: ${errorMessage(error)}`,
    });
    return [];
  }
}

function validateDatedDocument(
  issues: ValidationIssue[],
  path: string,
  expectedDate: string,
  document: unknown,
  collectionKey: string,
): UnknownRecord | undefined {
  if (!isRecord(document)) {
    addStructureIssue(issues, path, "document must be an object", expectedDate);
    return undefined;
  }
  if (document.date !== expectedDate) {
    addStructureIssue(issues, path, `date must equal filename date ${expectedDate}`, expectedDate);
  }
  if (!Array.isArray(document[collectionKey])) {
    addStructureIssue(issues, path, `${collectionKey} must be an array`, expectedDate);
    return undefined;
  }
  return document;
}

/**
 * Performs the public `validateData` operation provided by this module.
 *
 * このモジュールが提供する公開操作`validateData`を実行します。
 */
export async function validateData(repo: Repository): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const tasksPath = repo.layoutPath("tasks");
  let tasksDocument: unknown;
  try {
    tasksDocument = await repo.loadTasks();
  } catch (error) {
    issues.push({ severity: "error", path: tasksPath, message: `Tasks cannot be read: ${errorMessage(error)}` });
  }

  const rawTasks = isRecord(tasksDocument) && Array.isArray(tasksDocument.tasks) ? tasksDocument.tasks : [];
  if (tasksDocument !== undefined && (!isRecord(tasksDocument) || !Array.isArray(tasksDocument.tasks))) {
    addStructureIssue(issues, tasksPath, "tasks must be an array");
  }

  const tasks: Task[] = [];
  for (const rawTask of rawTasks) {
    if (!isRecord(rawTask)) {
      addStructureIssue(issues, tasksPath, "each task must be an object");
      continue;
    }
    const id = rawTask.id;
    const title = rawTask.title;
    if (typeof id !== "string" || id.length === 0 || typeof title !== "string" || title.length === 0) {
      issues.push({
        severity: "error",
        path: tasksPath,
        task_id: typeof id === "string" ? id : undefined,
        message: "Task must have both id and title.",
      });
      continue;
    }
    tasks.push(rawTask as Task);
  }

  const taskIds = tasks.map((task) => task.id);
  const taskIdSet = new Set(taskIds);
  let activityTaskIdSet = taskIdSet;
  for (const id of duplicateValues(taskIds)) {
    issues.push({ severity: "error", path: tasksPath, task_id: id, message: `Duplicate task id: ${id}` });
  }
  try {
    activityTaskIdSet = new Set(buildTaskActivityIdentityMap(tasks).keys());
  } catch (error) {
    issues.push({ severity: "error", path: tasksPath, message: errorMessage(error) });
  }

  try {
    const globalMemory = await repo.loadGlobalMemory();
    if (!isRecord(globalMemory)) {
      addStructureIssue(issues, repo.layoutPath("globalMemory"), "global memory must be an object");
    }
  } catch (error) {
    issues.push({
      severity: "error",
      path: repo.layoutPath("globalMemory"),
      message: `Global memory cannot be read: ${errorMessage(error)}`,
    });
  }

  const expectedContextPaths = new Set<string>();
  const expectedMemoryPaths = new Set<string>();
  for (const task of tasks) {
    try {
      const contextPath = repo.contextPathFor(task);
      expectedContextPaths.add(contextPath);
      const context = await repo.loadTaskContext(task);
      if (!isRecord(context.data) || typeof context.body !== "string") {
        addStructureIssue(issues, contextPath, "context frontmatter must be an object and body must be text");
      }
    } catch (error) {
      issues.push({
        severity: "error",
        path: (() => {
          try {
            return repo.contextPathFor(task);
          } catch {
            return repo.layoutPath("contexts");
          }
        })(),
        task_id: task.id,
        message: `Context cannot be read: ${errorMessage(error)}`,
      });
    }

    const memoryPath = repo.layoutPath("taskMemory", `${task.id}.yaml`);
    expectedMemoryPaths.add(memoryPath);
    try {
      const memory = await repo.loadTaskMemory(task.id);
      if (!isRecord(memory) || typeof memory.task_id !== "string") {
        addStructureIssue(issues, memoryPath, "task memory must be an object with task_id", undefined);
      } else if (memory.task_id !== task.id) {
        issues.push({
          severity: "warning",
          path: memoryPath,
          task_id: memory.task_id,
          message: `Task memory task_id does not match filename/task: expected ${task.id}`,
        });
      }
    } catch (error) {
      issues.push({
        severity: "error",
        path: memoryPath,
        task_id: task.id,
        message: `Task memory cannot be read: ${errorMessage(error)}`,
      });
    }
  }

  try {
    const contextFiles = await listFiles(repo.layoutPath("contexts"), ".md");
    for (const path of contextFiles) {
      if (!expectedContextPaths.has(path)) {
        issues.push({ severity: "warning", path, message: "Orphan context is not referenced by any task." });
      }
    }
    const memoryFiles = await listFiles(repo.layoutPath("taskMemory"), ".yaml");
    for (const path of memoryFiles) {
      if (!expectedMemoryPaths.has(path)) {
        issues.push({ severity: "warning", path, message: "Orphan task memory is not referenced by any task." });
      }
    }
  } catch (error) {
    issues.push({
      severity: "error",
      path: repo.root,
      message: `Cannot inspect context or memory files: ${errorMessage(error)}`,
    });
  }

  const inputDates = await listDates(repo, "inputs", issues);
  for (const date of inputDates) {
    const path = repo.layoutPath("inputs", `${date}.yaml`);
    try {
      const document = validateDatedDocument(issues, path, date, await repo.loadInputs(date), "items");
      if (!document) continue;
      for (const item of document.items as unknown[]) {
        if (!isRecord(item) || typeof item.title !== "string" || item.title.length === 0) {
          addStructureIssue(issues, path, "each input item must have a title", date);
          continue;
        }
        if (typeof item.related_task_id === "string" && !taskIdSet.has(item.related_task_id)) {
          addUnknownTaskIssue(issues, path, date, item.related_task_id, "Input item");
        }
      }
    } catch (error) {
      issues.push({ severity: "error", path, date, message: `Inputs cannot be read: ${errorMessage(error)}` });
    }
  }

  const activityDates = await listDates(repo, "activities", issues);
  for (const date of activityDates) {
    const path = repo.layoutPath("activities", `${date}.yaml`);
    try {
      const document = validateDatedDocument(issues, path, date, await repo.loadActivity(date), "entries");
      if (!document) continue;
      for (const entry of document.entries as unknown[]) {
        if (!isRecord(entry) || typeof entry.task_id !== "string" || entry.task_id.length === 0) {
          addStructureIssue(issues, path, "each activity entry must have task_id", date);
        } else if (!activityTaskIdSet.has(entry.task_id)) {
          addUnknownTaskIssue(issues, path, date, entry.task_id, "Activity entry");
        }
      }
    } catch (error) {
      issues.push({ severity: "error", path, date, message: `Activity cannot be read: ${errorMessage(error)}` });
    }
  }

  const reportDates = await listDates(repo, "reports", issues);
  for (const date of reportDates) {
    const path = repo.layoutPath("reports", `${date}.yaml`);
    try {
      const document = validateDatedDocument(issues, path, date, await repo.loadReport(date), "entries");
      if (!document) continue;
      for (const entry of document.entries as unknown[]) {
        if (!isRecord(entry) || typeof entry.task_id !== "string" || entry.task_id.length === 0) {
          addStructureIssue(issues, path, "each report entry must have task_id", date);
        } else if (!taskIdSet.has(entry.task_id)) {
          addUnknownTaskIssue(issues, path, date, entry.task_id, "Report entry");
        }
      }
    } catch (error) {
      issues.push({ severity: "error", path, date, message: `Report cannot be read: ${errorMessage(error)}` });
    }
  }

  const summaryDates = await listDates(repo, "reportSummaries", issues);
  for (const date of summaryDates) {
    const path = repo.layoutPath("reportSummaries", `${date}.yaml`);
    try {
      const document = await repo.loadReportSummary(date);
      if (!isRecord(document)) {
        addStructureIssue(issues, path, "document must be an object", date);
      } else if (document.date !== date) {
        addStructureIssue(issues, path, `date must equal filename date ${date}`, date);
      }
    } catch (error) {
      issues.push({ severity: "error", path, date, message: `Report summary cannot be read: ${errorMessage(error)}` });
    }
  }

  const memorySummaryDates = await listDates(repo, "memorySummaries", issues);
  for (const date of memorySummaryDates) {
    const path = repo.layoutPath("memorySummaries", `${date}.yaml`);
    try {
      const document = validateDatedDocument(issues, path, date, await repo.loadMemorySummaries(date), "summaries");
      if (!document) continue;
      for (const summary of document.summaries as unknown[]) {
        if (!isRecord(summary) || typeof summary.summary_id !== "string" || typeof summary.target_type !== "string") {
          addStructureIssue(issues, path, "each memory summary must have summary_id and target_type", date);
          continue;
        }
        if (summary.target_type === "task" && (typeof summary.task_id !== "string" || summary.task_id.length === 0)) {
          addStructureIssue(issues, path, "task memory summary must have task_id", date);
        } else if (typeof summary.task_id === "string" && !taskIdSet.has(summary.task_id)) {
          addUnknownTaskIssue(issues, path, date, summary.task_id, "Memory summary");
        }
      }
    } catch (error) {
      issues.push({
        severity: "error",
        path,
        date,
        message: `Memory summaries cannot be read: ${errorMessage(error)}`,
      });
    }
  }

  const agentUpdateDates = await listDates(repo, "agentUpdates", issues);
  for (const date of agentUpdateDates) {
    const path = repo.layoutPath("agentUpdates", `${date}.yaml`);
    try {
      const document = validateDatedDocument(issues, path, date, await repo.loadAgentUpdates(date), "updates");
      if (!document) continue;
      for (const update of document.updates as unknown[]) {
        if (
          !isRecord(update) ||
          typeof update.update_id !== "string" ||
          typeof update.session_id !== "string" ||
          typeof update.source !== "string" ||
          typeof update.summary !== "string"
        ) {
          addStructureIssue(
            issues,
            path,
            "each agent update must have update_id, session_id, source, and summary",
            date,
          );
          continue;
        }
        if (typeof update.task_id === "string" && !taskIdSet.has(update.task_id)) {
          addUnknownTaskIssue(issues, path, date, update.task_id, "Agent update");
        }
      }
    } catch (error) {
      issues.push({ severity: "error", path, date, message: `Agent updates cannot be read: ${errorMessage(error)}` });
    }
  }

  return { ok: issues.every((issue) => issue.severity !== "error"), issues };
}
