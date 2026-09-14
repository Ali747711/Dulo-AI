// scripts/template-check.ts
// Proves the landing-page template still installs and builds at its pinned
// versions (AC-11). Not part of `npm test`: it hits the network and takes
// minutes. Run it whenever the template or its pins change.
//
//   npm run template:check
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const scratch = await mkdtemp(path.join(tmpdir(), "dulo-template-check-"));
process.env.DULO_WORKSPACE_DIR = scratch;

const { scaffoldProjectTool } = await import("../src/tools/scaffold.js");

const run = (command: string, args: string[], cwd: string): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.on("close", (code) => resolve(code ?? 1));
  });

let failed = false;
try {
  console.log(`[template-check] scaffolding into ${scratch}`);
  const out = await scaffoldProjectTool.execute({
    slug: "template-check",
    name: "Template Check",
  });
  console.log(out.split("\n").slice(-3).join("\n"));

  const project = path.join(scratch, "template-check");
  console.log("[template-check] npm run build");
  const build = await run("npm", ["run", "build"], project);
  if (build !== 0) {
    console.error("[template-check] FAILED: the template does not build");
    failed = true;
  }

  if (!failed) {
    console.log("[template-check] npm run lint");
    const lint = await run("npm", ["run", "lint"], project);
    if (lint !== 0) {
      console.error("[template-check] FAILED: the template does not lint clean");
      failed = true;
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

console.log(failed ? "[template-check] FAILED" : "[template-check] ok");
process.exit(failed ? 1 : 0);
