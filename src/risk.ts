// src/risk.ts
// What a tool call would actually do, judged from the tool AND its arguments.
//
// The old gate knew only a tool's name, so `shell` was both "npm run build" and
// "node deploy.js" and both asked the same question. A name cannot carry that
// difference; the arguments can. Three answers:
//
//   allowed — ordinary work, confined to the workspace or a plain read. No prompt.
//   ask     — leaves the workspace: the network, code we have not inspected,
//             unknown tools. Prompted once; the user may wave it through for the turn.
//   confirm — cannot be undone from here: deploys, pushes, writes to other people's
//             systems, deleting a tree. Prompted every time, with no blanket yes.
//
// Anything unrecognised is `ask`. A new tool never gains the right to act unasked
// by being forgotten.
//
// This module is pure on purpose: it decides whether an action is safe, so it must
// not itself read, write, spawn or fetch anything.
import { parseCommandLine } from "./tools/system.js";

export type RiskTier = "allowed" | "ask" | "confirm";

export interface RiskAssessment {
  tier: RiskTier;
  /** One sentence, plain language, starting "Dulo wants to …". */
  what: string;
  /** The thing being acted on: a path, a host, an account, a command. */
  where: string;
  /** Whether it can be taken back, in plain language. */
  undo: string;
}

export interface RiskPolicy {
  /** Tool names forced to `allowed`. */
  allowTools: string[];
  /** Tool names forced to `confirm`. Wins over allowTools. */
  confirmTools: string[];
}

const NO_POLICY: RiskPolicy = { allowTools: [], confirmTools: [] };

const UNDO = {
  nothing: "Nothing on your computer changes.",
  workspace: "It only touches files in Dulo's workspace, which you can change or delete yourself.",
  gone: "This cannot be undone from here.",
  outside: "Undoing it means going to that service and reversing it there.",
} as const;

const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const allowed = (what: string, where: string, undo: string = UNDO.workspace): RiskAssessment => ({
  tier: "allowed",
  what,
  where,
  undo,
});
const ask = (what: string, where: string, undo: string): RiskAssessment => ({
  tier: "ask",
  what,
  where,
  undo,
});
const confirm = (what: string, where: string, undo: string = UNDO.gone): RiskAssessment => ({
  tier: "confirm",
  what,
  where,
  undo,
});

// ---------------------------------------------------------------- shell ----

/** Read-only programs: they report, they do not change anything. */
const SHELL_READS = new Set([
  "ls", "cat", "head", "tail", "grep", "wc", "echo", "pwd", "date",
  "whoami", "id", "uname", "df", "du", "ps", "top", "free",
]);

/**
 * `find` reports — until a flag makes it act. `find . -delete` is the same
 * action as remove_path{recursive}, which confirms, and find's own path
 * argument is not confined to the workspace at all.
 */
const FIND_ACTS = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fls"]);

/**
 * Flags that move what a program operates on outside the workspace. The tool's
 * own `cwd` goes through resolveSafe; these do not, so npm's --prefix or git's
 * -C would quietly relocate the whole operation.
 */
const ESCAPES_WORKSPACE = new Set(["--prefix", "--cwd", "-C", "--directory", "--workspace-root"]);

/** Flags that make a compiler write wherever it is told. */
const REDIRECTS_OUTPUT = new Set(["--outDir", "--outFile", "--out"]);

/** `npm <sub>` that only builds, checks or installs, all inside the workspace. */
const NPM_SAFE_SUBCOMMANDS = new Set(["install", "i", "ci", "test", "ls", "list", "why", "view"]);
/** `npm run <script>` that is part of building, not shipping. */
const NPM_SAFE_SCRIPTS = new Set([
  "build", "typecheck", "lint", "test", "preview", "dev", "start", "format",
]);
/** `git <sub>` that only reports. */
const GIT_READS = new Set(["status", "diff", "log", "show", "branch", "rev-parse", "describe"]);
/** `git <sub>` that writes, but only to the workspace's own repository. */
const GIT_LOCAL_WRITES = new Set(["init", "add", "commit", "checkout", "switch", "restore", "stash", "tag"]);

/**
 * Programs that execute code this harness has never seen. They can do anything
 * the harness can, including reach the network, so gating `http_request` while
 * waving these through would be a boundary in name only.
 */
