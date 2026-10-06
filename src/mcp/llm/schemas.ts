/**
 * Defines validation helpers and JSON output schemas shared by MCP LLM workflows.
 * MCPのLLMワークフローで共有する検証ヘルパーとJSON出力スキーマを定義します。
 *
 * @remarks
 * This module does not execute providers or persist generated data.
 * このモジュールはProvider実行や生成データの永続化を担当しません。
 *
 * @packageDocumentation
 */

/** Validates and normalizes a generated compact task summary. 生成されたタスク簡易要約を検証して正規化します。 */
export function compactSummaryLines(value: unknown, taskId: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Scoped generation task_summary must be an array: ${taskId}`);
  }
  const lines = value.map((line) => {
    if (typeof line !== "string" || line.trim().length === 0) {
      throw new Error(`Scoped generation task_summary must contain non-empty strings: ${taskId}`);
    }
    return line.trim();
  });
  if (lines.length < 1 || lines.length > 2) {
    throw new Error(`Scoped generation task_summary must contain 1-2 lines: ${taskId}`);
  }
  return lines;
}

/** Builds the structured-output schema for task-memory promotion. タスクメモリ昇格用の構造化出力スキーマを構築します。 */
export function memorySummaryOutputSchema(): Record<string, unknown> {
  const stringArraySchema = { type: "array", items: { type: "string" } };
  const mindmapSchema = memoryMindMapOutputSchema();
  return {
    type: "object",
    properties: {
      task_id: { type: "string" },
      summary: stringArraySchema,
      facts: stringArraySchema,
      decisions: stringArraySchema,
      risks: stringArraySchema,
      next: stringArraySchema,
      mindmap: mindmapSchema,
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            date: { type: "string" },
            task_id: { type: "string" },
            section: { type: "string" },
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

/** Builds the structured-output schema for a task-memory mind map. タスクメモリのマインドマップ用構造化出力スキーマを構築します。 */
export function memoryMindMapOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      root: { type: "string", maxLength: 32 },
      paths: {
        type: "array",
        maxItems: 24,
        items: { type: "array", minItems: 2, maxItems: 6, items: { type: "string", maxLength: 32 } },
      },
    },
    required: ["root", "paths"],
    additionalProperties: false,
  };
}
