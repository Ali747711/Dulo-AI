import { describe, expect, it } from "vitest"

import type { ChatMessage } from "./session-types"
import { latestLeaf, pathToHead, siblingsOf } from "./tree"

const msg = (
  id: string,
  parentId: string | null,
  createdAt: string,
  role: "user" | "assistant" = "user"
): ChatMessage => ({
  id,
  sessionId: "s",
  parentId,
  role,
  parts: [{ type: "text", text: id }],
  createdAt,
})

//   u1 ─ a1 ─ u2 ─ a2
//             └─ u2b ─ a2b
const tree: ChatMessage[] = [
  msg("u1", null, "2026-01-01T00:00:01Z"),
  msg("a1", "u1", "2026-01-01T00:00:02Z", "assistant"),
  msg("u2", "a1", "2026-01-01T00:00:03Z"),
  msg("a2", "u2", "2026-01-01T00:00:04Z", "assistant"),
  msg("u2b", "a1", "2026-01-01T00:00:05Z"),
  msg("a2b", "u2b", "2026-01-01T00:00:06Z", "assistant"),
]

describe("pathToHead", () => {
  it("walks parent pointers, root first", () => {
    expect(pathToHead(tree, "a2b").map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "u2b",
      "a2b",
    ])
  })
  it("is empty for a null or unknown head", () => {
    expect(pathToHead(tree, null)).toEqual([])
    expect(pathToHead(tree, "nope")).toEqual([])
  })
})

describe("siblingsOf", () => {
  it("orders siblings by createdAt and reports the index", () => {
    expect(siblingsOf(tree, "u2b")).toEqual({
      index: 1,
      total: 2,
      ids: ["u2", "u2b"],
    })
  })
})

describe("latestLeaf", () => {
  it("follows the newest child until a message has none", () => {
    expect(latestLeaf(tree, "a1")).toBe("a2b")
    expect(latestLeaf(tree, "a2")).toBe("a2")
  })
})
