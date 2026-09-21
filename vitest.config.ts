import { defineConfig } from 'vitest/config';

// Each workspace folder is its own project, so a package that needs a DOM environment
// (renderers, charts, vue) opts in with its own vitest.config.ts without affecting core.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'tools/*'],
    // Scaffolded packages have no tests yet; CI must still pass until they do.
    passWithNoTests: true,
  },
});
