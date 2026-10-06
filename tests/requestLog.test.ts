import { describe, expect, it } from "vitest";
import { summarizeErrorMessage, summarizeToolResult } from "#infra/audit/requestLog";

describe("summarizeErrorMessage", () => {
  it("caps a long message without retaining its secret-bearing tail", () => {
    const secretTail = "secret-token-must-not-reach-the-request-log";
    const message = `${"provider error ".repeat(200)}${secretTail}`;

    const summary = summarizeErrorMessage(message);

    expect(summary).toHaveLength(2048);
    expect(summary).toMatch(/\.\.\.$/);
    expect(summary).not.toContain(secretTail);
  });
});

describe("summarizeToolResult", () => {
  it("retains operational metadata and counts without retaining result text", () => {
    const secret = "api-key-super-secret";
    const summary = summarizeToolResult({
      llm_provider: "codex_app_server",
      fallback_reason: `provider failed with ${secret}`,
      fallback_reasons: ["Copilot unavailable", `child stderr ${secret}`],
      fallback_reason_codes: ["copilot_cli:method_not_found", "codex_app_server:model_unavailable"],
      entries: [{ task_id: "task-1", done: [secret] }, { task_id: "task-2" }],
      results: [{ sampled_text: secret }],
      sampled_text: secret,
      parsed: { token: secret },
      error: secret,
      codex_thread_id: "thread-123",
    });

    expect(summary).toEqual({
      llm_provider: "codex_app_server",
      fallback: true,
      fallback_reasons_count: 2,
      fallback_reason_codes: ["copilot_cli:method_not_found", "codex_app_server:model_unavailable"],
      entries_count: 2,
      results_count: 1,
      codex_thread_id: "thread-123",
    });
    expect(JSON.stringify(summary)).not.toContain(secret);
  });

  it("does not inspect arbitrary nested values", () => {
    expect(
      summarizeToolResult({
        result: { text: "private response" },
        content: [{ type: "text", text: "private response" }],
        warnings: "private warning",
      }),
    ).toEqual({ warnings_present: true });
  });

  it("retains only allowlisted provider fallback codes", () => {
    expect(
      summarizeToolResult({
        fallback_reason_codes: [
          "copilot_cli:method_not_found",
          "codex_app_server:timeout",
          "copilot_cli:provider_error secret-token",
          "other_provider:timeout",
        ],
      }),
    ).toEqual({
      fallback_reason_codes: ["copilot_cli:method_not_found", "codex_app_server:timeout"],
    });
  });

  it("summarizes allowlisted report-generation sections", () => {
    expect(
      summarizeToolResult({
        report_entries: {
          llm_provider: "copilot_cli",
          entries: [{ task_id: "task-1", done: ["private"] }],
        },
        memory_summaries: {
          results: [{ sampled_text: "private" }, { sampled_text: "private" }],
        },
      }),
    ).toEqual({
      report_entries: { llm_provider: "copilot_cli", entries_count: 1 },
      memory_summaries: { results_count: 2 },
    });
  });
});
