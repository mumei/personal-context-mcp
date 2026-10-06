/**
 * Provides yaml capabilities for the ambient type layer.
 * Responsibility: This module owns the yaml behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * アンビエント型層のyaml機能を提供します。
 * 責務: このモジュールは、ここで宣言するyamlの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

declare module "*.yaml" {
  const value: Record<string, string>;
  export default value;
}
