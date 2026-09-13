// client/src/lib/tree.ts
// Mirror of src/session/tree.ts. Pure helpers over the message tree.
import type { ChatMessage } from "./session-types"

const byCreated = (a: ChatMessage, b: ChatMessage): number =>
  a.createdAt.localeCompare(b.createdAt)

/** Root → head. Empty when head is null or unknown. */
export const pathToHead = (
  messages: readonly ChatMessage[],
  headId: string | null
): ChatMessage[] => {
  if (!headId) return []
  const byId = new Map(messages.map((m) => [m.id, m]))
  const path: ChatMessage[] = []
  let current = byId.get(headId)
  while (current) {
    path.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path.reverse()
}

/** Messages sharing this one's parent (roots share `null`), oldest first. */
export const siblingsOf = (
  messages: readonly ChatMessage[],
  id: string
): { index: number; total: number; ids: string[] } => {
  const self = messages.find((m) => m.id === id)
  if (!self) return { index: 0, total: 0, ids: [] }
  const ids = messages
    .filter((m) => m.parentId === self.parentId)
    .sort(byCreated)
    .map((m) => m.id)
  return { index: ids.indexOf(id), total: ids.length, ids }
}

/** From `id`, step to the newest child repeatedly; the leaf reached. */
export const latestLeaf = (
  messages: readonly ChatMessage[],
  id: string
): string => {
  let current = id
  for (;;) {
    const children = messages
      .filter((m) => m.parentId === current)
      .sort(byCreated)
    if (children.length === 0) return current
    current = children[children.length - 1].id
  }
}
