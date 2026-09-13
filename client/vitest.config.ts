import path from "path"
import { defineConfig } from "vitest/config"

// Kept separate from vite.config.ts so the app build does not depend on
// vitest types. Only the alias is shared; tests are pure TypeScript.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
})
