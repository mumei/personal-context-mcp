import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
const promptIndex = args.indexOf("-p");
const modelIndex = args.indexOf("--model");
const prompt = promptIndex >= 0 ? (args[promptIndex + 1] ?? "") : "";
const model = modelIndex >= 0 ? (args[modelIndex + 1] ?? "") : "";

if (prompt.includes("timeout")) await delay(500);
if (!prompt) process.exit(2);
process.stdout.write(
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: JSON.stringify({ model, prompt, cwd: process.cwd() }),
    session_id: "cursor-test-session",
  }),
);
