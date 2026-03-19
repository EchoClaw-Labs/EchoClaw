import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    globals: false,
    environment: "node",
    setupFiles: ["src/__tests__/setup.ts"],
    testTimeout: 10000,
  },
});
