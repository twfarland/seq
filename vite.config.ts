import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: { "~": new URL("./src", import.meta.url).pathname },
  },
  worker: {
    // The sequencer worker is authored as an ES module and imports shared
    // domain code (`sequencer/engine.ts`), so it must be bundled as one too.
    format: "es",
  },
});
