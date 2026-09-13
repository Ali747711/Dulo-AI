// src/session/testing/stub-llm.ts
// A minimal OpenAI-compatible /chat/completions stub for tests. Replies are
// chosen by a function of the request, so a test can prove what history the
// harness actually sent. Streams SSE exactly the way src/llm.ts expects.
import { createServer } from "node:http";

import type { Message } from "../../types.js";

export interface StubRequest {
  messages: Message[];
  tools?: unknown[];
  model: string;
}

export type StubReply =
  | { text: string; delayMs?: number }
  | { toolCall: { name: string; args: Record<string, unknown> }; delayMs?: number };

export interface StubLlm {
  url: string;
  /** Every request received, in order. */
  calls: StubRequest[];
  close: () => Promise<void>;
}

export const startStubLlm = async (
  reply: (request: StubRequest, callIndex: number) => StubReply,
): Promise<StubLlm> => {
  const calls: StubRequest[] = [];

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      const request = JSON.parse(body) as StubRequest;
      calls.push(request);
      const chosen = reply(request, calls.length - 1);

      const respond = () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const send = (payload: unknown) =>
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        if ("text" in chosen) {
          // Split into small chunks so delta accumulation is exercised.
          for (const piece of chosen.text.match(/.{1,6}/gs) ?? []) {
            send({ choices: [{ delta: { content: piece } }] });
          }
        } else {
          send({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `call_${calls.length}`,
                      function: {
                        name: chosen.toolCall.name,
                        arguments: JSON.stringify(chosen.toolCall.args),
                      },
                    },
                  ],
                },
              },
            ],
          });
        }
        send({
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
        res.write("data: [DONE]\n\n");
        res.end();
      };

      if (chosen.delayMs) setTimeout(respond, chosen.delayMs);
      else respond();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}/chat/completions`,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};

/** Point src/llm.ts at the stub for the rest of the process. */
export const useStubLlm = (stub: StubLlm): void => {
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_URL = stub.url;
};
