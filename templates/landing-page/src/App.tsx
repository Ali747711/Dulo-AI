import { Footer } from "./components/layout/Footer.tsx";
import { Header } from "./components/layout/Header.tsx";
import { Hero } from "./components/sections/Hero.tsx";

/**
 * The page: header, the sections in the order the brief asked for, footer.
 * Add one <Section /> per requested section, each its own file under
 * components/sections/. No logic belongs here.
 */
export default function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
      </main>
      <Footer />
    </>
  );
}
