import type { ReactNode } from "react";

/**
 * Bounds the content width and holds the side gutter. Every section's inner
 * content goes through this, so the page keeps one measure across breakpoints.
 */
export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-5xl px-5 sm:px-8 ${className}`}>{children}</div>
  );
}
