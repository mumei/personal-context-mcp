/**
 * Provides actions capabilities for the domain layer.
 * Responsibility: This module owns the actions behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * domain層のactions機能を提供します。
 * 責務: このモジュールは、ここで宣言するactionsの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import type { Repository } from "#infra/repository/repository";
import type { FrontmatterDocument, SaveResult, Task, TaskStatus, TaskTier } from "#shared/types";
import { isTaskDeleted } from "#domain/tasks/state";
import { buildTaskActivityIdentityMap } from "#domain/tasks/identity";

/**
 * Defines the public `AddTaskInput` data contract exposed by this module.
 *
 * このモジュールが公開する`AddTaskInput`データ契約を定義します。
 */
export interface AddTaskInput {
  id: string;
  title: string;
  project?: string;
  tier?: TaskTier;
  status?: TaskStatus;
  due?: string | null;
  context?: string;
  compact_summary?: string[];
  context_body?: string;
  report_exclude?: boolean;
  cadence?: string;
  activity_aliases?: string[];
}

/**
 * Defines the public `AddTaskResult` data contract exposed by this module.
 *
 * このモジュールが公開する`AddTaskResult`データ契約を定義します。
 */
export interface AddTaskResult {
  task: Task;
  tasksSave: SaveResult;
  contextSave?: SaveResult;
}

/**
 * Defines the public `UpdateTaskInput` data contract exposed by this module.
 *
 * このモジュールが公開する`UpdateTaskInput`データ契約を定義します。
 */
export interface UpdateTaskInput {
  task_id: string;
  title?: string;
  project?: string;
  tier?: TaskTier;
  status?: TaskStatus;
  due?: string | null;
  completed_on?: string | null;
  blocked_by?: string[];
  report_exclude?: boolean;
  cadence?: string;
  activity_aliases?: string[];
  fields_to_clear?: Array<
    "project" | "tier" | "due" | "completed_on" | "blocked_by" | "report_exclude" | "cadence" | "activity_aliases"
  >;
}

/**
 * Defines the public `UpdateTaskResult` data contract exposed by this module.
 *
 * このモジュールが公開する`UpdateTaskResult`データ契約を定義します。
 */
export interface UpdateTaskResult {
  task: Task;
  save: SaveResult;
}

/**
 * Defines the public `SetTaskDeletedResult` data contract exposed by this module.
 *
 * このモジュールが公開する`SetTaskDeletedResult`データ契約を定義します。
 */
export interface SetTaskDeletedResult {
  task: Task;
  save: SaveResult;
}

/**
 * Defines the result of changing whether one task participates in generated reports.
 *
 * 1タスクを生成レポートへ含めるかどうか変更した結果を定義します。
 */
export interface SetTaskReportVisibilityResult {
  task: Task;
  visible: boolean;
  save: SaveResult;
}

/**
 * Defines the public `ReplaceTaskCompactSummaryInput` data contract exposed by this module.
 *
 * このモジュールが公開する`ReplaceTaskCompactSummaryInput`データ契約を定義します。
 */
export interface ReplaceTaskCompactSummaryInput {
  task_id: string;
  compact_summary: string[];
}

/**
 * Defines the public `ReplaceTaskCompactSummariesResult` data contract exposed by this module.
 *
 * このモジュールが公開する`ReplaceTaskCompactSummariesResult`データ契約を定義します。
 */
export interface ReplaceTaskCompactSummariesResult {
  tasks: Task[];
  save: SaveResult;
}

/**
 * Defines the public `ContextBodyMode` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`ContextBodyMode`を定義します。
 */
export type ContextBodyMode = "preserve" | "replace" | "append";

/**
 * Defines the public `UpdateTaskContextInput` data contract exposed by this module.
 *
 * このモジュールが公開する`UpdateTaskContextInput`データ契約を定義します。
 */
export interface UpdateTaskContextInput {
  task_id: string;
  compact_summary?: string[];
  sources?: string[];
  frontmatter?: Record<string, unknown>;
  body?: string;
  body_mode?: ContextBodyMode;
  fields_to_clear?: string[];
}

/**
 * Defines the public `UpdateTaskContextResult` data contract exposed by this module.
 *
 * このモジュールが公開する`UpdateTaskContextResult`データ契約を定義します。
 */
