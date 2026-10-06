import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { runExternalInputCollector } from "#domain/inputs/externalCollector";
import { createTempRepo } from "./helpers.ts";

async function writeCollectorConfig(root: string, text: string): Promise<void> {
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(join(root, "config", "external_input.yaml"), text, "utf8");
}

describe("external input collector", () => {
  it("retains manual events, refreshes owned inputs and publishes an ordered idempotent schedule", async () => {
    const { repo } = await createTempRepo();
    const date = "2026-09-08";
    const manual = [
      { input_id: "interview", source: "user", title: "17:00〜18:00 Interview" },
      { input_id: "premeet", source: "user", title: "16:30〜17:00 Preparation" },
      { input_id: "note", source: "user", title: "Not an event", received_at: `${date}T10:00:00+09:00` },
    ];
    await repo.saveInputs(
      date,
      {
        date,
        items: [
          ...manual,
          { source: "calendar", title: "Old event" },
          { source: "mail", title: "Old mail" },
          { source: "github", title: "Old issue" },
        ],
      },
      "seed",
    );
    await writeCollectorConfig(repo.root, "enabled: true\ncommand: collector\nargs: []\n");
    const run = () =>
      runExternalInputCollector(repo, date, async ({ stageRoot }) => {
        await mkdir(stageRoot, { recursive: true });
        const event = { input_id: "calendar-event", source: "calendar", title: "Work | Call | 09:00 | 10:00" };
        await writeFile(
          join(stageRoot, `${date}.yaml`),
          YAML.stringify({
            date,
            generated_at: new Date().toISOString(),
            items: [
              event,
              event,
              { source: "mail", title: "New mail" },
              { source: "github", title: "New issue" },
              { input_id: "premeet", source: "calendar", title: "Wrong collision" },
            ],
          }),
        );
        await writeFile(
          join(stageRoot, `${date}.md`),
          "1. 今日の予定\n- 予定なし\n2. メール\n- New mail\n3. GitHub\n- New issue\n",
        );
      });
    await run();
    const first = await repo.loadInputs(date);
    expect(first.items).toHaveLength(6);
    expect(first.items).toEqual(expect.arrayContaining(manual));
    expect(first.items.some((item) => item.title.startsWith("Old"))).toBe(false);
    const output = await repo.loadOutput("morning", date, "md");
    expect(output).not.toContain("予定なし");
    expect(output).not.toContain("Not an event");
    expect(output!.indexOf("09:00")).toBeLessThan(output!.indexOf("16:30"));
    expect(output!.indexOf("16:30")).toBeLessThan(output!.indexOf("17:00〜"));
    await run();
    expect((await repo.loadInputs(date)).items).toEqual(first.items);
    expect(await repo.loadOutput("morning", date, "md")).toBe(output);
  });

  it("expands safe arguments and verifies refreshed external inputs", async () => {
    const { repo } = await createTempRepo();
    await writeCollectorConfig(
      repo.root,
      [
        "enabled: true",
        "command: ruby",
        "args:",
        "  - /opt/collector.rb",
        '  - "{date}"',
        '  - "{data_root}"',
        "cwd: /opt",
        "timeout_ms: 5000",
      ].join("\n"),
    );

    const result = await runExternalInputCollector(repo, "2026-07-15", async (input) => {
      expect(input).toMatchObject({
        command: "ruby",
        args: ["/opt/collector.rb", "2026-07-15", repo.root],
        cwd: "/opt",
        dataRoot: repo.root,
        timeoutMs: 5000,
        locale: "en_US.UTF-8",
      });
      await mkdir(input.stageRoot, { recursive: true });
      await writeFile(
        join(input.stageRoot, "2026-07-15.yaml"),
        `date: 2026-07-15\ngenerated_at: ${new Date().toISOString()}\nitems: []\n`,
        "utf8",
      );
      await writeFile(
        join(input.stageRoot, "2026-07-15.md"),
        "1. 今日の予定\n- 予定なし\n2. 重要な未読メール\n- なし\n3. GitHub Issue確認\n- 0件\n",
        "utf8",
      );
    });

    expect(result).toMatchObject({ configured: true, executed: true });
    await expect(repo.loadInputs("2026-07-15")).resolves.toMatchObject({ date: "2026-07-15" });
    await expect(repo.loadOutput("morning", "2026-07-15", "md")).resolves.toContain("3. GitHub Issue確認");
  });

  it("skips cleanly when no collector is configured", async () => {
    const { repo } = await createTempRepo();
    await expect(runExternalInputCollector(repo, "2026-07-15")).resolves.toEqual({
      configured: false,
      executed: false,
      duration_ms: 0,
    });
  });

  it("rejects a successful command that did not refresh dated inputs", async () => {
    const { repo } = await createTempRepo();
    await writeCollectorConfig(repo.root, "enabled: true\ncommand: collector\nargs: []\ntimeout_ms: 5000\n");
    await expect(runExternalInputCollector(repo, "2026-07-15", async () => undefined)).rejects.toThrow(
      "did not refresh staged inputs",
    );
  });

  it("runs the collector child process with an explicit UTF-8 locale", async () => {
    const { repo } = await createTempRepo();
    const scriptPath = join(repo.root, "collector.mjs");
    await writeFile(
      scriptPath,
      [
        'import { mkdir, writeFile } from "node:fs/promises";',
        'import { join } from "node:path";',
        "const [, , date] = process.argv;",
        "const stage = process.env.TASK_MCP_COLLECTOR_STAGE_ROOT;",
        'if (process.env.LANG !== "en_US.UTF-8" || process.env.LC_ALL !== "en_US.UTF-8") process.exit(2);',
        "await mkdir(stage, { recursive: true });",
        'await writeFile(join(stage, date + ".yaml"), "date: " + date + "\\ngenerated_at: " + new Date().toISOString() + "\\nitems: []\\n");',
        'await writeFile(join(stage, date + ".md"), "1. 今日の予定\\n- 予定なし\\n2. 重要な未読メール\\n- なし\\n3. GitHub Issue確認\\n- 0件\\n");',
      ].join("\n"),
      "utf8",
    );
    await writeCollectorConfig(
      repo.root,
      [
        "enabled: true",
        `command: ${JSON.stringify(process.execPath)}`,
        "args:",
        `  - ${JSON.stringify(scriptPath)}`,
        '  - "{date}"',
        '  - "{data_root}"',
        "timeout_ms: 5000",
      ].join("\n"),
    );

    await expect(runExternalInputCollector(repo, "2026-07-15")).resolves.toMatchObject({ executed: true });
  });

  it("reports the collector timeout and captured stage diagnostics", async () => {
    const { repo } = await createTempRepo();
    const scriptPath = join(repo.root, "slow-collector.mjs");
    await writeFile(
      scriptPath,
      ['process.stderr.write("[morning_brief] calendar completed in 0.20s\\n");', "setInterval(() => {}, 1000);"].join(
        "\n",
      ),
      "utf8",
    );
    await writeCollectorConfig(
      repo.root,
      [
        "enabled: true",
        `command: ${JSON.stringify(process.execPath)}`,
        "args:",
        `  - ${JSON.stringify(scriptPath)}`,
        "timeout_ms: 1000",
      ].join("\n"),
    );

    await expect(runExternalInputCollector(repo, "2026-07-15")).rejects.toThrow(
      "External input collector timed out after 1000ms. stderr: [morning_brief] calendar completed in 0.20s",
    );
  });

  it("leaves canonical data unchanged when staged briefing validation fails", async () => {
    const { repo } = await createTempRepo();
    const date = "2026-07-15";
    await repo.saveInputs(date, { date, generated_at: "2026-07-15T00:00:00.000Z", items: [] }, "seed");
    await repo.saveOutput("morning", date, "canonical briefing", "seed", "md");
    await writeCollectorConfig(repo.root, "enabled: true\ncommand: collector\nargs: []\ntimeout_ms: 5000\n");

    await expect(
      runExternalInputCollector(repo, date, async ({ stageRoot }) => {
        await mkdir(stageRoot, { recursive: true });
        await writeFile(
          join(stageRoot, `${date}.yaml`),
          `date: ${date}\ngenerated_at: ${new Date().toISOString()}\nitems: []\n`,
          "utf8",
        );
        await writeFile(join(stageRoot, `${date}.md`), "1. 今日の予定\n- 予定なし\n", "utf8");
      }),
    ).rejects.toThrow("did not generate staged briefing sections 1-3");

    await expect(repo.loadInputs(date)).resolves.toMatchObject({ generated_at: "2026-07-15T00:00:00.000Z" });
    await expect(repo.loadOutput("morning", date, "md")).resolves.toBe("canonical briefing");
    await expect(readdir(join(repo.root, ".collector-staging"))).resolves.toEqual([]);
  });
});
