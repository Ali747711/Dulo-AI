export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
};

export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON schema
  execute: (args: any) => Promise<string>;
};
