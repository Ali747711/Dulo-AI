// src/tools/scaffold.ts
// Create a new project in the workspace from a template Dulo owns.
//
// Deliberately not `npm create vite@latest`: that prompts, needs the network
// for the scaffold itself, and gives whatever the generator ships that week.
// A template in this repo is the same every time, carries the conventions the
// research settled (Tailwind v4 tokens in @theme, typed content in one file,
// one component per section), and lets the install run with a real timeout,
// which the shell tool's 30-second cap cannot give.
import { spawn } from "node:child_process";
import { cp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { TEMPLATES_DIR, WORKSPACE_ROOT } from "../paths.js";
import type { Tool } from "../types.js";
import { resolveSafe } from "./file.js";

/** Lower-case, hyphen-separated, short enough to be a folder and a package name. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Files whose text gets placeholder substitution; everything else is copied as is. */
const TEXT = new Set([".json", ".md", ".html", ".ts", ".tsx", ".css", ".svg", ".txt"]);

const INSTALL_TIMEOUT_MS = 180_000;
const TAIL_LINES = 20;
const IGNORED = new Set(["node_modules", ".git", "dist"]);

const tail = (text: string, lines = TAIL_LINES): string =>
  text.split("\n").filter(Boolean).slice(-lines).join("\n");

/** Relative paths of every file in the tree, node_modules and friends aside. */
const listTree = async (root: string, prefix = ""): Promise<string[]> => {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORED.has(entry.name)) continue;
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await listTree(root, rel)));
    else out.push(rel);
  }
  return out;
};

const fillPlaceholders = async (
  root: string,
  files: string[],
  values: Record<string, string>,
): Promise<void> => {
  await Promise.all(
    files
      .filter((file) => TEXT.has(path.extname(file)))
      .map(async (file) => {
        const full = path.join(root, file);
        const before = await readFile(full, "utf8");
        const after = Object.entries(values).reduce(
          (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
          before,
        );
        if (after !== before) await writeFile(full, after, "utf8");
      }),
  );
};

/** Run `npm install` in the project, bounded. Resolves with the output tail. */
const install = (cwd: string): Promise<{ ok: boolean; output: string }> =>
  new Promise((resolve) => {
    const child = spawn("npm", ["install", "--no-audit", "--no-fund"], {
      cwd,
      shell: false,
      env: process.env,
    });
    let output = "";
    const collect = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      // Keep memory bounded on a chatty install.
      if (output.length > 200_000) output = output.slice(-100_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      output += `\nnpm install exceeded ${INSTALL_TIMEOUT_MS / 1000}s and was stopped`;
    }, INSTALL_TIMEOUT_MS);
    timer.unref();

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `${output}\n${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });
  });

export const scaffoldProjectTool: Tool = {
  name: "scaffold_project",
  description:
    "Create a new frontend project in the workspace from Dulo's landing-page template " +
    "(Vite, React, TypeScript, Tailwind), then install its dependencies. Returns the " +
    "file tree and the end of the install output. Use this once, at the start of a build.",
  parameters: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description:
          "Folder and package name: lower-case letters, digits and hyphens, e.g. northwind-coffee",
      },
      name: {
        type: "string",
        description: "The business or product name as people write it, e.g. Northwind Coffee",
      },
      install: {
        type: "boolean",
        description: "Install dependencies after copying. Default true; false only for a dry run.",
      },
    },
    required: ["slug", "name"],
  },
  execute: async ({
    slug,
    name,
    install: shouldInstall = true,
  }: {
    slug: string;
    name: string;
    install?: boolean;
  }) => {
    if (!SLUG.test(slug)) {
      throw new Error(
        `"${slug}" is not a valid project name. Use lower-case letters, digits and hyphens, ` +
          `starting with a letter or digit, at most 40 characters.`,
      );
    }
    if (!name.trim()) throw new Error("name cannot be empty");

    const target = await resolveSafe(slug);
    let existing: string[] = [];
    try {
      existing = await readdir(target);
    } catch {
      existing = [];
    }
    if (existing.length > 0) {
      throw new Error(
        `"${slug}" already exists in the workspace and is not empty. ` +
          `Pick another name, or work in the project that is already there.`,
      );
    }

    const template = path.join(TEMPLATES_DIR, "landing-page");
    try {
      await readdir(template);
    } catch {
      throw new Error(
        `The landing-page template is missing from ${TEMPLATES_DIR}. The harness cannot scaffold without it.`,
      );
    }

    await cp(template, target, { recursive: true });
    // npm refuses to publish or pack a .gitignore inside a template, and some
    // tarball flows rename it; the copy keeps whatever the template has, but a
    // dot-prefixed file shipped as "gitignore" is normalised here for safety.
    const shipped = path.join(target, "gitignore");
    await rename(shipped, path.join(target, ".gitignore")).catch(() => {});

    const files = await listTree(target);
    await fillPlaceholders(target, files, { slug, name });

    const tree = files.map((file) => `  ${slug}/${file}`).join("\n");
    if (!shouldInstall) {
      return `Created ${slug} from the landing-page template (dependencies not installed).\n${tree}`;
    }

    const result = await install(target);
    if (!result.ok) {
      throw new Error(
        `Created ${slug}, but installing its dependencies failed. The folder is left in place ` +
          `so you can look at it.\n\nnpm install output:\n${tail(result.output)}`,
      );
    }
    return (
      `Created ${slug} from the landing-page template and installed its dependencies.\n` +
      `${tree}\n\nnpm install:\n${tail(result.output, 5)}\n\n` +
      `Next: replace the placeholder content in src/content/site.ts, index.html and ` +
      `src/index.css, then add one component per section under src/components/sections/.`
    );
  },
};

/** Remove a scaffolded project. Used by tests; not exposed as a tool. */
export const removeProject = async (slug: string): Promise<void> => {
  await rm(path.join(WORKSPACE_ROOT, slug), { recursive: true, force: true });
};

export const scaffoldTools: Tool[] = [scaffoldProjectTool];
