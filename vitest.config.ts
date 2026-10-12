import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/__tests__/**/*.test.ts", "app/**/__tests__/**/*.test.ts"],
        },
      },
    ],
  },
});
