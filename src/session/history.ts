// src/session/history.ts
// Project the root→head path of a session into the OpenAI-shaped Message[] the
// agent loop already consumes. Pure: attachment contents are passed in already
// read, so this needs no store and is trivially testable.
import type { Message } from "../types.js";
import { pathToHead } from "./tree.js";
import type { AttachmentPart, ChatMessage, Part, Session } from "./types.js";

export const DEFAULT_MAX_INLINE_CHARS = 20_000;

const TEXT_LIKE_MIME = /^(text\/|application\/(json|xml|javascript|typescript))/;
const TEXT_LIKE_EXT =
  /\.(md|txt|json|ya?ml|toml|csv|tsx?|[mc]?jsx?|py|go|rs|java|kt|c|h|cpp|cs|rb|php|sh|sql|html|css|xml|env\.example)$/i;

export const isTextLike = (part: AttachmentPart): boolean =>
  TEXT_LIKE_MIME.test(part.mime) || TEXT_LIKE_EXT.test(part.name);

/**
 * How one attachment appears in the prompt. `content` is the file's text when
 * it is text-like and was read; null renders the binary marker instead.
 */
export const renderAttachment = (
  part: AttachmentPart,
  content: string | null,
  maxInlineChars = DEFAULT_MAX_INLINE_CHARS,
): string => {
  if (content === null || !isTextLike(part)) {
    return `\n\n[attached file: ${part.name}, ${part.mime}, ${part.size} bytes — binary, not shown]`;
  }
  const clipped = content.length > maxInlineChars;
  const body = clipped
    ? `${content.slice(0, maxInlineChars)}\n[truncated: ${maxInlineChars} of ${content.length} characters]`
    : content;
  return `\n\n--- ${part.name} ---\n${body}\n--- end ${part.name} ---`;
};

const userContent = (
  parts: readonly Part[],
  attachments: ReadonlyMap<string, string>,
  maxInlineChars: number,
): string => {
  const text = parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
  const files = parts
    .filter((p): p is AttachmentPart => p.type === "attachment")
    .map((p) => renderAttachment(p, attachments.get(p.fileId) ?? null, maxInlineChars))
    .join("");
  return text + files;
};

/** Assistant parts → wire messages: text runs, tool_calls batches, tool results. */
const assistantMessages = (parts: readonly Part[]): Message[] => {
  const out: Message[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part.type === "text") {
      out.push({ role: "assistant", content: part.text });
      i++;
    } else if (part.type === "tool_call") {
      const batch: Message["tool_calls"] = [];
      while (i < parts.length && parts[i].type === "tool_call") {
        const call = parts[i] as Extract<Part, { type: "tool_call" }>;
        batch.push({
          id: call.callId,
          type: "function",
          function: { name: call.tool, arguments: JSON.stringify(call.args) },
        });
        i++;
      }
      out.push({ role: "assistant", content: null, tool_calls: batch });
    } else if (part.type === "tool_result") {
      out.push({
        role: "tool",
        tool_call_id: part.callId,
        name: part.tool,
        content: part.result,
      });
      i++;
    } else {
      i++; // attachments never appear on assistant messages
    }
  }
  return out;
};

export interface ProjectInput {
  session: Session;
  messages: readonly ChatMessage[];
  systemPrompt: string;
  /** fileId → text, for attachments already read by the caller. */
  attachments: ReadonlyMap<string, string>;
  maxInlineChars?: number;
}

export const projectHistory = ({
  session,
  messages,
  systemPrompt,
  attachments,
  maxInlineChars = DEFAULT_MAX_INLINE_CHARS,
}: ProjectInput): Message[] => {
  const path = pathToHead(messages, session.headId);
  const out: Message[] = [{ role: "system", content: systemPrompt }];

  // Memory only applies when what it summarised is actually on this branch.
  let start = 0;
  const memory = session.memory;
  if (memory) {
    const covered = path.findIndex((m) => m.id === memory.coversUpTo);
    if (covered !== -1) {
      out.push(
        { role: "user", content: `[Memory of earlier conversation]\n${memory.summary}` },
        { role: "assistant", content: "Understood." },
      );
      start = covered + 1;
    }
  }

  for (const message of path.slice(start)) {
    if (message.role === "user") {
      out.push({ role: "user", content: userContent(message.parts, attachments, maxInlineChars) });
    } else {
      out.push(...assistantMessages(message.parts));
    }
  }
  return out;
};
