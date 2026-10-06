import { describe, expect, it } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "#shared/frontmatter";

describe("frontmatter", () => {
  it("parses YAML frontmatter and body", () => {
    const doc = parseFrontmatter("---\ntitle: Example\ntags:\n  - mcp\n---\nBody text\n");

    expect(doc.data).toEqual({ title: "Example", tags: ["mcp"] });
    expect(doc.body).toBe("Body text\n");
  });

  it("round-trips structured metadata", () => {
    const text = stringifyFrontmatter({
      data: { title: "Task context", priority: 2 },
      body: "Current context\n",
    });

    expect(parseFrontmatter(text)).toEqual({
      data: { title: "Task context", priority: 2 },
      body: "Current context\n",
    });
  });

  it("treats plain markdown as body", () => {
    expect(parseFrontmatter("# Plain context").body).toBe("# Plain context");
  });
});
