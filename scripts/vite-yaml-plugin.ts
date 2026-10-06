/**
 * Provides a shared Vite transform that imports YAML files as JavaScript objects.
 * YAMLファイルをJavaScriptオブジェクトとしてimportする共通Vite変換を提供します。
 *
 * @remarks
 * This module only converts YAML modules and does not validate translation keys or application data.
 * このモジュールはYAMLモジュールの変換だけを担当し、翻訳キーやアプリケーションデータの検証は行いません。
 *
 * @packageDocumentation
 */
import type { Plugin } from "vite";
import { parse } from "yaml";

/** Creates the YAML transformation plugin used by Vite and Vitest. ViteとVitestで共有するYAML変換プラグインを作成します。 */
export function yamlPlugin(): Plugin {
  return {
    name: "task-mcp-yaml",
    transform(source, id) {
      if (!/\.ya?ml$/.test(id)) return null;
      return {
        code: `export default ${JSON.stringify(parse(source))};`,
        map: null,
      };
    },
  };
}
