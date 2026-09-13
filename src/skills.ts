// src/skills.ts
// A skill is a Markdown file in src/skills/. Only its name and description ever
// reach the system prompt; the body is loaded on demand through the load_skill
// tool. That is the whole point: situational instructions you do not pay for on
// every request.
import type { Tool } from "./types.js";
import { loadMarkdownDir, type MarkdownDoc } from "./markdown.js";

export const SKILLS_DIR = "src/skills";

export interface Skill {
  name: string;
  description: string;
  body: string;
  file: string;
}

const toSkill = (doc: MarkdownDoc): Skill => ({
  name: doc.name,
  description: doc.description,
  body: doc.body,
  file: doc.file,
});

export const loadSkills = async (): Promise<Skill[]> =>
  (await loadMarkdownDir(SKILLS_DIR))
    .map(toSkill)
    .filter((skill) => skill.body.length > 0);

/** The one-line-per-skill catalogue appended to the system prompt. */
export const describeSkills = (skills: Skill[]): string => {
  if (skills.length === 0) return "";
  const lines = skills.map(
    (s) => `- ${s.name}: ${s.description || "(no description)"}`,
  );
  return (
    `\n\nSkills available. Each is a set of instructions you can load when it ` +
    `applies to the task. Call load_skill with the name to read one before ` +
    `acting on it:\n${lines.join("\n")}`
  );
};

/** Built per run so the tool closes over the skills that were actually loaded. */
export const createSkillTool = (skills: Skill[]): Tool => ({
  name: "load_skill",
  description:
    "Load the full instructions for one of the named skills listed in the " +
    "system prompt. Call this before acting on a skill.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Skill name, exactly as listed in the system prompt",
        enum: skills.map((s) => s.name),
      },
    },
    required: ["name"],
  },
  execute: async ({ name }: { name: string }) => {
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      throw new Error(
        `No skill named "${name}". Available: ${
          skills.map((s) => s.name).join(", ") || "(none)"
        }`,
      );
    }
    return skill.body;
  },
});
