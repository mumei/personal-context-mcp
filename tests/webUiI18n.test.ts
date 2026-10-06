// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { messages } from "#webUi/i18n/index";

describe("Web UI translations", () => {
  it("defines the same translation keys for Japanese and English", () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.ja).sort());
  });

  it("translates operational and settings labels instead of only navigation", () => {
    expect(messages.ja.summary).toBe("概要");
    expect(messages.ja.report).toBe("レポート");
    expect(messages.ja.morningBrief).toBe("ブリーフィング");
    expect(messages.en.operationalWarnings).toBe("Operational warnings");
    expect(messages.en.organizeTask).toBe("Organize task information");
    expect(messages.en.dailyTaskSettings).toBe("Daily task settings");
    expect(messages.en.llmProviderSettings).toBe("LLM provider");
    expect(messages.en.summaryGenerate).toBe("Generate today's summary");
    expect(messages.ja.knowledge).toBe("ナレッジ");
    expect(messages.en.knowledgeDescription).toContain("task-independent knowledge");
    expect(messages.ja.automationUnused).toBe("未使用");
    expect(messages.ja.selectedProvider).toBe("選択中Provider");
    expect(messages.ja.dailyTaskDefaultPrompt).toContain("日本語で生成");
    expect(messages.en.dailyTaskDefaultPrompt).toContain("in English");
  });
});
