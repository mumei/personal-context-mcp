/**
 * Provides codex app server capabilities for the LLM integration layer.
 * Responsibility: This module owns the codex app server behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * LLM統合層のcodex app server機能を提供します。
 * 責務: このモジュールは、ここで宣言するcodex app serverの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

const maxStderrBytes = 8 * 1024;

export const CODEX_APP_SERVER_DEFAULT_MODEL = "gpt-6.1-sol";

/**
 * Defines the public `CodexAppServerRequest` data contract exposed by this module.
 *
 * このモジュールが公開する`CodexAppServerRequest`データ契約を定義します。
 */
export interface CodexAppServerRequest {
  command: string;
  args: string[];
  prompt: string;
  cwd: string;
  model?: string;
  timeoutMs: number;
  outputSchema?: Record<string, unknown>;
}

/**
 * Defines the public `CodexAppServerResult` data contract exposed by this module.
 *
 * このモジュールが公開する`CodexAppServerResult`データ契約を定義します。
 */
export interface CodexAppServerResult {
  text: string;
  threadId?: string;
  turnId?: string;
}

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
  method?: string;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Performs the public `generateTextWithCodexAppServer` operation provided by this module.
 *
 * このモジュールが提供する公開操作`generateTextWithCodexAppServer`を実行します。
 */
export async function generateTextWithCodexAppServer(input: CodexAppServerRequest): Promise<CodexAppServerResult> {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const client = new JsonRpcClient(child);
  try {
    return await withTimeout(runCodexTurn(client, input), input.timeoutMs, () => {
      client.close(new Error(`Codex app-server timed out after ${input.timeoutMs}ms.`));
      terminateChild(child);
    });
  } finally {
    client.close();
    terminateChild(child);
  }
}

async function runCodexTurn(client: JsonRpcClient, input: CodexAppServerRequest): Promise<CodexAppServerResult> {
  await client.request("initialize", {
    clientInfo: {
      name: "personal-context-mcp",
      title: "Personal Context MCP",
      version: "0.1.0",
    },
  });
  client.notify("initialized", {});
  const threadResult = (await client.request("thread/start", {
    ...(input.model ? { model: input.model } : {}),
    cwd: input.cwd,
    ephemeral: true,
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly" },
    serviceName: "personal-context-mcp",
  })) as { thread?: { id?: string } };
  const threadId = threadResult.thread?.id;
  if (!threadId) {
    throw new Error("Codex app-server did not return a thread id.");
  }

  const agentMessages = new Map<string, string>();
  let streamMessageId: string | undefined;
  let settleCompleted: ((error?: Error) => void) | undefined;
  const completed = new Promise<void>((resolve, reject) => {
    let settled = false;
    settleCompleted = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
  });
  client.onFailure((error) => settleCompleted?.(error));
  client.onNotification((message) => {
    if (message.method === "item/agentMessage/delta") {
      const params = asRecord(message.params);
      const itemId = notificationItemId(params);
      const delta =
        typeof params.delta === "string" ? params.delta : typeof params.text === "string" ? params.text : "";
      if (delta) {
        const key = itemId ?? (streamMessageId ??= "__stream_agent_message__");
        agentMessages.set(key, `${agentMessages.get(key) ?? ""}${delta}`);
      }
      return;
    }
    if (message.method === "item/completed") {
      const item = asRecord(asRecord(message.params).item);
      if (item.type === "agentMessage" && typeof item.text === "string") {
        const itemId = notificationItemId(item);
        // App-server sends deltas before the complete item. Replace that buffer with
        // the authoritative completed text instead of appending it a second time.
        if (itemId && agentMessages.has(itemId)) {
          agentMessages.set(itemId, item.text);
        } else if (streamMessageId) {
          agentMessages.set(streamMessageId, item.text);
        } else if (itemId) {
          agentMessages.set(itemId, item.text);
        } else {
          agentMessages.set("__completed_agent_message__", item.text);
        }
      }
      return;
    }
    if (message.method === "turn/completed") {
      const turn = asRecord(asRecord(message.params).turn);
      if (turn.status === "failed") {
        const error = asRecord(turn.error);
        settleCompleted?.(new Error(String(error.message ?? "Codex app-server turn failed.")));
      } else {
        settleCompleted?.();
      }
      return;
    }
    if (message.method === "error") {
      const error = asRecord(asRecord(message.params).error);
      settleCompleted?.(new Error(String(error.message ?? "Codex app-server emitted an error.")));
    }
  });

  const turnResult = (await client.request("turn/start", {
    threadId,
    input: [{ type: "text", text: input.prompt }],
    cwd: input.cwd,
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly" },
    summary: "none",
    outputSchema: input.outputSchema ?? defaultOutputSchema(),
  })) as { turn?: { id?: string } };
  const turnId = turnResult.turn?.id;
  await completed;
  const text = [...agentMessages.values()].join("");
  if (!text.trim()) {
    throw new Error("Codex app-server completed without an agent message.");
  }
  return { text, threadId, turnId };
}

