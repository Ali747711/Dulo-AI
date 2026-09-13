// src/index.ts
// CLI entry point. The web client uses src/server.ts instead.
import "dotenv/config";

import { runAgent } from "./agent.js";
import { closeRegistry, getRegistry, initRegistry } from "./registry.js";
import { createGate } from "./permissions.js";
import { createInterface } from "node:readline/promises";
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
    case "permission.ask":
      // The prompt itself is printed by the asker below.
      break;
    case "context.condensed":
      console.log(
        `… condensed ${event.droppedMessages} older messages (~${event.estimatedTokens} tokens now)`,
      );
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

  const registry = await initRegistry();

  // Interactive terminals get a real prompt. A piped or redirected stdin has
  // nobody to ask, so gated tools run as they did before the gate existed —
  // announced, not silently.
  const interactive = process.stdin.isTTY === true;
  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;

  const gate = createGate({
    gated: interactive ? registry.gatedTools : [],
    onAsk: () => {},
    onSettled: () => {},
  });

  const ask = async (call: {
    id: string;
    tool: string;
    args: Record<string, unknown>;
  }): Promise<boolean> => {
    const pending = gate.request(call);
    if (rl && registry.gatedTools.includes(call.tool)) {
      const preview = JSON.stringify(call.args).slice(0, 200);
      const answer = await rl.question(
        `\n? Allow ${call.tool}(${preview})  [y]es / [n]o / [a]lways: `,
      );
      const key = answer.trim().toLowerCase()[0];
      gate.resolve(call.id, key === "a" ? "always" : key === "y" ? "allow" : "deny");
    }
    return pending;
  };

  if (!interactive && registry.gatedTools.length > 0) {
    console.warn(
      `[dulo] stdin is not a terminal, so ${registry.gatedTools.length} gated tool(s) will run without asking`,
    );
  }

  console.log("User:", query);
  const result = await runAgent(query, {
    agent,
    onEvent: printEvent,
    requestPermission: ask,
  });
  rl?.close();

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
