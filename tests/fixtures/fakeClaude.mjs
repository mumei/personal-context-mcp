import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
if (input === "hang") await delay(60_000);
const schemaIndex = process.argv.indexOf("--json-schema");
const modelIndex = process.argv.indexOf("--model");
process.stdout.write(
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "fake-session",
    duration_ms: 12,
    total_cost_usd: 0.001,
    structured_output: {
      received_prompt: input,
      model: process.argv[modelIndex + 1],
      schema_present: schemaIndex >= 0,
      tools_disabled: process.argv.includes("--tools") && process.argv[process.argv.indexOf("--tools") + 1] === "",
      strict_mcp: process.argv.includes("--strict-mcp-config"),
    },
  }),
);
