import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: [
            "src/**/__tests__/**/*.test.ts",
            "app/**/__tests__/**/*.test.ts",
            "scripts/**/__tests__/**/*.test.ts",
            // Pure helpers of the end-to-end launcher; the Playwright specs are *.spec.ts and never match.
            "e2e/support/**/__tests__/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "db",
          environment: "node",
          include: ["test/db/**/*.db.test.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
