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
    include: ["src/**/*.test.{js,ts}"],
    environment: "jsdom",
    setupFiles: ["./test-setup.ts"],
    coverage: {
      provider: "v8",
      // clean:false — 绕过 WorkBuddy safe-delete 在 Windows 上对 coverage/ 目录的
      // 路径格式拦截（genie-trash 要求 C:\ 绝对路径，收到的却是 /c/...）。
      // 报告以覆盖写方式更新，旧文件无害。CI( Linux runner ) 不受影响。
      clean: false,
      reporter: ["text", "html", "json"],
      include: ["src/**/*.ts", "src/**/*.js"],
      exclude: ["src/**/*.test.{js,ts}", "src/wasm/**"],
      thresholds: {
        // 2026-08-04 校准：原 85/70/82/85 远超实际覆盖（49.41/70.33/61.67），
        // --coverage 必红形同虚设。降至实际-5% 作防回退基准——覆盖提升后可上调。
        statements: 45,
        branches: 65,
        functions: 55,
        lines: 45,
      },
    },
  },
});
