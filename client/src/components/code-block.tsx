import { cn } from "cn"

/**
 * Bounded, scrollable monospace output.
 *
 * Tool results can be tens of thousands of characters with no whitespace, so
 * the height is capped, long tokens are broken, and the box scrolls on its own
 * instead of pushing the card out of shape.
 */
export function CodeBlock({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "max-h-40 min-w-0 overflow-auto overscroll-contain rounded-md",
        className
      )}
    >
      <pre className="font-mono text-xs break-words whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  )
}
