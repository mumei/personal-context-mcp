/**
 * Provides situation capabilities for the application layer.
 * Responsibility: This module owns the situation behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * application層のsituation機能を提供します。
 * 責務: このモジュールは、ここで宣言するsituationの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { dateDaysAgo } from "#shared/date";
import type { Repository } from "#infra/repository/repository";
import type {
  AgentUpdate,
  HandoffAttentionItem,
  HandoffAttentionReason,
  SituationItem,
  SourceRef,
  Task,
  TaskMemoryDocument,
  UserSituation,
} from "#shared/types";
import { activeTasks, isTaskDeleted } from "#domain/tasks/state";

function sourceRef(task_id: string | undefined, path: string, date?: string): SourceRef {
  return { task_id, path, date };
}

function pushItems(
  target: SituationItem[],
  values: string[] | undefined,
  task: Task | undefined,
  path: string,
  date?: string,
): void {
  for (const text of values ?? []) {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      target.push({
        task_id: task?.id,
        title: task?.title,
        text: trimmed,
        source_refs: [sourceRef(task?.id, path, date)],
      });
    }
  }
}

interface NextActionCandidate {
  item: SituationItem;
  timestamp: number;
  activity: boolean;
  order: number;
}

function validTimestamp(...values: Array<string | undefined>): number {
  for (const value of values) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return Number.NEGATIVE_INFINITY;
}

function pushNextActions(
  target: NextActionCandidate[],
  values: string[] | undefined,
  task: Task | undefined,
  path: string,
  date: string | undefined,
  timestamp: number,
  activity: boolean,
): void {
  const items: SituationItem[] = [];
  pushItems(items, values, task, path, date);
  const order = target.length;
  target.push(...items.map((item) => ({ item, timestamp, activity, order })));
}

function selectNextActions(candidates: NextActionCandidate[], preferredTaskId?: string): SituationItem[] {
  const ranked = [...candidates].sort((left, right) => {
    const focus = preferredTaskId
      ? Number(right.item.task_id === preferredTaskId) - Number(left.item.task_id === preferredTaskId)
      : 0;
    if (focus !== 0) return focus;
    // Missing dates are not "today". Undated Memory must not displace recent Activity.
    if (left.timestamp !== right.timestamp) return left.timestamp > right.timestamp ? -1 : 1;
    return Number(right.activity) - Number(left.activity) || right.order - left.order;
  });
  const unique = new Map<string, SituationItem>();
  for (const { item } of ranked) {
    const key = JSON.stringify([item.task_id, item.text.replace(/\s+/gu, " ")]);
    const previous = unique.get(key);
    if (!previous) {
      unique.set(key, { ...item, source_refs: [...item.source_refs] });
      continue;
    }
    // Keep a bounded set of supporting sources without spending another item slot on duplicates.
    for (const ref of item.source_refs) {
      if (previous.source_refs.length >= 3) break;
      if (!previous.source_refs.some((existing) => existing.path === ref.path && existing.date === ref.date)) {
        previous.source_refs.push(ref);
      }
    }
  }
  return [...unique.values()].slice(0, 20);
}

function hasTextItems(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim().length > 0);
}

function hasTaskMemoryContent(memory: TaskMemoryDocument): boolean {
  return (
    hasTextItems(memory.summary) ||
    hasTextItems(memory.facts) ||
    hasTextItems(memory.decisions) ||
    hasTextItems(memory.risks) ||
    hasTextItems(memory.next) ||
    Boolean(memory.mindmap?.root.trim())
  );
}

function attentionPriority(item: HandoffAttentionItem): number {
  return item.reasons.includes("overdue") ? 0 : item.reasons.length > 1 ? 1 : 2;
}

/**
 * Performs the public `getUserSituation` operation provided by this module.
 *
 * このモジュールが提供する公開操作`getUserSituation`を実行します。
 */
