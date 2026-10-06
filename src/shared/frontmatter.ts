/**
 * Provides frontmatter capabilities for the shared foundation layer.
 * Responsibility: This module owns the frontmatter behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * 共通基盤層のfrontmatter機能を提供します。
 * 責務: このモジュールは、ここで宣言するfrontmatterの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import YAML from "yaml";
import type { FrontmatterDocument } from "#shared/types";

/**
 * Performs the public `parseFrontmatter` operation provided by this module.
 *
 * このモジュールが提供する公開操作`parseFrontmatter`を実行します。
 */
export function parseFrontmatter(text: string): FrontmatterDocument {
  if (!text.startsWith("---\n")) {
    return { data: {}, body: text };
  }

  const end = text.indexOf("\n---", 4);
  if (end < 0) {
    return { data: {}, body: text };
  }

  const yamlText = text.slice(4, end);
  const bodyStart = text.indexOf("\n", end + 4);
  const body = bodyStart >= 0 ? text.slice(bodyStart + 1) : "";
  const data = YAML.parse(yamlText) as Record<string, unknown> | null;
  return { data: data ?? {}, body };
}

/**
 * Performs the public `stringifyFrontmatter` operation provided by this module.
 *
 * このモジュールが提供する公開操作`stringifyFrontmatter`を実行します。
 */
export function stringifyFrontmatter(doc: FrontmatterDocument): string {
  return `---\n${YAML.stringify(doc.data)}---\n${doc.body}`;
}
