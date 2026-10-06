/**
 * @packageDocumentation
 * Reorganizes and saves task Context and Task Memory together using supplied evidence.
 * It does not generate a standalone mind map, create briefings, or route HTTP requests.
 * 提供された証拠に基づき、タスクの Context と Task Memory を一括で再編成して保存する。
 * マインドマップの単独生成、ブリーフィングの作成、HTTP リクエストのルーティングは担当しない。
 */
import { createHash } from "node:crypto";
import type { LlmGenerator } from "#llm/types";
import {
  buildPromotedTaskMemory,
  buildTaskMemoryPromotionPrompt,
  parseTaskMemoryPromotion,
} from "#domain/memory/actions";
import { isTaskDeleted } from "#domain/tasks/state";
import { parseFrontmatter, stringifyFrontmatter } from "#shared/frontmatter";
import { Repository } from "#infra/repository/repository";
import type { TaskMcpConfig } from "#shared/types";
import { generateWebLlm, webLlmMetadata } from "#web/llm";
import { renderMarkdownBody } from "#web/markdown";
import { mindMapSchemaForOrganization } from "#web/tasks/mindMap";

function taskMemoryPromotionOutputSchema(): Record<string, unknown> {
  const stringArray = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    properties: {
      task_id: { type: "string" },
      summary: stringArray,
      facts: stringArray,
      decisions: stringArray,
      risks: stringArray,
      next: stringArray,
      mindmap: mindMapSchemaForOrganization(),
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: ["string", "null"] },
            date: { type: ["string", "null"] },
            task_id: { type: ["string", "null"] },
            section: { type: ["string", "null"] },
          },
          required: ["path", "date", "task_id", "section"],
          additionalProperties: false,
        },
      },
    },
    required: ["task_id", "summary", "facts", "decisions", "risks", "next", "mindmap", "sources"],
    additionalProperties: false,
  };
}

function taskInformationOrganizationOutputSchema(): Record<string, unknown> {
  const memorySchema = taskMemoryPromotionOutputSchema();
  const memoryProperties = { ...(memorySchema.properties as Record<string, unknown>) };
  delete memoryProperties.task_id;
  return {
    type: "object",
    properties: {
      context_markdown: { type: "string", minLength: 1, maxLength: 60000 },
      task_memory: {
        type: "object",
        properties: memoryProperties,
        required: ["summary", "facts", "decisions", "risks", "next", "mindmap", "sources"],
        additionalProperties: false,
      },
    },
    required: ["context_markdown", "task_memory"],
    additionalProperties: false,
  };
}

