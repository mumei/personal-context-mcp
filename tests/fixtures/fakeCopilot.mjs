const args = process.argv.slice(2);
const promptIndex = args.indexOf("-p");
const modelIndex = args.indexOf("--model");
const prompt = promptIndex >= 0 ? (args[promptIndex + 1] ?? "") : "";
const model = modelIndex >= 0 ? (args[modelIndex + 1] ?? "") : "";

if (process.env.TASK_MCP_TEST_LLM_COUNT_FILE) {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(process.env.TASK_MCP_TEST_LLM_COUNT_FILE, "1\n");
}
for (const expected of (process.env.TASK_MCP_TEST_LLM_EXPECT_CONTAINS ?? "").split("||").filter(Boolean)) {
  if (!prompt.includes(expected)) {
    process.stderr.write(`Expected prompt fragment was missing: ${expected}`);
    process.exit(3);
  }
}
for (const rejected of (process.env.TASK_MCP_TEST_LLM_EXPECT_NOT_CONTAINS ?? "").split("||").filter(Boolean)) {
  if (prompt.includes(rejected)) {
    process.stderr.write(`Unexpected prompt fragment was present: ${rejected}`);
    process.exit(4);
  }
}
if (process.env.TASK_MCP_TEST_LLM_FAIL === "true") {
  process.stderr.write("Intentional provider failure");
  process.exit(5);
}

if (prompt.includes("timeout")) {
  await delay(500);
}

if (!prompt) process.exit(2);
process.stdout.write(process.env.TASK_MCP_TEST_LLM_RESPONSE ?? JSON.stringify({ model, prompt }));
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
