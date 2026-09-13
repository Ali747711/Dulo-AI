import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { latestLeaf, pathToHead, siblingsOf } from "./tree.js";
import type { ChatMessage } from "./types.js";

const msg = (
  id: string,
  parentId: string | null,
  createdAt: string,
  role: "user" | "assistant" = "user",
): ChatMessage => ({
  id,
  sessionId: "s",
  parentId,
  role,
  parts: [{ type: "text", text: id }],
  createdAt,
});

//   u1 ─ a1 ─ u2 ─ a2
//             └─ u2b ─ a2b        (u2b is an edited sibling of u2)
const tree: ChatMessage[] = [
  msg("u1", null, "2026-01-01T00:00:01Z"),
  msg("a1", "u1", "2026-01-01T00:00:02Z", "assistant"),
  msg("u2", "a1", "2026-01-01T00:00:03Z"),
  msg("a2", "u2", "2026-01-01T00:00:04Z", "assistant"),
  msg("u2b", "a1", "2026-01-01T00:00:05Z"),
  msg("a2b", "u2b", "2026-01-01T00:00:06Z", "assistant"),
];

describe("pathToHead", () => {
  it("walks parent pointers from head to root, returned root first", () => {
    assert.deepEqual(
      pathToHead(tree, "a2b").map((m) => m.id),
      ["u1", "a1", "u2b", "a2b"],
    );
  });
  it("returns [] for a null head", () => {
    assert.deepEqual(pathToHead(tree, null), []);
  });
  it("returns [] for an unknown head", () => {
    assert.deepEqual(pathToHead(tree, "nope"), []);
  });
});

describe("siblingsOf", () => {
  it("orders siblings by createdAt and reports the index", () => {
    assert.deepEqual(siblingsOf(tree, "u2b"), { index: 1, total: 2, ids: ["u2", "u2b"] });
    assert.deepEqual(siblingsOf(tree, "u2"), { index: 0, total: 2, ids: ["u2", "u2b"] });
  });
  it("treats roots as siblings of each other", () => {
    const withTwoRoots = [...tree, msg("u0", null, "2026-01-01T00:00:00Z")];
    assert.deepEqual(siblingsOf(withTwoRoots, "u1"), { index: 1, total: 2, ids: ["u0", "u1"] });
  });
  it("is a singleton for a message with no siblings", () => {
    assert.deepEqual(siblingsOf(tree, "a1"), { index: 0, total: 1, ids: ["a1"] });
  });
});

describe("latestLeaf", () => {
  it("follows the newest child until a message has none", () => {
    assert.equal(latestLeaf(tree, "a1"), "a2b");
    assert.equal(latestLeaf(tree, "u2"), "a2");
  });
  it("returns the message itself when it is a leaf", () => {
    assert.equal(latestLeaf(tree, "a2"), "a2");
  });
});
