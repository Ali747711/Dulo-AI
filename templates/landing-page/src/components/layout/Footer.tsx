import { Button } from "../ui/Button.tsx";
import { Container } from "../ui/Container.tsx";
import { site } from "../../content/site.ts";

/** The page's <footer> landmark: the action once more, then the details. */
export function Footer() {
  return (
    <footer className="mt-20 border-t border-ink-muted/15 bg-surface-muted py-12">
      <Container className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="font-display text-xl">{site.name}</p>
          {site.footer.lines.map((line) => (
            <p key={line} className="text-sm text-ink-muted">
              {line}
            </p>
          ))}
        </div>
        <Button href={site.footer.action.href}>{site.footer.action.label}</Button>
      </Container>
    </footer>
  );
}
