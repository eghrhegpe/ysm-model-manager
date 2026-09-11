// ===== Web 版构建配置（ADR-049 Phase 0 Spike + Phase 3 主 UI）=====
// 与主应用（vite.config.js，Wails 打包）分离：独立产物 dist-web。
// 单入口：index.html（主 UI，Tier 1 MODE=web 判定走 browserAdapter）。
//   ⚠️ 原双入口的 web.html + src/web-spike/main.ts 已于 dcff6379c（2026-09-05）删除，
//      但本配置与 knip.json 的入口声明未同步——rollup 报「Could not resolve entry
//      module "web.html"」，致 CI Pages 的 build:web 步骤长期红（本地同样失败，
//      仅因 build:web 不在 pre-push 门禁内而无人察觉）。2026-09-11 补齐同步。
// base 对齐 GitHub Pages 项目页子路径：文档站 /ysm-model-manager/ 根 + 网页版 /ysm-model-manager/app/。
// 复用 vite-wails-bindings-resolve.ts 的 wails-bindings-resolve 插件（bindings 以 .ts 生成、.js 后缀 import）。

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { checkLocalesSync } from "./vite-locale-check.ts";
import { wailsBindingsResolve } from "./vite-wails-bindings-resolve.ts";
import { wasmDataStubs } from "./vite-wasm-data-stubs.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const SRC_DIR = fileURLToPath(new URL("./src", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
// ⚠️ 以下别名必须与 vite.config.js 的同名声明保持逐字一致（ADR-146 单一事实源 =
//   frontend/tsconfig.json paths；check-path-hygiene 的双写一致性校验只看
//   vite.config.js，**不扫本文件**，故此处漂移不会被门禁发现——手工同步义务在此明示）。
//   本文件长期缺 resolve.alias，致 build:web 报 `Rollup failed to resolve import
//   "@/backend/browser-adapter.ts"`（ADR-146 把相对路径收敛为别名后，本配置未跟进）。
const ALIAS_DIRS = [
  "bindings",
  "preview-3d",
  "views",
  "utils",
  "backend",
  "core",
  "features",
  "workers",
  "services",
  "wasm",
  "test-utils",
  "web-spike",
  "locales",
  "parsers",
];
const FILE_ALIASES = {
  bus: "bus.ts",
  "theme-core": "theme-core.ts",
  "app-modules": "app-modules.ts",
};

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
  // ADR-146 别名解析：与 vite.config.js 同构（目录级白名单 + 文件级别名 + #root 过渡别名，
  // catch-all `@/*` 永不在列）。web 构建同样经 app-modules.ts 等模块进入 @/ 别名 import 链，
  // 缺此段即 rollup 解析失败。
  resolve: {
    alias: [
      ...ALIAS_DIRS.map((d) => ({ find: `@/${d}`, replacement: resolve(SRC_DIR, d) })),
      ...Object.entries(FILE_ALIASES).map(([name, file]) => ({
        find: `@/${name}`,
        replacement: resolve(SRC_DIR, file),
      })),
      { find: "#root", replacement: REPO_ROOT },
    ],
  },
  build: {
    outDir: "dist-web",
    rollupOptions: {
      // 单入口（原 spike 入口随 web.html 删除一并移除，见文件头说明）
      input: {
        main: resolve(root, "index.html"),
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
      // ADR-146：`#root` 别名读取仓库根 JSON（resource_types / creators / workshop*），
      // 故除 frontend/ 自身外须放行仓库根目录（与 vite.config.js 对齐）。
      allow: [fileURLToPath(new URL(".", import.meta.url)), REPO_ROOT],
    },
  },
  plugins: [wailsBindingsResolve, wasmDataStubs(), checkLocalesSync()],
});
