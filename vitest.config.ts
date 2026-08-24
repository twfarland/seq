import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "~": new URL("./src", import.meta.url).pathname },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        // Composition roots: they wire adapters to ports and have no logic of
        // their own to cover.
        "src/main.ts",
        "src/adapters/worker/entry.ts",
      ],
    },
  },
});
