import { describe, expect, it } from "vitest";
import { loadRelevantKnowledge } from "#app/knowledgeContext";
import type { KnowledgeNote } from "#shared/types";
import { createTempRepo } from "./helpers.ts";

function note(id: string, title: string, summary: string, relations: KnowledgeNote["relations"] = []): KnowledgeNote {
  return {
    id,
    title,
    type: "technology",
    aliases: [],
    tags: ["authentication"],
    summary,
    evidence: [{ statement: summary, rationale: `${title}に関する再利用可能な根拠` }],
    relations,
    created_at: "2026-07-23T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z",
    body: `# ${title}`,
  };
}

describe("relevant knowledge context", () => {
  it("returns only a bounded neighborhood matching task-derived seeds", async () => {
    const { repo } = await createTempRepo();
    const notes = [
      note("keycloak", "Keycloak", "DeltaCoの認証基盤", [{ type: "replaces", target_id: "cognito" }]),
      note("cognito", "Amazon Cognito", "旧認証基盤"),
      note("unrelated", "Unrelated", "別案件の知識"),
    ];
    for (const item of notes) await repo.saveKnowledgeNote(item, "seed");

    const result = await loadRelevantKnowledge(repo, ["DeltaCo", "Keycloak"], { depth: 1, limit: 2 });

    expect(result.nodes.map((item) => item.id).sort()).toEqual(["cognito", "keycloak"]);
    expect(result.edges).toEqual([expect.objectContaining({ source_id: "keycloak", target_id: "cognito" })]);
    expect(result.nodes.map((item) => item.id)).not.toContain("unrelated");
  });

  it("returns an empty bounded result when no canonical notes exist", async () => {
    const { repo } = await createTempRepo();

    await expect(loadRelevantKnowledge(repo, ["Keycloak"], { depth: 1, limit: 8 })).resolves.toEqual({
      depth: 1,
      limit: 8,
      truncated: false,
      nodes: [],
      edges: [],
    });
  });
});
