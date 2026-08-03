import { defineConfig } from "vite";
import { existsSync } from "fs";
import { resolve } from "path";

// Wails v3 generates .ts bindings but frontend imports them as .js.
// This plugin resolves .js imports to .ts when the .ts file exists.
const wailsBindingsResolve = {
  name: "wails-bindings-resolve",
  resolveId(source, importer) {
    if (!importer) return null;
    if (!source.includes("/bindings/") || !source.endsWith(".js")) return null;
    const tsSource = source.replace(/\.js$/, ".ts");
    const dir = resolve(importer, "..");
    const tsPath = resolve(dir, tsSource);
    if (existsSync(tsPath)) {
      return this.resolve(tsSource, importer, { skipSelf: true });
    }
    return null;
  },
};

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
  plugins: [wailsBindingsResolve],
  test: {
    include: ["js/**/*.test.js"],
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["js/**/*.ts", "js/**/*.js"],
      exclude: ["js/**/*.test.js", "js/wasm/**"],
    },
  },
});
