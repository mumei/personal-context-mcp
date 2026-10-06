import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isMainModule } from "#shared/isMainModule";

describe("CLI entrypoint detection", () => {
  it("recognizes direct and npm-style symlink execution with spaces in the path", async () => {
    const root = await mkdtemp(join(tmpdir(), "entrypoint-check-"));
    try {
      const main = join(root, "server with spaces.js");
      const bin = join(root, "cli-bin");
      await writeFile(main, "");
      await symlink(main, bin);
      const url = pathToFileURL(realpathSync(main)).href;
      expect(isMainModule(url, main)).toBe(true);
      expect(isMainModule(url, bin)).toBe(true);
      expect(isMainModule("file:///other.js", bin)).toBe(false);
      expect(isMainModule(url, join(root, "missing"))).toBe(false);
      expect(isMainModule(url, "")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
