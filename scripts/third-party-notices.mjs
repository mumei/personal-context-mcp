/**
 * Preserves installed production dependency license texts alongside distributed Web bundles.
 * 配布するWebバンドルとともに、インストール済み本番依存のライセンス本文を保持します。
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import console from "node:console";

const root = new URL("../", import.meta.url);
const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
const notices = [];
for (const [path, metadata] of Object.entries(lock.packages)) {
  if (!path || metadata.dev) continue;
  const directory = new URL(`${path}/`, root);
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (metadata.optional && error.code === "ENOENT") continue;
    throw error;
  }
  const licenses = names.filter((name) => /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(name)).sort();
  const manifest = JSON.parse(await readFile(new URL("package.json", directory), "utf8"));
  let texts = await Promise.all(licenses.map((name) => readFile(new URL(name, directory), "utf8")));
  if (!texts.length && manifest.name === "@vue/devtools-api" && manifest.version === "6.6.4") {
    texts = [await readFile(new URL("docs/licenses/vue-devtools-api.txt", root), "utf8")];
  }
  if (!texts.length) throw new Error(`Missing license text for ${path}`);
  notices.push(`${manifest.name}@${manifest.version} (${metadata.license ?? "see license"})\n${texts.join("\n")}`);
}
await writeFile(new URL("dist/THIRD_PARTY_NOTICES.txt", root), notices.join("\n\n--------------------\n\n"));
console.log(`Preserved license texts for ${notices.length} production dependencies`);
