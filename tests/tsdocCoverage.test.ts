import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    }),
  );
  return files.flat();
}

function leadingTsdoc(source: string): string | undefined {
  const withoutShebang = source.replace(/^#![^\n]*(?:\n|$)/, "");
  return withoutShebang.match(/^\s*(\/\*\*[\s\S]*?\*\/)/)?.[1];
}

describe("source TSDoc coverage", () => {
  it("places @packageDocumentation in the leading TSDoc of every TypeScript source file", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const files = [
      ...(await collectTypeScriptFiles(path.join(projectRoot, "src"))),
      ...(await collectTypeScriptFiles(path.join(projectRoot, "scripts"))),
      path.join(projectRoot, "vite.config.ts"),
      path.join(projectRoot, "vitest.config.ts"),
    ];
    const missing: string[] = [];

    for (const file of files) {
      const doc = leadingTsdoc(await readFile(file, "utf8"));
      if (!doc?.includes("@packageDocumentation")) {
        missing.push(path.relative(projectRoot, file));
      }
    }

    expect(missing.sort()).toEqual([]);
  });

  it("documents each module in English before the corresponding Japanese text", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const files = [
      ...(await collectTypeScriptFiles(path.join(projectRoot, "src"))),
      ...(await collectTypeScriptFiles(path.join(projectRoot, "scripts"))),
      path.join(projectRoot, "vite.config.ts"),
      path.join(projectRoot, "vitest.config.ts"),
    ];
    const invalid: string[] = [];

    for (const file of files) {
      const doc = leadingTsdoc(await readFile(file, "utf8")) ?? "";
      const englishIndex = doc.search(/[A-Za-z]{3,}/);
      const japaneseIndex = doc.search(/[\u3040-\u30ff\u3400-\u9fff]/);
      if (englishIndex < 0 || japaneseIndex < 0 || englishIndex > japaneseIndex) {
        invalid.push(path.relative(projectRoot, file));
      }
    }

    expect(invalid.sort()).toEqual([]);
  });
});
