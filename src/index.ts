// src/index.ts
// CLI entry point. The web client uses src/server.ts instead.
import "dotenv/config";

import { runAgent } from "./agent.js";
import type { RunEvent } from "./events.js";

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
    default:
      break;
  }
};

async function main() {
  const query = process.argv[2] || "What time is it and what is 15 * 8?";

  console.log("User:", query);
  const result = await runAgent(query, { onEvent: printEvent });

  if (result.status === "completed") {
    console.log("\nFinal Answer:", result.finalAnswer);
  } else {
    console.error(`\nRun ${result.status}:`, result.error ?? "");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
