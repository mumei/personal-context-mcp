/**
 * Provides index capabilities for the web UI layer.
 * Responsibility: This module owns the index behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * Web UI層のindex機能を提供します。
 * 責務: このモジュールは、ここで宣言するindexの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { createI18n } from "vue-i18n";
import en from "#webUi/i18n/en.yaml";
import ja from "#webUi/i18n/ja.yaml";

export const messages = {
  ja,
  en,
};

const initialLocale = localStorage.getItem("task-mcp-language") === "en" ? "en" : "ja";
document.documentElement.lang = initialLocale;

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: "ja",
  messages,
});
