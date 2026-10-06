/**
 * Configures Vitest to execute TypeScript and Vue tests with the shared YAML transform.
 * 共通YAML変換を使用してTypeScriptとVueのテストを実行するようVitestを構成します。
 *
 * @packageDocumentation
 */
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { yamlPlugin } from "./scripts/vite-yaml-plugin.ts";

export default defineConfig({
  plugins: [vue(), yamlPlugin()],
  resolve: {
    alias: {
      "#app": fileURLToPath(new URL("./src/application", import.meta.url)),
      "#domain": fileURLToPath(new URL("./src/domains", import.meta.url)),
      "#infra": fileURLToPath(new URL("./src/infrastructure", import.meta.url)),
      "#llm": fileURLToPath(new URL("./src/llm", import.meta.url)),
      "#mcp": fileURLToPath(new URL("./src/mcp", import.meta.url)),
      "#server": fileURLToPath(new URL("./src/server.ts", import.meta.url)),
      "#shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "#web": fileURLToPath(new URL("./src/web", import.meta.url)),
      "#webServer": fileURLToPath(new URL("./src/webServer.ts", import.meta.url)),
      "#webUi": fileURLToPath(new URL("./src/web-ui", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
