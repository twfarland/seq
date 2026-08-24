import { defineConfig } from "vite";

const nonchalant = new URL("../nonchalant", import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: { "~": new URL("./src", import.meta.url).pathname },
  },
  server: {
    // The nonchalant packages are symlinked in from a sibling checkout while
    // both projects are developed together, so their real paths are outside
    // this project root and the dev server would otherwise refuse to serve
    // them. Drop this once the dependency points at GitHub.
    fs: { allow: [".", nonchalant] },
  },
  worker: {
    // The sequencer worker is authored as an ES module and imports shared
    // domain code (`sequencer/engine.ts`), so it must be bundled as one too.
    format: "es",
  },
});
