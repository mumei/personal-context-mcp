/**
 * @packageDocumentation
 * Collects unresolved Agent Updates, obtains AI decisions, and applies or rejects each update.
 * It does not receive Agent Updates, perform general task updates, or route HTTP requests.
 * 未解決の Agent Update を収集し、AI 判定を取得して、各更新を適用または却下する。
 * Agent Update の受付、一般的なタスク更新、HTTP リクエストのルーティングは担当しない。
 */
import type { LlmGenerator } from "#llm/types";
import { applyAgentUpdates } from "#domain/agent-updates/workflow";
import { updateAgentUpdateStatus } from "#domain/agent-updates/actions";
import { isTaskDeleted } from "#domain/tasks/state";
import { Repository } from "#infra/repository/repository";
import type { AgentUpdate, TaskMcpConfig } from "#shared/types";
import { generateWebLlm, webLlmMetadata } from "#web/llm";

function agentUpdateResolutionOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      resolutions: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          properties: {
            date: { type: "string" },
            update_id: { type: "string" },
            action: { type: "string", enum: ["apply", "reject"] },
            task_id: { type: ["string", "null"] },
            reason: { type: "string", minLength: 1, maxLength: 240 },
          },
          required: ["date", "update_id", "action", "task_id", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["resolutions"],
    additionalProperties: false,
  };
}

/**
 * Lists unresolved Agent Updates remaining on or before the specified date.
 * 指定日以前に残る未解決 Agent Update を列挙する。
 */
export async function listUnresolvedAgentUpdates(
  repo: Repository,
  throughDate: string,
): Promise<Array<{ date: string; update: AgentUpdate }>> {
  const dates = (await repo.listYamlDates(repo.layoutName("agentUpdates"))).filter((date) => date <= throughDate);
  const records: Array<{ date: string; update: AgentUpdate }> = [];
  for (const date of dates) {
    const document = await repo.loadAgentUpdates(date);
    for (const update of document.updates)
      if (update.status === "pending" || update.status === "needs_review") records.push({ date, update });
  }
  return records;
}

/**
 * Uses AI to resolve all Agent Updates through the specified date and applies or rejects them.
 * 指定日以前の未解決 Agent Update を AI で一括判定し、適用または却下する。
 */
