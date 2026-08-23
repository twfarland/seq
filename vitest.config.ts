import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  // `hot: false` matters: vitest runs the plugin in serve mode, which would
  // otherwise inject the `@solid-refresh` HMR runtime that has no resolvable
  // filename under vitest's module runner.
  plugins: [solid({ hot: false, ssr: false })],
  resolve: {
    alias: { "~": new URL("./src", import.meta.url).pathname },
    // vite-plugin-solid needs Solid's browser/dev build under jsdom, otherwise
    // component tests resolve the server (string-rendering) entry point.
    conditions: ["browser", "development"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/main.tsx"],
    },
  },
});
