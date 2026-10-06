import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateTextWithLmStudio,
  lmStudioRequestBody,
  parseLmStudioResponse,
  type LmStudioRequest,
} from "#llm/providers/lmStudio";

const request: LmStudioRequest = {
  baseUrl: "http://127.0.0.1:1234/v1",
  apiToken: "test-token",
  prompt: "Summarize this task.",
  model: "local-model",
  timeoutMs: 2_000,
  outputSchema: {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
    additionalProperties: false,
  },
};

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

describe("LM Studio provider", () => {
  it("builds a deterministic structured-output request", () => {
    expect(lmStudioRequestBody(request)).toMatchObject({
      model: "local-model",
      temperature: 0,
      stream: false,
      response_format: {
        type: "json_schema",
        json_schema: { name: "task_mcp_response", strict: true, schema: request.outputSchema },
      },
    });
  });

  it("parses generated text and rejects missing content", () => {
    expect(parseLmStudioResponse({ choices: [{ message: { content: '{"summary":"done"}' } }] })).toEqual({
      text: '{"summary":"done"}',
    });
    expect(() => parseLmStudioResponse({ choices: [] })).toThrow("did not contain generated text");
  });

  it("calls the OpenAI-compatible endpoint with authentication", async () => {
    let receivedPath = "";
    let receivedAuthorization = "";
    let receivedBody: Record<string, unknown> = {};
    const server = createServer(async (req, res) => {
      receivedPath = req.url ?? "";
      receivedAuthorization = String(req.headers.authorization ?? "");
      receivedBody = JSON.parse(await readBody(req)) as Record<string, unknown>;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: '{"summary":"local"}' } }] }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to TCP.");

    const result = await generateTextWithLmStudio({
      ...request,
      baseUrl: `http://127.0.0.1:${address.port}/v1/`,
    });

    expect(result.text).toBe('{"summary":"local"}');
    expect(receivedPath).toBe("/v1/chat/completions");
    expect(receivedAuthorization).toBe("Bearer test-token");
    expect(receivedBody).toMatchObject({ model: "local-model", temperature: 0 });
  });

  it("returns an explicit provider error without fallback", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "model not found" } }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to TCP.");

    await expect(
      generateTextWithLmStudio({ ...request, baseUrl: `http://127.0.0.1:${address.port}/v1` }),
    ).rejects.toThrow("HTTP 400: model not found");
  });
});
