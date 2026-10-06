/**
 * Provides api capabilities for the web UI layer.
 * Responsibility: This module owns the api behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * Web UI層のapi機能を提供します。
 * 責務: このモジュールは、ここで宣言するapiの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

const token = sessionStorage.getItem("task-mcp-web-token");

function headers(json = false): HeadersInit {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Performs the public `getJson` operation provided by this module.
 *
 * このモジュールが提供する公開操作`getJson`を実行します。
 */
export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: headers() });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

/**
 * Performs the public `mutateJson` operation provided by this module.
 *
 * このモジュールが提供する公開操作`mutateJson`を実行します。
 */
export async function mutateJson<T>(path: string, method: "POST" | "PUT", body: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: headers(true), body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