/**
 * Implements the public `JsonRpcClient` service provided by this module.
 *
 * このモジュールが提供する公開サービス`JsonRpcClient`を実装します。
 */
export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private notificationHandler?: (message: RpcResponse) => void;
  private failureHandler?: (error: Error) => void;
  private readonly stdout: Interface;
  private stderr = Buffer.alloc(0);
  private closed = false;
  private failure?: Error;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.stdout = createInterface({ input: child.stdout });
    this.stdout.on("line", this.handleLine);
    child.stderr.on("data", this.handleStderr);
    child.stdin.on("error", this.handleStdinError);
    child.stdin.once("close", this.handleStdinClose);
    child.on("error", this.handleChildError);
    child.on("exit", this.handleExit);
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed || this.failure) {
      return Promise.reject(this.failure ?? new Error("Codex app-server client is closed."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ method, id, params }, id);
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.closed) {
      this.write({ method, params });
    }
  }

  onNotification(handler: (message: RpcResponse) => void): void {
    this.notificationHandler = handler;
  }

  onFailure(handler: (error: Error) => void): void {
    this.failureHandler = handler;
    if (this.failure) handler(this.failure);
  }

  close(reason = new Error("Codex app-server client closed.")): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAll(reason);
    this.stdout.off("line", this.handleLine);
    this.stdout.close();
    this.child.stderr.off("data", this.handleStderr);
    this.child.off("error", this.handleChildError);
    this.child.off("exit", this.handleExit);
    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
      this.child.stdin.end();
    }
    this.notificationHandler = undefined;
    this.failureHandler = undefined;
  }

  private write(payload: unknown, requestId?: number): void {
    let line: string;
    try {
      line = `${JSON.stringify(payload)}\n`;
    } catch (error) {
      this.rejectRequest(requestId, toError(error, "Failed to serialize Codex app-server request."));
      return;
    }
    try {
      this.child.stdin.write(line, (error) => {
        if (error) this.rejectRequest(requestId, toError(error, "Failed to write to Codex app-server."));
      });
    } catch (error) {
      this.rejectRequest(requestId, toError(error, "Failed to write to Codex app-server."));
    }
  }

  private handleLine = (line: string): void => {
    if (this.closed || !line.trim()) return;
    try {
      const message = JSON.parse(line) as RpcResponse;
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(
              `Codex app-server error ${message.error.code ?? ""}: ${message.error.message ?? "unknown error"}`,
            ),
          );
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      this.notificationHandler?.(message);
    } catch (error) {
      this.fail(toError(error, "Invalid response from Codex app-server."));
    }
  };

  private handleStderr = (chunk: Buffer): void => {
    const combined = Buffer.concat([this.stderr, chunk]);
    this.stderr = combined.length > maxStderrBytes ? combined.subarray(-maxStderrBytes) : combined;
  };

  private handleStdinError = (error: Error): void => this.fail(error);
  private handleStdinClose = (): void => {
    this.child.stdin.off("error", this.handleStdinError);
  };
  private handleChildError = (error: Error): void => this.fail(error);
  private handleExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (!this.closed) {
      this.fail(
        new Error(
          `Codex app-server exited before completion: code=${code ?? "null"} signal=${signal ?? "null"} stderr=${this.stderr.toString("utf8")}`,
        ),
      );
    }
  };

  private rejectRequest(id: number | undefined, error: Error): void {
    if (id === undefined) {
      this.fail(error);
      return;
    }
    const pending = this.pending.get(id);
    if (pending) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private fail(error: Error): void {
    if (this.closed || this.failure) return;
    this.failure = error;
    this.rejectAll(error);
    this.failureHandler?.(error);
    this.close(error);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function notificationItemId(value: Record<string, unknown>): string | undefined {
  for (const key of ["itemId", "item_id", "id"]) {
    if (typeof value[key] === "string" && value[key].length > 0) return value[key];
  }
  return undefined;
}

function defaultOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            task_id: { type: "string" },
            done: { type: "array", items: { type: "string" } },
            next: { type: "array", items: { type: "string" } },
          },
          required: ["task_id", "done", "next"],
          additionalProperties: false,
        },
      },
    },
    required: ["entries"],
    additionalProperties: false,
  };
}

function terminateChild(child: ChildProcessWithoutNullStreams): void {
  if (!child.killed && child.exitCode === null) {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process can exit between the status check and kill.
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(value === undefined ? fallback : String(value));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          try {
            onTimeout();
          } finally {
            reject(new Error(`Codex app-server timed out after ${timeoutMs}ms.`));
          }
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
