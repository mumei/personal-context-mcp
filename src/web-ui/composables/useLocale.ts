/**
 * Provides use locale capabilities for the web UI layer.
 * Responsibility: This module owns the use locale behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * Web UI層のuse locale機能を提供します。
 * 責務: このモジュールは、ここで宣言するuse localeの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { useI18n } from "vue-i18n";
import { messages } from "#webUi/i18n/index";

/**
 * Defines the public `Language` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`Language`を定義します。
 */
export type Language = "ja" | "en";
/**
 * Defines the public `MessageKey` type used by this module's API.
 *
 * このモジュールのAPIで使用する公開型`MessageKey`を定義します。
 */
export type MessageKey = Extract<keyof typeof messages.ja, string>;

/**
 * Performs the public `useLocale` operation provided by this module.
 *
 * このモジュールが提供する公開操作`useLocale`を実行します。
 */
export function useLocale() {
  const { locale: language, t: translate } = useI18n({ useScope: "global" });
  function t(key: MessageKey, values?: Record<string, string | number>): string {
    return values ? translate(key, values) : translate(key);
  }
  function setLanguage(value: string): void {
    language.value = value === "en" ? "en" : "ja";
    localStorage.setItem("task-mcp-language", language.value);
    document.documentElement.lang = language.value;
  }
  return { language, t, setLanguage };
}
