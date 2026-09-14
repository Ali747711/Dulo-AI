import { Container } from "../ui/Container.tsx";
import { site } from "../../content/site.ts";

/**
 * The page's <header> landmark: wordmark on the left, section links on the
 * right. On a phone the links wrap under the name rather than hiding behind a
 * menu, which keeps every destination one tap away on a short page.
 */
export function Header() {
  return (
    <header className="border-b border-ink-muted/15">
      <Container className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4">
        <a
          href="#top"
          className="font-display text-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          {site.name}
        </a>
        <nav aria-label="Sections">
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {site.nav.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="inline-flex min-h-11 items-center text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </header>
  );
}
