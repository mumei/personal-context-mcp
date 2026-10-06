/**
 * Configures Vue compilation, YAML imports, development proxying, and Web UI output for Vite.
 * ViteのVueコンパイル、YAML import、開発プロキシ、Web UI出力を構成します。
 *
 * @packageDocumentation
 */
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { yamlPlugin } from "./scripts/vite-yaml-plugin.ts";

export default defineConfig({
  root: "src/web-ui",
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
  build: {
    outDir: "../../dist/web-ui",
    emptyOutDir: false,
    assetsDir: "assets",
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