export interface UpdateTaskContextResult {
  context: FrontmatterDocument;
  save: SaveResult;
}

function taskContextDocument(input: AddTaskInput): FrontmatterDocument {
  return {
    data: {
      ...(input.compact_summary ? { compact_summary: input.compact_summary } : {}),
    },
    body: input.context_body ?? "",
  };
}

/**
 * Performs the public `addTask` operation provided by this module.
 *
 * このモジュールが提供する公開操作`addTask`を実行します。
 */
export async function addTask(repo: Repository, input: AddTaskInput): Promise<AddTaskResult> {
  return repo.withTransaction(async () => {
    const id = input.id.trim();
    const title = input.title.trim();
    if (id.length === 0) {
      throw new Error("Task id is required.");
    }
    if (title.length === 0) {
      throw new Error("Task title is required.");
    }

    const doc = await repo.loadTasks();
    if (doc.tasks.some((task) => task.id === id)) {
      throw new Error(`Task already exists: ${id}`);
    }

    const task: Task = {
      id,
      title,
      status: input.status ?? "todo",
      ...(input.project ? { project: input.project } : {}),
      ...(input.tier ? { tier: input.tier } : {}),
      ...(input.due !== undefined ? { due: input.due } : {}),
      ...(input.context ? { context: input.context } : { context: `${repo.layoutName("contexts")}/${id}.md` }),
      ...(input.report_exclude !== undefined ? { report_exclude: input.report_exclude } : {}),
      ...(input.cadence ? { cadence: input.cadence } : {}),
      ...(input.activity_aliases?.length ? { activity_aliases: input.activity_aliases } : {}),
    };

    const contextSave = await repo.saveTaskContext(task, taskContextDocument(input), "add-task-context");
    doc.tasks.push(task);
    buildTaskActivityIdentityMap(doc.tasks);
    const tasksSave = await repo.saveTasks(doc, "add-task");

    return {
      task,
      tasksSave,
      contextSave,
    };
  });
}

function findTask(doc: { tasks: Task[] }, taskId: string, includeDeleted = false): Task {
  const task = doc.tasks.find((item) => item.id === taskId);
  if (!task || (!includeDeleted && isTaskDeleted(task))) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return task;
}

/**
 * Performs the public `deleteTask` operation provided by this module.
 *
 * このモジュールが提供する公開操作`deleteTask`を実行します。
 */
export async function deleteTask(repo: Repository, taskId: string): Promise<SetTaskDeletedResult> {
  return repo.withTransaction(async () => {
    const doc = await repo.loadTasks();
    const task = findTask(doc, taskId, true);
    if (isTaskDeleted(task)) {
      return { task, save: { changed: false, path: repo.layoutPath("tasks") } };
    }
    task.deleted = true;
    const save = await repo.saveTasks(doc, "delete-task");
    return { task, save };
  });
}

/**
 * Performs the public `restoreTask` operation provided by this module.
 *
 * このモジュールが提供する公開操作`restoreTask`を実行します。
 */
export async function restoreTask(repo: Repository, taskId: string): Promise<SetTaskDeletedResult> {
  return repo.withTransaction(async () => {
    const doc = await repo.loadTasks();
    const task = findTask(doc, taskId, true);
    if (!isTaskDeleted(task)) {
      return { task, save: { changed: false, path: repo.layoutPath("tasks") } };
    }
    delete task.deleted;
    const save = await repo.saveTasks(doc, "restore-task");
    return { task, save };
  });
}

/**
 * Includes or excludes one task from reports without changing its Activity, Context, or Task Memory.
 *
 * Activity、Context、Task Memoryを変更せず、1タスクをレポートの対象に含めるか除外します。
 */
export async function setTaskReportVisibility(
  repo: Repository,
  taskId: string,
  visible: boolean,
): Promise<SetTaskReportVisibilityResult> {
  return repo.withTransaction(async () => {
    const doc = await repo.loadTasks();
    const task = findTask(doc, taskId);
    if (visible) {
      delete task.report_exclude;
    } else {
      task.report_exclude = true;
    }
    const save = await repo.saveTasks(doc, visible ? "include-task-in-reports" : "exclude-task-from-reports");
    return { task, visible, save };
  });
}

