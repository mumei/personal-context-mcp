import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { generateTextWithCodexAppServer, JsonRpcClient } from "#llm/providers/codexAppServer";

function appServerScript(mode: "success" | "invalid-json" | "idle" | "exit"): string {
  return `
    let buffer = "";
    const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const request = JSON.parse(line);
        if ("${mode}" === "exit") { process.exit(0); continue; }
        if ("${mode}" === "invalid-json") { process.stdout.write("not json\\n"); continue; }
        if ("${mode}" === "idle") continue;
        if (request.method === "initialize") send({ id: request.id, result: {} });
        if (request.method === "thread/start") {
          if (request.params?.ephemeral !== true) send({ id: request.id, error: { code: -32602, message: "ephemeral required" } });
          else send({ id: request.id, result: { thread: { id: "thread-1", ephemeral: true } } });
        }
        if (request.method === "turn/start") {
          send({ id: request.id, result: { turn: { id: "turn-1" } } });
          send({ method: "item/agentMessage/delta", params: { itemId: "item-1", delta: "{\\"entries\\":" } });
          send({ method: "item/agentMessage/delta", params: { itemId: "item-1", delta: "[]}" } });
          send({ method: "item/completed", params: { item: { id: "item-1", type: "agentMessage", text: "{\\"entries\\":[]}" } } });
          send({ method: "turn/completed", params: { turn: { status: "completed" } } });
        }
      }
    });
  `;
}

function request(mode: "success" | "invalid-json" | "idle" | "exit", timeoutMs = 250) {
  return generateTextWithCodexAppServer({
    command: process.execPath,
    args: ["-e", appServerScript(mode)],
    prompt: "test",
    cwd: process.cwd(),
    timeoutMs,
  });
}

function fakeChild(): ChildProcessLike {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  return child as ChildProcessLike;
}

type ChildProcessLike = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
};

describe("Codex app-server client", () => {
  it("uses completed agent text to replace streamed deltas", async () => {
    await expect(request("success")).resolves.toMatchObject({
      text: '{"entries":[]}',
      threadId: "thread-1",
      turnId: "turn-1",
    });
  });

  it("rejects malformed stdout instead of throwing from the line handler", async () => {
    await expect(request("invalid-json")).rejects.toThrow("Unexpected token");
  });

  it("rejects pending work when a notification handler throws", async () => {
    const child = fakeChild();
    const client = new JsonRpcClient(child as never);
    client.onNotification(() => {
      throw new Error("notification failed");
    });

    const pending = client.request("test", {});
    child.stdout.write(`${JSON.stringify({ method: "notice", params: {} })}\n`);

    await expect(pending).rejects.toThrow("notification failed");
    client.close();
  });

  it("bounds stderr retained for an exit error and closes pending requests", async () => {
    const child = fakeChild();
    const client = new JsonRpcClient(child as never);
    const pending = client.request("test", {});
    child.stderr.write(Buffer.alloc(20 * 1024, "x"));
    child.emit("exit", 1, null);

    const error = (await pending.catch((reason: unknown) => reason)) as Error;
    expect(error.message).toContain("code=1");
    expect(error.message.length).toBeLessThan(9 * 1024);
    client.close();
  });

  it("rejects when the child exits or the request times out", async () => {
    await expect(request("exit")).rejects.toThrow("exited before completion");
    await expect(request("idle", 30)).rejects.toThrow("timed out after 30ms");
  });
});
