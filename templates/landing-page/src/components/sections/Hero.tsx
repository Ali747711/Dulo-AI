import { Button } from "../ui/Button.tsx";
import { Container } from "../ui/Container.tsx";
import { site } from "../../content/site.ts";

/**
 * The first screen, and the only <h1> on the page. Every other section is its
 * own file next to this one, opening with a <SectionHeading>.
 */
export function Hero() {
  return (
    <section id="top" className="py-20 sm:py-28">
      <Container className="max-w-3xl space-y-6">
        <h1 className="font-display text-4xl text-balance sm:text-6xl">{site.hero.heading}</h1>
        <p className="max-w-prose text-lg text-ink-muted">{site.hero.body}</p>
        <Button href={site.hero.action.href}>{site.hero.action.label}</Button>
      </Container>
    </section>
  );
}
