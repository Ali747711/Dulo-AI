import type { ReactNode } from "react";

/**
 * The one call-to-action style on the page, so hover and focus states are
 * defined once. Renders an anchor: a landing page's actions are links.
 * Minimum height 44px keeps it comfortable to tap on a phone.
 */
export function Button({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "quiet";
}) {
  const base =
    "inline-flex min-h-11 items-center justify-center rounded-md px-5 text-base font-medium transition-colors " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-ink hover:opacity-90"
      : "border border-ink-muted/30 text-ink hover:bg-surface-muted";

  return (
    <a href={href} className={`${base} ${styles}`}>
      {children}
    </a>
  );
}