const RUNS_ARBITRARY_CODE = new Set(["node", "npx", "python", "python3", "go", "cargo", "rustc", "make", "tsx"]);

const classifyShell = (args: Record<string, unknown>): RiskAssessment => {
  const command = text(args.command);
  const unreadable = ask(
    "Dulo wants to run a command it could not describe",
    command || "(empty command)",
    "Look at the technical details before allowing it.",
  );
  if (!command) return unreadable;

  let tokens: string[];
  try {
    tokens = parseCommandLine(command);
  } catch {
    return unreadable;
  }
  const [binary, ...rest] = tokens;
  if (!binary) return unreadable;
  // A quote left open swallows the rest of the line, so what we judge would not
  // be what runs. Refuse to guess.
  if ((command.match(/"/g)?.length ?? 0) % 2 === 1 || (command.match(/'/g)?.length ?? 0) % 2 === 1) {
    return unreadable;
  }

  const sub = rest.find((token) => !token.startsWith("-")) ?? "";

  if (rest.some((token) => ESCAPES_WORKSPACE.has(token))) {
    return ask(
      `Dulo wants to run "${binary}" somewhere other than the workspace`,
      command,
      "The workspace is the only place Dulo is confined to; this flag points outside it.",
    );
  }

  if (binary === "find") {
    return rest.some((token) => FIND_ACTS.has(token))
      ? confirm("Dulo wants to find files and then delete or run something on each one", command)
      : allowed("Dulo wants to find files by name", command, UNDO.nothing);
  }

  if (binary === "tsc") {
    return rest.some((token) => REDIRECTS_OUTPUT.has(token))
      ? ask(
          "Dulo wants to compile the project and write the result somewhere it chose",
          command,
          "Check where it is writing to.",
        )
      : allowed("Dulo wants to compile and type-check the project", command);
  }

  if (binary === "npm") {
    if (sub === "publish") {
      return confirm("Dulo wants to publish a package to the public npm registry", command);
    }
    if (sub === "run") {
      const script = rest[rest.indexOf("run") + 1] ?? "";
      if (/deploy|publish|release/.test(script)) {
        return confirm(`Dulo wants to run the "${script}" script, which puts something live`, command);
      }
      return NPM_SAFE_SCRIPTS.has(script)
        ? allowed(`Dulo wants to run the "${script}" script for the project`, command)
        : ask(
            `Dulo wants to run the "${script || "(unnamed)"}" script, which can do anything`,
            command,
            "It runs code from the project, so check what that script does.",
          );
    }
    // Known and accepted: `npm install` and `npm run <script>` hand execution to
    // npm, which runs package.json scripts (and dependencies' install scripts)
    // through a real shell. That is the same power `node` has, and it is asked
    // about. It stays allowed because it IS the ordinary build path the owner
    // asked to run uninterrupted (Decisions 4) — a build that prompts teaches
    // people to click yes. Named in the design and the README rather than
    // pretended away; closing it needs a sandbox, not a rule.
    if (NPM_SAFE_SUBCOMMANDS.has(sub)) {
      return sub === "install" || sub === "i" || sub === "ci"
        ? allowed("Dulo wants to install the project's dependencies", command)
        : allowed("Dulo wants to check something about the project's packages", command);
    }
    return ask(
      `Dulo wants to run "npm ${sub}"`,
      command,
      "It may change the project or reach the internet.",
    );
  }

  if (binary === "git") {
    if (sub === "push") {
      return confirm("Dulo wants to send code to a remote repository", command, UNDO.outside);
    }
    if (GIT_READS.has(sub)) {
      return allowed("Dulo wants to look at the project's version history", command, UNDO.nothing);
    }
    if (GIT_LOCAL_WRITES.has(sub)) {
      return allowed("Dulo wants to record a change in the project's own history", command);
    }
    return ask(
      `Dulo wants to run "git ${sub}"`,
      command,
      "Some git commands reach other machines; check the details.",
    );
  }

  if (RUNS_ARBITRARY_CODE.has(binary)) {
    return ask(
      `Dulo wants to run a program with "${binary}"`,
      command,
      "It runs code Dulo wrote or downloaded, which can do anything this app can.",
    );
  }

  if (SHELL_READS.has(binary)) {
    return allowed("Dulo wants to look at files or system information", command, UNDO.nothing);
  }

  return ask(
    `Dulo wants to run "${binary}"`,
    command,
    "Dulo has no rule for this command, so it is asking first.",
  );
};

// ------------------------------------------------------------ built-ins ----

type Rule = (args: Record<string, unknown>) => RiskAssessment;

const BUILTIN: Record<string, Rule> = {
  // Reads and local conveniences.
  read_file: (a) => allowed("Dulo wants to read a file", text(a.path, "a file"), UNDO.nothing),
  list_files: (a) => allowed("Dulo wants to list a folder", text(a.dir, "the workspace"), UNDO.nothing),
  glob: (a) => allowed("Dulo wants to find files by name", text(a.pattern, "the workspace"), UNDO.nothing),
  grep_files: (a) => allowed("Dulo wants to search inside files", text(a.pattern, "the workspace"), UNDO.nothing),
  get_current_time: () => allowed("Dulo wants the current time", "this computer", UNDO.nothing),
  calculate: () => allowed("Dulo wants to do a calculation", "nothing outside this chat", UNDO.nothing),
  get_random_number: () => allowed("Dulo wants a random number", "nothing outside this chat", UNDO.nothing),
  get_uuid: () => allowed("Dulo wants a unique identifier", "nothing outside this chat", UNDO.nothing),
  generate_password: () => allowed("Dulo wants to generate a password", "nothing outside this chat", UNDO.nothing),
  get_system_info: () => allowed("Dulo wants basic information about this computer", "this computer", UNDO.nothing),
  manage_todos: () => allowed("Dulo wants to update its checklist", "this conversation", UNDO.nothing),

  // Reading the environment can put an API key or a token into the transcript,
  // which is not a read like any other.
  get_env: (a) =>
    ask(
      "Dulo wants to read a setting from this computer's environment",
      text(a.name, "an environment variable"),
      "Nothing changes, but the value could include a password or key.",
    ),

  // Writes, all confined to the workspace by resolveSafe.
  write_file: (a) => allowed("Dulo wants to write a file", text(a.path, "a file in the workspace")),
  edit_file: (a) => allowed("Dulo wants to change part of a file", text(a.path, "a file in the workspace")),
  make_dir: (a) => allowed("Dulo wants to create a folder", text(a.path, "the workspace")),
  move_path: (a) =>
    allowed("Dulo wants to move or rename something", `${text(a.from, "?")} → ${text(a.to, "?")}`),
  file_compress: (a) => allowed("Dulo wants to compress a file", text(a.inputPath, "a file in the workspace")),
  file_extract: (a) => allowed("Dulo wants to extract an archive", text(a.inputPath, "a file in the workspace")),
  scaffold_project: (a) =>
    allowed(`Dulo wants to create a new project called "${text(a.name, "a project")}"`, text(a.slug, "the workspace")),
  dev_server: (a) => {
    const action = text(a.action, "start");
    const project = text(a.project, "a project");
    if (action === "stop") return allowed("Dulo wants to stop the preview server", project, UNDO.nothing);
    if (action === "status") return allowed("Dulo wants to see which previews are running", project, UNDO.nothing);
    return allowed(
      "Dulo wants to start a preview server so you can see the page",
      project,
      "It runs only on this computer and can be stopped at any time.",
    );
  },

  // The one workspace action that cannot be taken back.
  remove_path: (a) =>
    a.recursive === true
      ? confirm(
          "Dulo wants to delete a folder and everything inside it",
          text(a.path, "a folder in the workspace"),
        )
      : allowed("Dulo wants to delete a file", text(a.path, "a file in the workspace")),

  // The network.
  http_request: (a) => {
    const url = text(a.url, "a web address");
    const method = text(a.method, "GET").toUpperCase();
    let host = url;
    try {
      host = new URL(url).host || url;
    } catch {
      host = url;
    }
    return method === "GET" || method === "HEAD"
      ? ask("Dulo wants to download something from the internet", host, "Nothing on your computer changes; it is only reading.")
      : confirm(
          `Dulo wants to send a ${method} request to another service, which can change data there`,
          host,
          UNDO.outside,
        );
  },
  dns_lookup: (a) =>
    ask("Dulo wants to look up a domain name", text(a.hostname, "a domain"), UNDO.nothing),
  ping: (a) => ask("Dulo wants to check whether a host responds", text(a.host ?? a.hostname, "a host"), UNDO.nothing),
  port_check: (a) =>
    ask("Dulo wants to check whether a network port is open", text(a.host ?? a.hostname, "a host"), UNDO.nothing),
  get_weather: (a) => ask("Dulo wants to look up the weather", text(a.location ?? a.city, "a place"), UNDO.nothing),

  shell: classifyShell,
};

// ------------------------------------------------------------------ MCP ----

/**
 * Read-only tools from MCP servers that the Review step depends on. Without
 * these, checking a page would be a wall of prompts, and a person who is asked
 * thirty times learns to say yes without reading — which is the failure this
 * whole design exists to prevent.
 *
 * `*_evaluate`/`evaluate_script` run JavaScript inside the page being reviewed.
 * That is how the definition-of-done checks read computed styles. It is page
 * context, not this computer, and the page is normally Dulo's own dev server.
 */
const MCP_ALLOWED = [
  /^playwright_browser_(navigate|navigate_back|snapshot|take_screenshot|console_messages|network_requests?|resize|evaluate|hover|wait_for|find|close|tabs)$/,
  /^chrome-devtools_(navigate_page|new_page|close_page|select_page|list_pages|take_snapshot|take_screenshot|evaluate_script|resize_page|emulate|list_console_messages|get_console_message|list_network_requests|get_network_request|lighthouse_audit|hover|wait_for|performance_.*)$/,
  /^a11y_/,
  /^context7_/,
];

/** Anything that changes another system, spends money, or cannot be taken back. */
const MCP_CONFIRM = [
  /(^|_)(deploy|publish|release|promote|rollback)([_-]|$)/i,
  /(^|_)delete([_-]|$)/i,
  /^github_(create|update|delete|merge|push|add|fork|transfer)/i,
  /^vercel_(?!(get|list|read|search)).*/i,
  /^supabase_(?!(get|list|read|search)).*/i,
  /^linear_(create|update|delete|archive)/i,
  /^sentry_(update|delete|resolve|assign)/i,
  /run_code_unsafe$/,
];

const MCP_SERVERS = /^(playwright|chrome-devtools|a11y|context7|github|vercel|supabase|linear|sentry|npm)[_-]/;

const classifyMcp = (tool: string): RiskAssessment | undefined => {
  if (MCP_CONFIRM.some((pattern) => pattern.test(tool))) {
    const [server] = tool.split("_");
    return confirm(
      "Dulo wants to change something on a service outside this computer",
      `${server}: ${tool}`,
      UNDO.outside,
    );
  }
  if (MCP_ALLOWED.some((pattern) => pattern.test(tool))) {
    return allowed("Dulo wants to look at the page or its documentation", tool, UNDO.nothing);
  }
  if (MCP_SERVERS.test(tool)) {
    const [server] = tool.split("_");
    return ask(
      `Dulo wants to use ${server}, which is outside this computer`,
      tool,
      "Check the technical details: it may read or change data on that service.",
    );
  }
  return undefined;
};

// ------------------------------------------------------------- classify ----

/** Tools created per turn by the loop; they spend model calls, not trust. */
const LOOP_TOOLS = new Set(["report_done", "review_verdict", "load_skill"]);

/**
 * Decide what a tool call would do. Pure: same inputs, same answer, no effects.
 */
export const classify = (
  tool: string,
  args: Record<string, unknown> = {},
  policy: RiskPolicy = NO_POLICY,
): RiskAssessment => {
  // Tightening wins: an explicit confirm is never undone by a stale allow entry.
  if (policy.confirmTools.includes(tool)) {
    return confirm(`Dulo wants to use "${tool}", which you marked as needing confirmation`, tool);
  }
  if (policy.allowTools.includes(tool)) {
    return allowed(`Dulo wants to use "${tool}", which you marked as always allowed`, tool);
  }

  if (LOOP_TOOLS.has(tool)) {
    return allowed("Dulo wants to use its own checklist", "this conversation", UNDO.nothing);
  }

  const builtin = BUILTIN[tool];
  if (builtin) return builtin(args);

  const mcp = classifyMcp(tool);
  if (mcp) return mcp;

  return ask(
    `Dulo wants to use "${tool}", something Dulo has no rule for`,
    tool,
    "Unknown tools are always asked about. Check the technical details.",
  );
};
