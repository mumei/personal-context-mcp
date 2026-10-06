import { describe, expect, it } from "vitest";
import { repartitionActivities } from "#domain/activities/repartition";
import { createTempRepo } from "./helpers.ts";

describe("repartitionActivities", () => {
  it("moves timestamped entries, enriches agent updates, and preserves unknown legacy dates", async () => {
    const { repo } = await createTempRepo();
    await repo.saveAgentUpdates(
      "2026-07-15",
      {
        date: "2026-07-15",
        updates: [
          {
            update_id: "update-1",
            session_id: "session-1",
            source: "test",
            summary: "test update",
            status: "applied",
            received_at: "2026-07-15T03:00:00+09:00",
            task_id: "task-1",
          },
        ],
      },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-15",
      {
        date: "2026-07-15",
        entries: [
          { activity_id: "direct", task_id: "task-1", occurred_at: "2026-07-15T03:30:00+09:00" },
          { activity_id: "update-1", agent_update_id: "update-1", task_id: "task-1" },
          { activity_id: "legacy", task_id: "task-1" },
        ],
      },
      "seed",
    );

    const result = await repartitionActivities(repo, { timezone: "Asia/Tokyo", activityRolloverHour: 4 });

    expect(result).toMatchObject({
      moved_entries: 2,
      enriched_entries: 1,
      unresolved_legacy_entries: 1,
      invalid_timestamp_entries: 0,
    });
    await expect(repo.loadActivity("2026-07-14")).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ activity_id: "direct" }),
        expect.objectContaining({ activity_id: "update-1", occurred_at: "2026-07-15T03:00:00+09:00" }),
      ],
    });
    await expect(repo.loadActivity("2026-07-15")).resolves.toMatchObject({ entries: [{ activity_id: "legacy" }] });
  });
});