export async function resolveWebAgentUpdatesWithAi(
  repo: Repository,
  config: TaskMcpConfig,
  date: string,
  generate: LlmGenerator = (input) => generateWebLlm(config, input),
): Promise<unknown> {
  const records = await listUnresolvedAgentUpdates(repo, date);
  const dates = [...new Set(records.map((record) => record.date))];
  if (records.length === 0)
    return {
      date,
      scope: "all_unresolved_through_date",
      resolved: 0,
      applied: 0,
      rejected: 0,
      resolutions: [],
      no_op: true,
      message: "No unresolved Agent Updates remain.",
    };
  if (records.length > 100)
    throw new Error(`Too many unresolved Agent Updates (${records.length}); resolve older updates first.`);
  const tasks = await repo.loadTasks();
  const taskIds = [
    ...new Set(records.map(({ update }) => update.task_id).filter((value): value is string => Boolean(value))),
  ];
  const taskEvidence = [];
  for (const taskId of taskIds) {
    const task = tasks.tasks.find((item) => item.id === taskId);
    const memory = await repo.loadTaskMemory(taskId);
    taskEvidence.push({
      task: task
        ? {
            id: task.id,
            title: task.title,
            project: task.project,
            status: task.status,
            compact_summary: task.compact_summary,
          }
        : { id: taskId, missing: true },
      memory: { summary: memory.summary, decisions: memory.decisions, risks: memory.risks, next: memory.next },
    });
  }
  const activities = [];
  for (const itemDate of dates) {
    const activity = await repo.loadActivity(itemDate);
    activities.push({
      date: itemDate,
      entries: activity.entries
        .filter((entry) => taskIds.includes(entry.task_id))
        .map((entry) => ({
          agent_update_id: entry.agent_update_id,
          task_id: entry.task_id,
          done: entry.done,
          next: entry.next,
          compact_summary: entry.compact_summary,
        })),
    });
  }
  const pending = records.map(({ date: itemDate, update }) => ({
    date: itemDate,
    update_id: update.update_id,
    status: update.status,
    task_id: update.task_id,
    summary: update.summary,
    done: update.done,
    next: update.next,
    context_updates: update.context_updates,
    warnings: update.warnings,
    confidence: update.confidence,
    occurred_at: update.occurred_at,
    received_at: update.received_at,
  }));
  const prompt = [
    "Resolve unresolved Personal Context MCP Agent Updates for an AI-operated memory system.",
    "Return exactly one resolution for every supplied pending update and no other update IDs.",
    "Choose apply when the update is a coherent, task-scoped work-log entry not already represented in Activity.",
    "Choose reject only when it is a duplicate, superseded by a newer update with the same meaning, missing its task, incoherent, or already represented in Activity.",
    "Do not reject merely because an update is old. Preserve distinct journal events even when they concern the same task and date.",
    "For repeated monitoring snapshots, apply the latest meaningful state and reject older snapshots only when the newer update fully supersedes them.",
    "needs_review is not itself a reason to reject; assess its content and warnings.",
    "Return task_id for every apply action. Preserve an existing valid task_id. For a missing or invalid task_id, infer an active task only when project, title, session, sources, neighboring updates, and task evidence strongly support the match.",
    "If no active task can be identified confidently, choose reject and return task_id as null instead of failing the whole batch.",
    "Reasons must be concise Japanese and grounded in the supplied evidence.",
    "Return only JSON matching {resolutions:[{date,update_id,action,task_id,reason}]}.",
    JSON.stringify({
      pending_updates: pending,
      existing_activities: activities,
      task_evidence: taskEvidence,
      candidate_tasks: tasks.tasks
        .filter((task) => !isTaskDeleted(task))
        .map((task) => ({ id: task.id, title: task.title, project: task.project, status: task.status })),
    }),
  ].join("\n");
  const generated = await generate({ prompt, cwd: process.cwd(), outputSchema: agentUpdateResolutionOutputSchema() });
  const parsed = JSON.parse(
    generated.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  ) as {
    resolutions?: Array<{ date?: unknown; update_id?: unknown; action?: unknown; task_id?: unknown; reason?: unknown }>;
  };
  if (!Array.isArray(parsed.resolutions)) throw new Error("AI resolution returned no resolutions.");
  const expected = new Map(records.map((record) => [record.update.update_id, record]));
  const seen = new Set<string>();
  const resolutions = parsed.resolutions.map((resolution) => {
    const updateId = typeof resolution.update_id === "string" ? resolution.update_id : "";
    const itemDate = typeof resolution.date === "string" ? resolution.date : "";
    let action = resolution.action === "apply" || resolution.action === "reject" ? resolution.action : undefined;
    let reason = typeof resolution.reason === "string" ? resolution.reason.trim() : "";
    const suggestedTaskId =
      typeof resolution.task_id === "string" && resolution.task_id.trim() ? resolution.task_id.trim() : undefined;
    const record = expected.get(updateId);
    if (!record || record.date !== itemDate || !action || !reason || seen.has(updateId))
      throw new Error("AI resolution returned an invalid, duplicate, or unknown Agent Update resolution.");
    const originalTask = record.update.task_id
      ? tasks.tasks.find((task) => task.id === record.update.task_id && !isTaskDeleted(task))
      : undefined;
    const suggestedTask = suggestedTaskId
      ? tasks.tasks.find((task) => task.id === suggestedTaskId && !isTaskDeleted(task))
      : undefined;
    const targetTaskId = originalTask?.id ?? suggestedTask?.id;
    if (action === "apply" && !targetTaskId) {
      action = "reject";
      reason = `${reason} / 有効なtask_idを特定できないため却下`;
    }
    seen.add(updateId);
    return {
      date: itemDate,
      update_id: updateId,
      action,
      task_id: targetTaskId,
      reason,
      status: record.update.status,
      original_task_id: record.update.task_id,
    };
  });
  if (seen.size !== expected.size)
    throw new Error(`AI resolution omitted ${expected.size - seen.size} Agent Update(s).`);
  await repo.withTransaction(async () => {
    for (const resolution of resolutions.filter(
      (item) => item.action === "apply" && item.task_id && item.task_id !== item.original_task_id,
    )) {
      const document = await repo.loadAgentUpdates(resolution.date);
      const update = document.updates.find((item) => item.update_id === resolution.update_id);
      if (!update) throw new Error(`Agent update not found while assigning task: ${resolution.update_id}`);
      update.task_id = resolution.task_id;
      const notes = Array.isArray(update.review_notes) ? update.review_notes.map(String) : [];
      update.review_notes = [...notes, `AI resolution assigned task_id=${resolution.task_id}: ${resolution.reason}`];
      await repo.saveAgentUpdates(resolution.date, document, "ai-assign-agent-update-task");
    }
    for (const resolution of resolutions.filter((item) => item.action === "reject"))
      await updateAgentUpdateStatus(repo, resolution.date, {
        update_id: resolution.update_id,
        status: "rejected",
        note: `AI resolution: ${resolution.reason}`,
      });
    for (const resolution of resolutions.filter((item) => item.action === "apply" && item.status === "needs_review"))
      await updateAgentUpdateStatus(repo, resolution.date, {
        update_id: resolution.update_id,
        status: "pending",
        note: `AI resolution approved: ${resolution.reason}`,
      });
    for (const itemDate of dates) {
      const updateIds = resolutions
        .filter((item) => item.date === itemDate && item.action === "apply")
        .map((item) => item.update_id);
      if (updateIds.length > 0) await applyAgentUpdates(repo, itemDate, updateIds);
    }
  });
  return {
    date,
    scope: "all_unresolved_through_date",
    resolved: resolutions.length,
    applied: resolutions.filter((item) => item.action === "apply").length,
    rejected: resolutions.filter((item) => item.action === "reject").length,
    resolutions,
    ...webLlmMetadata(config, generated),
  };
}
