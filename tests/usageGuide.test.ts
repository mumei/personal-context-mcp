import { describe, expect, it } from "vitest";
import { getUsageGuide } from "#app/usageGuide";

describe("usage guide", () => {
  it("explains the flow required for text report visibility", () => {
    const guide = getUsageGuide();

    expect(guide).toContain("task_create_item");
    expect(guide).toContain("session_finish_task");
    expect(guide).toContain("system_search_context");
    expect(guide).toContain("append-only source journal");
    expect(guide).toContain("task_memory_promote_activity");
    expect(guide).toContain("activity_append_entry");
    expect(guide).toContain("clear_override");
    expect(guide).toContain("report_render_output");
    expect(guide).toContain("report_generate_output");
    expect(guide).toContain("reports/YYYY-MM-DD.yaml");
    expect(guide).toContain("tasks.yaml.compact_summary");
    expect(guide).toContain("entries[].task_snapshot");
    expect(guide).toContain("AI long-term knowledge");
    expect(guide).toContain("Call `session_finish_task` exactly once");
    expect(guide).toContain("Routine completion records Activity");
    expect(guide).toContain("memory_policy=force");
    expect(guide).toContain("cleanup_run_retention");
    expect(guide).toContain("global_memory_updates");
    expect(guide).toContain("always supplied to report, briefing, and task-organization generation");
    expect(guide).toContain("## Start-of-work retrieval");
    expect(guide).toContain("call `system_prepare_work`");
    expect(guide).toContain("Task IDs default to strict isolation");
    expect(guide).toContain("Skip Knowledge retrieval for simple status reads or mechanical operations");
    expect(guide).toContain("Never record an explicit stop as `waiting`");
    expect(guide).toContain("Reports exclude `blocked` tasks");
    expect(guide).toContain("waiting means a response, dependency, or specified date");
    expect(guide).toContain("Use discarded with discard_reason");
    expect(guide).toContain("can be restored by updating them to todo or inProgress");
    expect(guide).toContain("removing the originating task name and date");
    expect(guide).toContain("Customer X rejected Task Y's quote today");
    expect(guide).toContain("If content cannot be generalized beyond one task, do not create a Knowledge note");
    expect(guide).toContain("returns no notes when nothing qualifies");
    expect(guide).not.toContain("source references");
    expect(guide).not.toContain("with provenance in Knowledge");
    expect(guide).toContain("It never modifies task memory");
    expect(guide).toContain("Do not write new legacy `task_summary` fields");
    expect(guide).not.toContain("submit_agent_update");
    expect(guide).not.toContain("memory_summaries");
  });
});