export async function getUserSituation(
  repo: Repository,
  date: string,
  lookbackDays: number,
  preferredTaskId?: string,
  scope?: { taskId?: string; includeGlobalMemory?: boolean },
): Promise<UserSituation> {
  const tasksDoc = await repo.loadTasks();
  const scopedTasks = tasksDoc.tasks.filter((task) => !scope?.taskId || task.id === scope.taskId);
  const currentTasks = activeTasks(scopedTasks);
  const tasksById = new Map(tasksDoc.tasks.map((task) => [task.id, task]));
  const active_tasks = currentTasks.filter((task) => task.status !== "done");
  const waiting_or_blocked = currentTasks.filter((task) => task.status === "waiting" || task.status === "blocked");

  const recent_done: SituationItem[] = [];
  const nextActions: NextActionCandidate[] = [];
  const decisions: SituationItem[] = [];
  const confirmations: SituationItem[] = [];
  const context_notes: SituationItem[] = [];
  const global_context_notes: SituationItem[] = [];
  const source_refs: SourceRef[] = [];
  const activeTaskIds = new Set(active_tasks.map((task) => task.id));
  const recentActivityTaskIds = new Set<string>();
  const nextActionTaskIds = new Set<string>();
  const latestActivityByTask = new Map<string, string>();
  const start = dateDaysAgo(date, lookbackDays);
  const activityDates = (await repo.listYamlDates(repo.layoutName("activities"))).filter(
    (activityDate) => activityDate >= start && activityDate <= date,
  );

  for (const activityDate of activityDates) {
    const activity = await repo.loadActivity(activityDate);
    const path = repo.layoutPath("activities", `${activityDate}.yaml`);
    for (const entry of activity.entries) {
      if (scope?.taskId && entry.task_id !== scope.taskId) continue;
      const task = tasksById.get(entry.task_id);
      if (isTaskDeleted(task)) continue;
      if (activeTaskIds.has(entry.task_id)) {
        recentActivityTaskIds.add(entry.task_id);
        const previousDate = latestActivityByTask.get(entry.task_id);
        if (!previousDate || previousDate < activityDate) latestActivityByTask.set(entry.task_id, activityDate);
        if (hasTextItems(entry.next)) nextActionTaskIds.add(entry.task_id);
      }
      pushItems(recent_done, entry.done, task, path, activityDate);
      pushNextActions(
        nextActions,
        entry.next,
        task,
        path,
        activityDate,
        validTimestamp(entry.occurred_at, entry.recorded_at, activityDate),
        true,
      );
      pushItems(confirmations, entry.confirm, task, path, activityDate);
      pushItems(context_notes, entry.compact_summary, task, path, activityDate);
    }
  }

  const globalMemory =
    scope && !scope.includeGlobalMemory ? { summary: [], preferences: [], rules: [] } : await repo.loadGlobalMemory();
  pushItems(global_context_notes, globalMemory.summary, undefined, repo.layoutPath("globalMemory"), date);
  pushItems(global_context_notes, globalMemory.preferences, undefined, repo.layoutPath("globalMemory"), date);
  pushItems(global_context_notes, globalMemory.rules, undefined, repo.layoutPath("globalMemory"), date);

  const taskMemories = await Promise.all(
    active_tasks.map(async (task) => ({ task, memory: await repo.loadTaskMemory(task.id) })),
  );
  const taskMemoryTaskIds = new Set<string>();
  const decisionTaskIds = new Set<string>();
  for (const { task, memory } of taskMemories) {
    const path = repo.layoutPath("taskMemory", `${task.id}.yaml`);
    const memoryDate = Number.isFinite(validTimestamp(memory.updated_at)) ? memory.updated_at?.slice(0, 10) : undefined;
    if (hasTaskMemoryContent(memory)) taskMemoryTaskIds.add(task.id);
    if (hasTextItems(memory.decisions)) decisionTaskIds.add(task.id);
    if (hasTextItems(memory.next)) nextActionTaskIds.add(task.id);
    pushItems(context_notes, memory.summary, task, path, memoryDate);
    pushItems(context_notes, memory.decisions, task, path, memoryDate);
    pushItems(decisions, memory.decisions, task, path, memoryDate);
    pushItems(context_notes, memory.risks, task, path, memoryDate);
    pushNextActions(nextActions, memory.next, task, path, memoryDate, validTimestamp(memory.updated_at), false);
  }

  const agentDates = (await repo.listYamlDates(repo.layoutName("agentUpdates"))).filter(
    (agentDate) => agentDate >= start && agentDate <= date,
  );
  const pending_agent_updates: AgentUpdate[] = [];
  for (const agentDate of agentDates) {
    const doc = await repo.loadAgentUpdates(agentDate);
    pending_agent_updates.push(
      ...doc.updates.filter(
        (update) =>
          (!scope?.taskId || update.task_id === scope.taskId) &&
          (update.status === "pending" || update.status === "needs_review"),
      ),
    );
  }

  for (const task of active_tasks.slice(0, 20)) {
    source_refs.push(sourceRef(task.id, repo.layoutPath("tasks")));
  }
  source_refs.push(sourceRef(undefined, repo.layoutPath("globalMemory")));

  const withCompactSummary = new Set(
    active_tasks.filter((task) => hasTextItems(task.compact_summary)).map((task) => task.id),
  );
  const attention = active_tasks
    .map((task): HandoffAttentionItem | undefined => {
      const reasons: HandoffAttentionReason[] = [];
      if (typeof task.due === "string" && task.due < date) reasons.push("overdue");
      if (!withCompactSummary.has(task.id)) reasons.push("missing_compact_summary");
      if (!recentActivityTaskIds.has(task.id)) reasons.push("no_recent_activity");
      if (!nextActionTaskIds.has(task.id)) reasons.push("missing_next_action");
      if (!taskMemoryTaskIds.has(task.id)) reasons.push("missing_task_memory");
      if (!decisionTaskIds.has(task.id)) reasons.push("missing_decision");
      if (reasons.length === 0) return undefined;
      return {
        task_id: task.id,
        title: task.title,
        ...(task.status ? { status: task.status } : {}),
        ...(task.due !== undefined ? { due: task.due } : {}),
        ...(latestActivityByTask.has(task.id)
          ? { latest_activity_date: latestActivityByTask.get(task.id) as string }
          : {}),
        reasons,
        source_refs: [sourceRef(task.id, repo.layoutPath("tasks"))],
      };
    })
    .filter((item): item is HandoffAttentionItem => Boolean(item))
    .sort((left, right) => {
      const priority = attentionPriority(left) - attentionPriority(right);
      if (priority !== 0) return priority;
      const due = (left.due ?? "9999-99-99").localeCompare(right.due ?? "9999-99-99");
      return due !== 0 ? due : left.task_id.localeCompare(right.task_id);
    });

  // Keep the overall response bounded while reserving capacity for task-specific handoff context.
  const globalNotes = global_context_notes.slice(0, 10);
  const taskContextLimit = Math.max(0, 20 - globalNotes.length);
  const taskContextNotes = taskContextLimit > 0 ? context_notes.slice(-taskContextLimit) : [];

  return {
    date,
    summary: `${active_tasks.length} active tasks, ${waiting_or_blocked.length} waiting or blocked tasks, ${pending_agent_updates.length} pending agent updates.`,
    active_tasks,
    waiting_or_blocked,
    recent_done: recent_done.slice(-20),
    next_actions: selectNextActions(nextActions, preferredTaskId),
    decisions: decisions.slice(-20),
    confirmations: confirmations.slice(-20),
    pending_agent_updates,
    global_memory: globalMemory,
    context_notes: [...globalNotes, ...taskContextNotes],
    handoff_health: {
      active_count: active_tasks.length,
      with_compact_summary_count: withCompactSummary.size,
      with_recent_activity_count: recentActivityTaskIds.size,
      with_next_action_count: nextActionTaskIds.size,
      with_task_memory_count: taskMemoryTaskIds.size,
      with_decision_count: decisionTaskIds.size,
      overdue_count: attention.filter((item) => item.reasons.includes("overdue")).length,
      attention_count: attention.length,
      attention: attention.slice(0, 20),
    },
    source_refs,
  };
}
