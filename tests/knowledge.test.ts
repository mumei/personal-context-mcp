import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getKnowledgeNote,
  rebuildKnowledgeGraph,
  searchKnowledge,
  upsertKnowledgeNote,
} from "#domain/knowledge/actions";
import { promoteTaskMemoryToKnowledge } from "#domain/knowledge/promotion";
import { validateKnowledgeGraph } from "#domain/knowledge/validation";
import type { LlmGenerationRequest } from "#llm/types";
import type { KnowledgeNote } from "#shared/types";
import { createTempRepo } from "./helpers.js";

function note(id: string, overrides: Partial<KnowledgeNote> = {}): KnowledgeNote {
  return {
    id,
    title: id,
    type: "concept",
    aliases: [],
    tags: [],
    summary: "summary",
    evidence: [{ statement: "Reusable statement", rationale: "Reusable rationale" }],
    relations: [],
    created_at: "2026-07-21T00:00:00.000Z",
    updated_at: "2026-07-21T00:00:00.000Z",
    body: "Body",
    ...overrides,
  };
}

describe("Knowledge Graph", () => {
  it("rejects unsafe ids, duplicate aliases, and invalid edges", () => {
    expect(() => validateKnowledgeGraph([note("../unsafe")])).toThrow("Unsafe knowledge note id");
    expect(() =>
      validateKnowledgeGraph([note("one", { aliases: ["shared"] }), note("two", { aliases: ["SHARED"] })]),
    ).toThrow("Duplicate knowledge id or alias");
    expect(() => validateKnowledgeGraph([note("one", { relations: [{ type: "uses", target_id: "one" }] })])).toThrow(
      "Self relation",
    );
    expect(() =>
      validateKnowledgeGraph([note("one", { relations: [{ type: "uses", target_id: "missing" }] })]),
    ).toThrow("Unknown knowledge relation target");
    expect(() =>
      validateKnowledgeGraph([
        note("one", {
          relations: [
            { type: "uses", target_id: "two" },
            { type: "uses", target_id: "two" },
          ],
        }),
        note("two"),
      ]),
    ).toThrow("Duplicate relations");
  });

  it("requires self-contained summary, body, and evidence", () => {
    expect(() => validateKnowledgeGraph([note("concept", { summary: "" })])).toThrow("summary is required");
    expect(() => validateKnowledgeGraph([note("concept", { body: "" })])).toThrow("body is required");
    expect(() => validateKnowledgeGraph([note("concept", { evidence: [] })])).toThrow("evidence is required");
    expect(() => validateKnowledgeGraph([note("concept", { body: "## 根拠\n重複した根拠" })])).toThrow(
      "must not duplicate",
    );
    expect(() =>
      validateKnowledgeGraph([note("concept", { evidence: [{ statement: "Claim", rationale: "" }] })]),
    ).toThrow("requires statement and rationale");
  });

  it("migrates legacy source metadata into embedded evidence without exposing paths", async () => {
    const { repo } = await createTempRepo();
    const path = repo.knowledgeNotePath("legacy-sales");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      [
        "---",
        "id: legacy-sales",
        "title: Legacy Sales",
        "type: concept",
        "aliases: []",
        "tags: [sales]",
        "summary: 顧客理解を先に行う",
        "relations: []",
        "sources:",
        "  - path: /private/manual.md",
        "created_at: 2026-07-21T00:00:00.000Z",
        "updated_at: 2026-07-21T00:00:00.000Z",
        "---",
        "## 根拠",
        "顧客理解のない提案は判断材料にならない。",
      ].join("\n"),
      "utf8",
    );

    const loaded = await repo.loadKnowledgeNote("legacy-sales");
    expect(loaded).toMatchObject({
      evidence: [
        {
          statement: "顧客理解を先に行う",
          rationale: "顧客理解のない提案は判断材料にならない。",
        },
      ],
    });
    expect(loaded).not.toHaveProperty("sources");
    expect(loaded?.body).not.toContain("## 根拠");
    expect(JSON.stringify(await rebuildKnowledgeGraph(repo))).not.toContain("/private/manual.md");
  });

  it("persists canonical Markdown and rebuilds a derived index", async () => {
    const { repo } = await createTempRepo();
    await upsertKnowledgeNote(repo, {
      id: "keycloak",
      title: "Keycloak",
      type: "technology",
      aliases: ["Keycloak OIDC"],
      tags: ["authentication"],
      summary: "An identity provider.",
      evidence: [{ statement: "Keycloak provides identity services.", rationale: "It supports OIDC authentication." }],
      body: "# Keycloak\n\nReusable authentication knowledge.",
    });
    await upsertKnowledgeNote(repo, {
      id: "deltaco",
      title: "DeltaCo",
      type: "system",
      summary: "A product system.",
      evidence: [{ statement: "DeltaCo uses Keycloak.", rationale: "Keycloak provides its authentication." }],
      relations: [{ type: "uses", target_id: "keycloak" }],
      body: "# DeltaCo",
    });

    const stored = await readFile(repo.knowledgeNotePath("keycloak"), "utf8");
    expect(stored).toContain("id: keycloak");
    expect(stored).toContain("# Keycloak");
    const rebuilt = await rebuildKnowledgeGraph(repo);
    expect(rebuilt.index.nodes).toHaveLength(2);
    expect(rebuilt.index.edges).toEqual([expect.objectContaining({ source_id: "deltaco", target_id: "keycloak" })]);
    expect(await repo.loadKnowledgeGraphIndex()).toMatchObject({ version: 2, nodes: expect.any(Array) });
  });

  it("serializes concurrent note upserts before rebuilding the index", async () => {
    const { repo } = await createTempRepo();
    await Promise.all([
      upsertKnowledgeNote(repo, {
        id: "alpha",
        title: "Alpha",
        type: "concept",
        summary: "Alpha summary",
        evidence: [{ statement: "Alpha", rationale: "Alpha rationale" }],
        body: "Alpha body",
      }),
      upsertKnowledgeNote(repo, {
        id: "beta",
        title: "Beta",
        type: "concept",
        summary: "Beta summary",
        evidence: [{ statement: "Beta", rationale: "Beta rationale" }],
        body: "Beta body",
      }),
    ]);

    expect((await repo.loadKnowledgeNotes()).map((item) => item.id).sort()).toEqual(["alpha", "beta"]);
    expect((await repo.loadKnowledgeGraphIndex()).nodes.map((item) => item.id).sort()).toEqual(["alpha", "beta"]);
  });

  it("searches aliases and embedded evidence, then returns a bounded neighborhood", async () => {
    const { repo } = await createTempRepo();
    await upsertKnowledgeNote(repo, {
      id: "keycloak",
      title: "Keycloak",
      type: "technology",
      aliases: ["OIDC provider"],
      tags: ["auth"],
      summary: "Identity provider",
      evidence: [{ statement: "OIDC provider", rationale: "Reusable authentication evidence" }],
      body: "Keycloak authentication knowledge.",
    });
    await upsertKnowledgeNote(repo, {
      id: "service",
      title: "Service",
      type: "system",
      summary: "Service summary",
      evidence: [{ statement: "Service depends on Keycloak", rationale: "Authentication requires it" }],
      relations: [{ type: "depends_on", target_id: "keycloak" }],
      body: "Service knowledge.",
    });
    const result = await searchKnowledge(repo, { query: "OIDC provider", depth: 1, limit: 2 });
    expect(result.nodes.map((item) => item.id).sort()).toEqual(["keycloak", "service"]);
    expect(result.nodes.find((item) => item.id === "keycloak")?.evidence).toEqual([
      { statement: "OIDC provider", rationale: "Reusable authentication evidence" },
    ]);
    expect(result.edges).toHaveLength(1);
    await expect(getKnowledgeNote(repo, "keycloak", 0, 1)).resolves.toMatchObject({
      note: { body: "Keycloak authentication knowledge." },
    });
  });

  it("normalizes full-width input and matches Japanese and English concepts across fields", async () => {
    const { repo } = await createTempRepo();
    await upsertKnowledgeNote(repo, {
      id: "keycloak-auth",
      title: "Keycloak",
      type: "technology",
      aliases: ["OpenID Connect"],
      tags: ["authentication"],
      summary: "認証基盤の運用方針",
      evidence: [{ statement: "Keycloak provides OIDC.", rationale: "認証基盤の標準化に使う。" }],
      body: "Reusable authentication knowledge.",
    });
    await upsertKnowledgeNote(repo, {
      id: "unrelated-auth",
      title: "認証画面",
      type: "concept",
      summary: "画面表示の一般知識",
      evidence: [{ statement: "認証画面を表示する。", rationale: "ログイン時に必要。" }],
      body: "Unrelated UI knowledge.",
    });

    const result = await searchKnowledge(repo, { query: "Ｋｅｙｃｌｏａｋ　認証基盤", depth: 0, limit: 10 });

    expect(result.nodes.map((item) => item.id)).toContain("keycloak-auth");
    expect(result.nodes.map((item) => item.id)).not.toContain("unrelated-auth");
  });

  it("supports the Web audit limit above one hundred nodes", async () => {
    const { repo } = await createTempRepo();
    for (let index = 0; index < 120; index += 1) {
      await repo.saveKnowledgeNote(note(`node-${index}`, { title: `Node ${index}` }), "seed");
    }

    const result = await searchKnowledge(repo, { depth: 0, limit: 250 });
    expect(result.nodes).toHaveLength(120);
    expect(result.truncated).toBe(false);
  });

  it("promotes only consolidated task memory into self-contained evidence", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Authentication work" }] }, "seed");
    await repo.saveTaskMemory(
      "task-1",
      { task_id: "task-1", facts: ["Keycloak is the reusable identity provider."] },
      "seed",
    );
    await repo.saveActivity(
      "2026-07-21",
      { date: "2026-07-21", entries: [{ task_id: "task-1", done: ["Transient 90% progress"] }] },
      "seed",
    );
    let request: LlmGenerationRequest | undefined;
    const generate = vi.fn(async (value: LlmGenerationRequest) => {
      request = value;
      return {
        text: JSON.stringify({
          notes: [
            {
              id: "keycloak",
              title: "Keycloak",
              type: "technology",
              aliases: [],
              tags: ["authentication"],
              summary: "Reusable identity provider",
              evidence: [
                { statement: "Keycloak is reusable.", rationale: "It provides a shared identity capability." },
              ],
              relations: [],
              body: "Identity-provider knowledge.",
            },
          ],
        }),
        provider: "codex_app_server" as const,
      };
    });
    await promoteTaskMemoryToKnowledge(repo, { task_id: "task-1" }, generate);
    expect(request?.prompt).toContain("Keycloak is the reusable identity provider");
    expect(request?.prompt).toContain("remains meaningful after removing the originating task name and date");
    expect(request?.prompt).toContain("Customer X rejected Task Y's quote today");
    expect(request?.prompt).toContain("return {notes:[],skipped_reason:");
    expect(request?.prompt).not.toContain("Transient 90% progress");
    expect(request?.prompt).not.toContain("task_memory/task-1.yaml");
    expect(await repo.loadKnowledgeNote("keycloak")).toMatchObject({
      evidence: [{ statement: "Keycloak is reusable.", rationale: "It provides a shared identity capability." }],
    });
  });

  it("skips promotion when task memory has no generalizable knowledge", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "One-time check" }] }, "seed");
    await repo.saveTaskMemory("task-1", { task_id: "task-1", facts: ["Today's count was 12."] }, "seed");

    const result = await promoteTaskMemoryToKnowledge(repo, { task_id: "task-1" }, async () => ({
      text: JSON.stringify({ notes: [], skipped_reason: "Only a dated transient observation was supplied." }),
      provider: "codex_app_server",
    }));

    expect(result).toMatchObject({
      task_id: "task-1",
      skipped: true,
      skipped_reason: "Only a dated transient observation was supplied.",
      notes: [],
      saves: [],
    });
    await expect(repo.loadKnowledgeNotes()).resolves.toEqual([]);
  });

  it("merges promotion output into an existing note without losing embedded evidence or content", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Authentication work" }] }, "seed");
    await repo.saveTaskMemory("task-1", { task_id: "task-1", facts: ["Keycloak supports OIDC."] }, "seed");
    await upsertKnowledgeNote(repo, {
      id: "keycloak",
      title: "Keycloak",
      type: "technology",
      aliases: ["Identity provider"],
      summary: "Existing identity knowledge",
      evidence: [{ statement: "Existing claim", rationale: "Existing rationale" }],
      body: "Existing durable content.",
    });

    await promoteTaskMemoryToKnowledge(repo, { task_id: "task-1" }, async () => ({
      text: JSON.stringify({
        notes: [
          {
            id: "keycloak",
            title: "Keycloak",
            type: "technology",
            aliases: ["OIDC provider"],
            tags: ["authentication"],
            summary: "Reusable identity provider",
            evidence: [{ statement: "New claim", rationale: "New rationale" }],
            relations: [],
            body: "New durable content.",
          },
        ],
      }),
      provider: "codex_app_server",
    }));

    await expect(repo.loadKnowledgeNote("keycloak")).resolves.toMatchObject({
      aliases: ["Identity provider", "OIDC provider"],
      evidence: [
        { statement: "Existing claim", rationale: "Existing rationale" },
        { statement: "New claim", rationale: "New rationale" },
      ],
      body: "Existing durable content.\n\nNew durable content.",
    });
  });

  it("rejects LLM output without embedded evidence", async () => {
    const { repo } = await createTempRepo();
    await repo.saveTasks({ tasks: [{ id: "task-1", title: "Task" }] }, "seed");
    await repo.saveTaskMemory("task-1", { task_id: "task-1", facts: ["Reusable fact"] }, "seed");
    await expect(
      promoteTaskMemoryToKnowledge(repo, { task_id: "task-1" }, async () => ({
        text: JSON.stringify({
          notes: [
            {
              id: "fact",
              title: "Fact",
              type: "concept",
              aliases: [],
              tags: [],
              summary: "Fact",
              relations: [],
              body: "Fact",
            },
          ],
        }),
      })),
    ).rejects.toThrow("must embed evidence");
    await expect(repo.loadKnowledgeNote("fact")).resolves.toBeNull();
  });
});
