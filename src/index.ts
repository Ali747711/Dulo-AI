// src/index.ts
// CLI entry point. The web client uses src/server.ts instead.
import "dotenv/config";

import { runAgent } from "./agent.js";
import { closeRegistry, initRegistry } from "./registry.js";
import type { RunEvent } from "./events.js";

/** Set once the answer has been printed token by token, so it is not repeated. */
let streamed = false;

const printEvent = (event: RunEvent): void => {
  switch (event.type) {
    case "step.start":
      console.log(`\n--- Step ${event.step} ---`);
      break;
    case "tool.call":
      console.log(`→ Calling tool: ${event.tool}`, event.args);
      break;
    case "tool.result":
      console.log(`← Tool result (${event.durationMs}ms):`, event.result);
      break;
    case "assistant.delta":
      if (!streamed) process.stdout.write("\n");
      streamed = true;
      process.stdout.write(event.text);
      break;
    default:
      break;
  }
};

async function main() {
  const query = process.argv[2] || "What time is it and what is 15 * 8?";
  // --agent <name> picks a profile from agents/
  const agentFlag = process.argv.indexOf("--agent");
  const agent = agentFlag !== -1 ? process.argv[agentFlag + 1] : undefined;

  await initRegistry();

  console.log("User:", query);
  const result = await runAgent(query, { agent, onEvent: printEvent });

  if (result.status === "completed") {
    if (streamed) console.log("");
    else console.log("\nFinal Answer:", result.finalAnswer);
  } else {
    console.error(`\nRun ${result.status}:`, result.error ?? "");
    process.exitCode = 1;
  }

  if (result.usage) {
    console.log(
      `\n${result.steps} step(s), ${result.durationMs}ms, ` +
        `${result.usage.totalTokens} tokens ` +
        `(${result.usage.promptTokens} in / ${result.usage.completionTokens} out)`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  // stdio MCP servers are child processes and would otherwise be orphaned.
  .finally(() => closeRegistry());
