// ===== Web 版构建配置（ADR-049 Phase 0 Spike + Phase 3 主 UI）=====
// 与主应用（vite.config.js，Wails 打包）分离：独立产物 dist-web。
// 双入口：index.html（主 UI，Tier 1 MODE=web 判定走 browserAdapter）+ web.html（Spike 调试页）。
// base 对齐 GitHub Pages 项目页子路径：文档站 /ysm-model-manager/ 根 + 网页版 /ysm-model-manager/app/。
// 复用 vite-wails-bindings-resolve.ts 的 wails-bindings-resolve 插件（bindings 以 .ts 生成、.js 后缀 import）。
import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import { resolve } from "path";
import { wailsBindingsResolve } from "./vite-wails-bindings-resolve.ts";
import { wasmDataStubs } from "./vite-wasm-data-stubs.ts";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // root 用绝对路径（消除 cwd 依赖——从任意目录跑构建都正确）
  root,
  // base 默认 /（本地 vite preview 验证，git-bash 的 MSYS 会把环境变量里的 / 转成
  // /Program Files/Git/，故不用环境变量做本地默认）；GitHub Pages 部署时 CI
  // （Linux shell）设 WEB_BASE=/ysm-model-manager/app/（见 ADR-049 Phase 3）
  base: process.env.WEB_BASE || "/",
  // Tier 1 环境判定：web 构建固定 MODE=web（import.meta.env.MODE==="web" → resolveWebMode true，
  // 主 UI 无需改 index.html/不加全局标记；桌面/Android 构建 MODE=production 不受影响）
  mode: "web",
  // 索引 1.6：web 版本号构建注入（__APP_VERSION__ ← WEB_VERSION 环境变量，发版脚本
  // 传 WEB_VERSION=vX.Y.Z 即与桌面 Go version.Version 同源；未注入回退 "web"）
  define: {
    __APP_VERSION__: JSON.stringify(process.env.WEB_VERSION || "web"),
  },
  build: {
    outDir: "dist-web",
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        spike: resolve(root, "web.html"),
      },
    },
  },
  // worker 是独立 bundle，顶层 plugins 不覆盖 worker 内 import；
  // 须单独挂 wasmDataStubs 让 worker 里的 ysm-wasm-data.js 缺失时也能构建（与主配置对齐）
  // ADR-153：worker 内动态 import()（mt WASM 按需加载）需要 ESM 格式（默认 iife 不支持 code-splitting）
  worker: {
    format: "es",
    plugins: () => [wasmDataStubs()],
  },
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../resource_types.json", import.meta.url)),
      ],
    },
  },
  plugins: [wailsBindingsResolve, wasmDataStubs()],
});
