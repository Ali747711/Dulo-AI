import type { ReactNode } from "react";

/**
 * The heading every section opens with. Always an <h2>: the page has exactly
 * one <h1>, in the hero, and heading levels never skip.
 */
export function SectionHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="font-display text-3xl text-balance sm:text-4xl">
      {children}
    </h2>
  );
}