function httpUrls(value: string): string[] {
  const candidates = value.match(/https?:\/\/[^\s<>()[\]{}"'、。，．）」』】〉》〔［｛]+/gi) ?? [];
  return [
    ...new Set(
      candidates
        .map((url) => url.replace(/[.,;:!?、。，．：；！？）」』】〉》〕］｝]+$/gu, ""))
        .filter((url) => url.length > 0),
    ),
  ];
}

/**
 * Organizes task Context and Task Memory together and saves them transactionally.
 * タスクの Context と Task Memory を一括で整理し、トランザクションとして保存する。
 */
export async function organizeWebTaskInformation(
  repo: Repository,
  config: TaskMcpConfig,
  taskId: string,
  date: string,
  lookbackDays = config.defaultLookbackDays,
  generate: LlmGenerator = (input) => generateWebLlm(config, input),
): Promise<unknown> {
  const tasks = await repo.loadTasks();
  const task = tasks.tasks.find((item) => item.id === taskId);
  if (!task || isTaskDeleted(task)) throw new Error(`Task not found: ${taskId}`);
  const context = await repo.loadTaskContext(task);
  const contextSource = stringifyFrontmatter(context);
  if (!context.body.trim() && Object.keys(context.data).length === 0) throw new Error("Task context is empty.");
  if (contextSource.length > 60000) throw new Error("Task context exceeds the 60,000 character organization limit.");
  const promotion = await buildTaskMemoryPromotionPrompt(repo, date, {
    task_id: taskId,
    lookback_days: lookbackDays,
    force: true,
  });
  const globalMemory = await repo.loadGlobalMemory();
  const sources = {
    task: promotion.sources.task,
    context_markdown: contextSource,
    existing_memory: promotion.sources.existing_memory,
    activities: promotion.sources.activities,
    inputs: promotion.sources.inputs,
    global_memory: {
      summary: globalMemory.summary,
      preferences: globalMemory.preferences,
      rules: globalMemory.rules,
    },
  };
  const inputHash = createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  const prompt = [
    "Organize all durable information for one Personal Context MCP task in a single pass.",
    "Return only JSON matching {context_markdown:string, task_memory:{summary,facts,decisions,risks,next,mindmap,sources}}.",
    "Use all supplied Context, existing Task Memory, recent Activity, and related Input as evidence.",
    "Return the complete replacement Context file and complete replacement Task Memory, not patches.",
    "Context is the stable task definition: background, purpose, scope, constraints, requirements, procedures, references, and compact current summary.",
    "Task Memory is reusable long-term knowledge: current summary, durable facts, settled decisions, ongoing risks, and future-session next concerns.",
    "Apply global_memory.rules as mandatory organization constraints and global_memory.preferences as user-wide presentation preferences when relevant.",
    "Do not copy Global Memory into task Context or Task Memory; use it only to govern how the task information is organized.",
    "Activity and Input are immutable evidence. Never copy dated work logs, one-time completion statements, monitoring snapshots, transient counts or percentages, commands, PIDs, or report prose into durable storage.",
    "Avoid duplicating the same explanation between Context and Task Memory. Context explains the task; Task Memory records durable learned state.",
    "Preserve every HTTP/HTTPS URL from the original Context verbatim. Preserve useful Markdown headings, lists, tables, links, and code blocks.",
    "context_markdown must begin with valid YAML frontmatter delimited by --- lines and include the complete Markdown body.",
    "Use short de-duplicated Task Memory arrays. sources may contain only source references present in the supplied data.",
    "mindmap is {root,paths:[[level1,level2,...,concrete_leaf],...]}; use concise meaningful 4-6 level paths where evidence supports them.",
    "Do not invent facts, statuses, decisions, risks, or next actions.",
    "",
    JSON.stringify(sources, null, 2),
  ].join("\n");
  const generated = await generate({
    prompt,
    cwd: process.cwd(),
    outputSchema: taskInformationOrganizationOutputSchema(),
  });
  const parsed = JSON.parse(
    generated.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  ) as { context_markdown?: unknown; task_memory?: unknown };
  if (typeof parsed.context_markdown !== "string" || !parsed.context_markdown.trim())
    throw new Error("Task information organization returned no context Markdown.");
  const organizedSource = parsed.context_markdown.trim() + "\n";
  if (!organizedSource.startsWith("---\n") || organizedSource.indexOf("\n---", 4) < 0)
    throw new Error("Task information organization returned no valid YAML frontmatter block.");
  const organizedContext = parseFrontmatter(organizedSource);
  if (!organizedContext.data || typeof organizedContext.data !== "object" || Array.isArray(organizedContext.data))
    throw new Error("Task information organization returned invalid YAML frontmatter.");
  if (!organizedContext.body.trim() && context.body.trim())
    throw new Error("Task information organization removed the Markdown body.");
  const missingUrls = httpUrls(contextSource).filter((url) => !organizedSource.includes(url));
  if (missingUrls.length > 0) throw new Error(`Task information organization omitted ${missingUrls.length} URL(s).`);
  if (!parsed.task_memory || typeof parsed.task_memory !== "object" || Array.isArray(parsed.task_memory))
    throw new Error("Task information organization returned no task memory.");
  const memoryOutput = parseTaskMemoryPromotion(JSON.stringify({ task_id: taskId, ...parsed.task_memory }), taskId);
  const existingMemory = await repo.loadTaskMemory(taskId);
  const organizedMemory = buildPromotedTaskMemory(existingMemory, {
    task_id: taskId,
    input_hash: inputHash,
    ...memoryOutput,
  });
  const saves = await repo.withTransaction(async () => {
    const contextSave = await repo.saveTaskContext(task, organizedContext, "organize-task-information");
    const memorySave = await repo.saveTaskMemory(taskId, organizedMemory, "organize-task-information");
    return { context: contextSave, memory: memorySave };
  });
  return {
    task_id: taskId,
    date,
    lookback_days: lookbackDays,
    ...webLlmMetadata(config, generated),
    source_counts: {
      activities: promotion.sources.activities.reduce((count, item) => count + item.entries.length, 0),
      inputs: promotion.sources.inputs.reduce((count, item) => count + item.items.length, 0),
    },
    before_characters: contextSource.length,
    after_characters: organizedSource.length,
    preserved_url_count: httpUrls(contextSource).length,
    context: { ...organizedContext, body_html: renderMarkdownBody(organizedContext.body) },
    memory: organizedMemory,
    saves,
  };
}