/**
 * Performs the public `updateTask` operation provided by this module.
 *
 * このモジュールが提供する公開操作`updateTask`を実行します。
 */
export async function updateTask(repo: Repository, input: UpdateTaskInput): Promise<UpdateTaskResult> {
  return repo.withTransaction(async () => {
    const doc = await repo.loadTasks();
    const task = findTask(doc, input.task_id);

    if (input.status === "done" && input.completed_on === undefined && !task.completed_on) {
      throw new Error("completed_on is required when changing a task to done.");
    }

    if (input.title !== undefined) task.title = input.title;
    if (input.project !== undefined) task.project = input.project;
    if (input.tier !== undefined) task.tier = input.tier;
    if (input.status !== undefined) task.status = input.status;
    if (input.due !== undefined) task.due = input.due;
    if (input.completed_on !== undefined) task.completed_on = input.completed_on;
    if (input.blocked_by !== undefined) task.blocked_by = input.blocked_by;
    if (input.report_exclude !== undefined) task.report_exclude = input.report_exclude;
    if (input.cadence !== undefined) task.cadence = input.cadence;
    if (input.activity_aliases !== undefined) {
      task.activity_aliases = [...new Set(input.activity_aliases.map((alias) => alias.trim()))];
    }

    for (const field of input.fields_to_clear ?? []) {
      delete task[field];
    }
    if (input.status !== undefined && input.status !== "done" && input.completed_on === undefined) {
      delete task.completed_on;
    }
    if (task.status === "done" && !task.completed_on) {
      throw new Error("A done task must have completed_on.");
    }
    buildTaskActivityIdentityMap(doc.tasks);

    const save = await repo.saveTasks(doc, "update-task");
    return { task, save };
  });
}

/**
 * Performs the public `replaceTaskCompactSummaries` operation provided by this module.
 *
 * このモジュールが提供する公開操作`replaceTaskCompactSummaries`を実行します。
 */
export async function replaceTaskCompactSummaries(
  repo: Repository,
  inputs: ReplaceTaskCompactSummaryInput[],
): Promise<ReplaceTaskCompactSummariesResult> {
  return repo.withTransaction(async () => {
    const taskIds = new Set<string>();
    for (const input of inputs) {
      if (taskIds.has(input.task_id)) {
        throw new Error(`Duplicate task compact summary: ${input.task_id}`);
      }
      taskIds.add(input.task_id);
      if (input.compact_summary.length < 1 || input.compact_summary.length > 2) {
        throw new Error(`Task compact summary must contain 1-2 lines: ${input.task_id}`);
      }
    }

    const doc = await repo.loadTasks();
    const tasks = inputs.map((input) => {
      const task = findTask(doc, input.task_id);
      task.compact_summary = [...input.compact_summary];
      return task;
    });
    const save = await repo.saveTasks(doc, "replace-task-compact-summaries");
    return { tasks, save };
  });
}

/**
 * Performs the public `updateTaskContext` operation provided by this module.
 *
 * このモジュールが提供する公開操作`updateTaskContext`を実行します。
 */
export async function updateTaskContext(
  repo: Repository,
  input: UpdateTaskContextInput,
): Promise<UpdateTaskContextResult> {
  return repo.withTransaction(async () => {
    const tasks = await repo.loadTasks();
    const task = findTask(tasks, input.task_id);
    const context = await repo.loadTaskContext(task);
    const data = { ...context.data, ...(input.frontmatter ?? {}) };

    if (input.compact_summary !== undefined) {
      data.compact_summary = input.compact_summary;
    }
    if (input.sources !== undefined) {
      data.sources = input.sources;
    }
    for (const field of input.fields_to_clear ?? []) {
      delete data[field];
    }

    const mode = input.body_mode ?? "preserve";
    let body = context.body;
    if (input.body !== undefined && mode === "replace") {
      body = input.body;
    } else if (input.body !== undefined && mode === "append") {
      body = context.body.length > 0 ? `${context.body.replace(/\s+$/, "")}\n\n${input.body}` : input.body;
    }

    const updated = { data, body };
    const save = await repo.saveTaskContext(task, updated, "update-task-context");
    return { context: updated, save };
  });
}
