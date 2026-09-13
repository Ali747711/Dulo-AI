// client/src/components/todo-list.tsx
/** manage_todos returns a checklist; showing it as one beats raw JSON. */
export function TodoList({ text }: { text: string }) {
  const [summary, ...items] = text.split("\n")
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{summary}</span>
      <ul className="flex min-w-0 flex-col gap-1">
        {items.map((line, i) => {
          const done = line.startsWith("[x]")
          const active = line.startsWith("[~]")
          return (
            <li
              key={i}
              className={
                "flex min-w-0 items-start gap-2 text-sm " +
                (done ? "text-muted-foreground line-through" : "")
              }
            >
              <span aria-hidden className="font-mono text-xs leading-5">
                {done ? "✓" : active ? "▸" : "○"}
              </span>
              <span className="min-w-0 break-words">{line.slice(4)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
