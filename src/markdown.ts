// src/markdown.ts
// Shared loader for the "a folder of Markdown files" pattern that skills and
// agents both use: YAML frontmatter for metadata, the body as content.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

export interface MarkdownDoc {
  /** Frontmatter `name`, falling back to the file name. */
  name: string;
  description: string;
  /** Everything after the frontmatter, trimmed. */
  body: string;
  data: Record<string, unknown>;
  file: string;
}

/**
 * Read every .md file in a directory. A missing directory is normal (the
 * feature is opt-in). A file that fails to parse is skipped with a warning
 * rather than stopping the harness from starting.
 */
export const loadMarkdownDir = async (dir: string): Promise<MarkdownDoc[]> => {
  const full = path.resolve(dir);
  let entries: string[];
  try {
    entries = (await readdir(full)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  const docs: MarkdownDoc[] = [];
  for (const entry of entries.sort()) {
    const file = path.join(full, entry);
    try {
      const parsed = matter(await readFile(file, "utf8"));
      const data = parsed.data as Record<string, unknown>;
      const name =
        typeof data.name === "string" && data.name.trim()
          ? data.name.trim()
          : path.basename(entry, ".md");
      docs.push({
        name,
        description:
          typeof data.description === "string" ? data.description.trim() : "",
        body: parsed.content.trim(),
        data,
        file: path.join(dir, entry),
      });
    } catch (error) {
      console.warn(
        `[dulo] skipping ${dir}/${entry}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return docs;
};
