/**
 * Provides MCP JSON response conversion and metadata extraction for audit logging.
 * MCPのJSONレスポンス変換と監査ログ向けメタデータ抽出を提供します。
 *
 * @remarks
 * It only handles MCP content envelopes and does not generate or persist domain data.
 * MCPのcontent envelopeだけを扱い、ドメインデータの生成や永続化は担当しません。
 *
 * @packageDocumentation
 */

/** Converts a value into JSON text content for an MCP client. MCPクライアントへ返す値をJSONテキストcontentへ変換します。 */
export function jsonText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/** Extracts a JSON payload suitable for audit logging from an MCP response. MCPレスポンスから監査ログに保存可能なJSON payloadを取り出します。 */
export function toolResultPayload(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return result;
  const textBlock = content.find(
    (item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text",
  ) as { text?: unknown } | undefined;
  if (typeof textBlock?.text !== "string") return result;
  try {
    return JSON.parse(textBlock.text) as unknown;
  } catch {
    return result;
  }
}

/** Extracts stable audit identifiers from SDK request metadata. SDKが渡すrequest情報から安定した監査識別子だけを抽出します。 */
export function requestLogIdentity(extra: unknown): { request_id?: string | number; client_session_id?: string } {
  if (!extra || typeof extra !== "object") return {};
  const value = extra as { requestId?: unknown; sessionId?: unknown };
  return {
    ...(typeof value.requestId === "string" || typeof value.requestId === "number"
      ? { request_id: value.requestId }
      : {}),
    ...(typeof value.sessionId === "string" ? { client_session_id: value.sessionId } : {}),
  };
}
