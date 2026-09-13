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
  /**
   * Run the tool. Resolve with the text the model should see.
   *
   * Signal failure by THROWING, not by returning a string starting with
   * "Error:". The agent turns a thrown error into exactly that text for the
   * model and flags the call as failed; a returned string is always a success.
   *
   * `signal` aborts when the run is cancelled. Any tool that can run for more
   * than an instant should pass it to whatever it waits on.
   */
  execute: (args: any, signal?: AbortSignal) => Promise<string>;
};
