/**
 * Executes schema-oriented text generation through the LM Studio OpenAI-compatible API.
 * Responsibility: This module owns LM Studio HTTP requests, structured-output payloads, response parsing, and timeouts.
 * Non-responsibility: This module does not select providers, start LM Studio, load models, or persist generated data.
 *
 * LM StudioのOpenAI互換APIを通じてスキーマ指向のテキスト生成を実行します。
 * 責務: このモジュールは、LM StudioへのHTTP要求、構造化出力payload、応答解析、timeoutを担当します。
 * 非責務: このモジュールは、Provider選択、LM Studioの起動、モデル読込、生成データの永続化を担当しません。
 *
 * @packageDocumentation
 */

export const LM_STUDIO_DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1";
export const LM_STUDIO_DEFAULT_MODEL = "openai/gpt-oss-20b";

export interface LmStudioRequest {
  baseUrl: string;
  apiToken?: string;
  prompt: string;
  model: string;
  timeoutMs: number;
  outputSchema: Record<string, unknown>;
}

export interface LmStudioResult {
  text: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  error?: {
    message?: unknown;
  };
}

function chatCompletionsUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("LM Studio base URL is invalid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("LM Studio base URL must use http or https.");
  }
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/chat/completions`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

/** Builds the OpenAI-compatible Chat Completions payload used by LM Studio. */
export function lmStudioRequestBody(request: LmStudioRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: [
      {
        role: "system",
        content:
          "Answer only from the supplied text. Do not call tools, inspect files, or add facts that are not present in the input.",
      },
      { role: "user", content: request.prompt },
    ],
    temperature: 0,
    stream: false,
    ...(Object.keys(request.outputSchema).length > 0
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "task_mcp_response",
              strict: true,
              schema: request.outputSchema,
            },
          },
        }
      : {}),
  };
}

/** Parses generated text from an LM Studio Chat Completions response. */
export function parseLmStudioResponse(value: unknown): LmStudioResult {
  if (!value || typeof value !== "object") throw new Error("LM Studio returned an invalid response object.");
  const response = value as ChatCompletionResponse;
  if (response.error) {
    const message = typeof response.error.message === "string" ? response.error.message : "provider error";
    throw new Error(`LM Studio generation failed: ${message}`);
  }
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LM Studio response did not contain generated text.");
  }
  return { text: content.trim() };
}

/** Runs one generation request against the configured LM Studio server. */
export async function generateTextWithLmStudio(request: LmStudioRequest): Promise<LmStudioResult> {
  let response: Response;
  try {
    response = await fetch(chatCompletionsUrl(request.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(request.apiToken ? { authorization: `Bearer ${request.apiToken}` } : {}),
      },
      body: JSON.stringify(lmStudioRequestBody(request)),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`LM Studio timed out after ${request.timeoutMs}ms.`);
    }
    throw new Error(`LM Studio request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`LM Studio returned a non-JSON response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const providerMessage =
      value && typeof value === "object" && "error" in value && typeof value.error === "object" && value.error
        ? String((value.error as { message?: unknown }).message ?? "provider error")
        : "provider error";
    throw new Error(`LM Studio request failed with HTTP ${response.status}: ${providerMessage}`);
  }
  return parseLmStudioResponse(value);
}
