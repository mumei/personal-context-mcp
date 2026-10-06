/**
 * Exports an allowlisted source tree without changing the working tree or Git history.
 * Checks known sensitive markers without printing matched content. This is not a complete secret scanner.
 *
 * 許可したソースだけを出力し、作業ツリーとGit履歴は変更しません。
 * 既知の機微情報パターンを値を表示せず検査します。網羅的な秘密情報検査ではありません。
 */
import { cp, mkdir, readdir, readFile, realpath, lstat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

const root = fileURLToPath(new URL("../", import.meta.url));
const entries = [
  "LICENSE",
  "README.md",
  "package.json",
  "package-lock.json",
  ".gitignore",
  ".prettierignore",
  "eslint.config.js",
  "prettier.config.js",
  "tsconfig.json",
  "tsconfig.test.json",
  "tsconfig.web.json",
  "vite.config.ts",
  "vitest.config.ts",
  "src",
  "tests",
  "scripts/clean-dist.mjs",
  "scripts/third-party-notices.mjs",
  "scripts/vite-yaml-plugin.ts",
  "scripts/prepare-release.mjs",
  "docs/usage.md",
  "docs/configuration.md",
  "docs/tickets.md",
  "docs/context-isolation.md",
  "docs/licenses",
  "docs/publishing.md",
];
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\/Users\/(?!example(?:\/|\b))[A-Za-z0-9._-]+\//,
  /[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i,
];
async function inspect(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Review symlink in ${relative(root, path)}`);
  if (info.isDirectory()) {
    for (const name of await readdir(path)) await inspect(resolve(path, name));
  } else {
    const bytes = await readFile(path);
    if (bytes.includes(0)) return;
    const text = bytes.toString("utf8");
    const activePatterns = path.endsWith(`${sep}package-lock.json`) ? patterns.slice(0, -1) : patterns;
    if (activePatterns.some((pattern) => pattern.test(text))) {
      throw new Error(`Review sensitive marker in ${relative(root, path)} (content withheld)`);
    }
  }
}
const destination = process.argv[2];
if (!destination) throw new Error("Usage: npm run release:prepare -- /absolute/path/to/new-source-directory");
const target = resolve(destination);
const parent = await realpath(resolve(target, ".."));
if (parent === root.slice(0, -1) || parent.startsWith(root)) throw new Error("Destination must be outside the project");
for (const entry of entries) await inspect(resolve(root, entry));
await mkdir(target);
for (const entry of entries) {
  const path = resolve(target, entry);
  await mkdir(resolve(path, ".."), { recursive: true });
  await cp(resolve(root, entry), path, { recursive: true, dereference: false, errorOnExist: true, force: false });
}
console.log(`Exported ${entries.length} allowlisted entries to ${target}${sep}`);
