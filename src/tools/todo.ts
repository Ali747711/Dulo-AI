// src/tools/todo.ts
// A plan the model can write down. Deliberately unglamorous: the tool just
// validates and echoes its input back, exactly as opencode's todowrite does,
// and gets no special treatment in the agent loop. Its whole value is giving
// the model a typed slot to externalise a plan that the UI can render as a
// checklist instead of burying it in prose.
import type { Tool } from "../types.js";

const STATUSES = ["pending", "in_progress", "done"] as const;
type Status = (typeof STATUSES)[number];

interface Todo {
  content: string;
  status: Status;
}

const MARK: Record<Status, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  done: "[x]",
};

export const manageTodosTool: Tool = {
  name: "manage_todos",
  description:
    "Record or update your plan as a checklist. Call this at the start of a " +
    "multi-step task and again whenever an item changes state. Send the whole " +
    "list every time; it replaces the previous one. Keep exactly one item " +
    "in_progress.",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "The full list, in order",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "What needs doing" },
            status: { type: "string", enum: [...STATUSES] },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  },
  execute: async ({ todos }: { todos: Todo[] }) => {
    if (!Array.isArray(todos)) {
      throw new Error("todos must be an array");
    }
    const cleaned = todos.map((todo, i) => {
      if (!todo || typeof todo.content !== "string" || !todo.content.trim()) {
        throw new Error(`todos[${i}].content must be a non-empty string`);
      }
      if (!STATUSES.includes(todo.status)) {
        throw new Error(
          `todos[${i}].status must be one of ${STATUSES.join(", ")}`,
        );
      }
      return { content: todo.content.trim(), status: todo.status };
    });

    const inProgress = cleaned.filter((t) => t.status === "in_progress").length;
    if (inProgress > 1) {
      throw new Error(
        `${inProgress} items are in_progress; exactly one should be at a time`,
      );
    }

    const done = cleaned.filter((t) => t.status === "done").length;
    const lines = cleaned.map((t) => `${MARK[t.status]} ${t.content}`);
    return `${done}/${cleaned.length} done\n${lines.join("\n")}`;
  },
};

export const todoTools: Tool[] = [manageTodosTool];
