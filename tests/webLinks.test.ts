import { describe, expect, it } from "vitest";
import {
  reportWebUrl,
  resolveTaskMcpWebBaseUrl,
  taskMcpWebLinks,
  withoutPersistencePaths,
} from "#mcp/presentation/webLinks";

describe("MCP Web links", () => {
  it("builds summary and report URLs from the configured local server", () => {
    const env = { TASK_MCP_WEB_HOST: "0.0.0.0", TASK_MCP_WEB_PORT: "8989" };

    expect(taskMcpWebLinks("2026-07-17", env)).toEqual({
      summary: "http://127.0.0.1:8989/summary?date=2026-07-17",
      report_text: "http://127.0.0.1:8989/report/text?date=2026-07-17",
      report_markdown: "http://127.0.0.1:8989/report/markdown?date=2026-07-17",
    });
  });

  it("supports a browser-visible base URL with a path prefix", () => {
    const env = { TASK_MCP_WEB_BASE_URL: "https://tasks.example.com/task-mcp/" };

    expect(resolveTaskMcpWebBaseUrl(env)).toBe("https://tasks.example.com/task-mcp");
    expect(reportWebUrl("2026-07-17", "markdown", env)).toBe(
      "https://tasks.example.com/task-mcp/report/markdown?date=2026-07-17",
    );
    expect(reportWebUrl("2026-07-17", "html", env)).toBe(
      "https://tasks.example.com/task-mcp/report/markdown?date=2026-07-17",
    );
  });

  it("rejects unsafe or ambiguous base URLs", () => {
    expect(() => resolveTaskMcpWebBaseUrl({ TASK_MCP_WEB_BASE_URL: "file:///tmp/report" })).toThrow(/HTTP/);
    expect(() => resolveTaskMcpWebBaseUrl({ TASK_MCP_WEB_BASE_URL: "https://user:secret@example.com" })).toThrow(
      /without credentials/,
    );
    expect(() => resolveTaskMcpWebBaseUrl({ TASK_MCP_WEB_PORT: "70000" })).toThrow(/between 1 and 65535/);
  });

  it("removes nested persistence paths while preserving useful result metadata", () => {
    expect(
      withoutPersistencePaths({
        date: "2026-07-17",
        path: "/Users/example/.tasks/outputs/text/2026-07-17.txt",
        save: { changed: true, path: "/private/output", backupPath: "/private/backup" },
        outputs: [{ renderer: "text", path: "/private/output" }],
      }),
    ).toEqual({
      date: "2026-07-17",
      save: { changed: true },
      outputs: [{ renderer: "text" }],
    });
  });
});
