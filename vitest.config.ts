import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["node_modules/**", ".next/**"],
    // The first test that imports a module cold (lib/env.ts with zod) can take over the 5 s default when the
    // whole suite is transforming in parallel. It is slow, not wrong, and used to fail at random.
    testTimeout: 30_000,
  },
});
