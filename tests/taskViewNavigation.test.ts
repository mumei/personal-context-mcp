import { describe, expect, it } from "vitest";
import { retainedTaskView } from "#webUi/navigation/taskView";

describe("task view navigation", () => {
  it.each(["current", "overview", "context", "memory"])("retains the %s tab between tasks", (view) => {
    expect(retainedTaskView("task", view)).toBe(view);
  });

  it("uses current status when selecting a task from another page", () => {
    expect(retainedTaskView("summary", undefined)).toBe("current");
    expect(retainedTaskView("report", "memory")).toBe("current");
  });

  it("rejects unsupported task route values", () => {
    expect(retainedTaskView("task", "unknown")).toBe("current");
    expect(retainedTaskView("task", ["memory"])).toBe("current");
  });
});
