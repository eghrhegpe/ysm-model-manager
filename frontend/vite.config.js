import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import { resolve } from "path";
import { wailsBindingsResolve } from "./vite-wails-bindings-resolve.ts";
import { wasmDataStubs } from "./vite-wasm-data-stubs.ts";

// ADR-146：目录级路径别名（永久禁止 catch-all `@/*`）。
// `#root` 为过渡措施——把越界读仓库根 JSON 的引用收口为 `#root/x.json`，
// 仅减不增（R4 冻结基线），终态由 Wails 侧 bridge 注入，本文件不锁时间点。
const SRC_DIR = fileURLToPath(new URL("./src", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** 手写源码顶层目录白名单（与 tsconfig.json paths 必须一致；D3 一致性校验兜底）。 */
const ALIAS_DIRS = [
  "preview-3d", "views", "utils", "backend", "core",
  "ui", "features", "workers", "services", "wasm", "test-utils", "web-spike",
];

export default defineConfig({
  root: ".",
  // 索引 1.6：版本号构建注入（与 vite.web.config.ts 同源，__APP_VERSION__ ← WEB_VERSION
  // 环境变量；web-common.ts 的 webCommonBindings 引用，桌面构建也需定义防 ReferenceError）
  define: {
    __APP_VERSION__: JSON.stringify(process.env.WEB_VERSION || "web"),
  },
  build: {
    outDir: "dist",
  },
  // ADR-146 别名解析：目录级白名单 + `#root` 过渡别名（catch-all `@/*` 永不在列）。
  // vite 字符串 find 做前缀匹配，本仓顶层目录无前缀包含关系（ui≠utils 等），无歧义。
  // find 用字面量字符串（便于 check-path-hygiene 解析 ALIAS_DIRS 做双写一致性校验）。
  resolve: {
    alias: [
      ...ALIAS_DIRS.map((d) => ({ find: `@/${d}`, replacement: resolve(SRC_DIR, d) })),
      { find: "#root", replacement: REPO_ROOT },
    ],
  },
  worker: {
    // ADR-153：worker 内动态 import()（mt WASM 按需加载）需要 ESM 格式——
    // 默认 iife 不支持 code-splitting，构建报 "IIFE output formats are not
    // supported for code-splitting builds"。所有 new Worker 均用 { type: "module" }。
    format: "es",
    plugins: () => [wasmDataStubs()],
  },
  // utils/resource/{types,extensions}.ts 直接 import 仓库根 resource_types.json
  // （单一事实来源，构建期内联）。Vite 6 显式 allow 会完全替换默认 workspace root，
  // 必须同时放行 frontend/ 自身（new URL(".", import.meta.url)），否则 dev 首页 403；
  // 仓库根仅放行 resource_types.json 单个文件，不过度放开上级目录。
  // ADR-146：`#root` 过渡别名落地后，其余根 JSON（creators / workshop*.json）也需放行，
  // 否则 `#root/creators.json` 在 dev server 下 403；构建期内联不受影响。
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../resource_types.json", import.meta.url)),
        fileURLToPath(new URL("../creators.json", import.meta.url)),
        fileURLToPath(new URL("../workshop-github.json", import.meta.url)),
        fileURLToPath(new URL("../workshop_sites.json", import.meta.url)),
      ],
    },
    watch: {
      // Windows EBUSY 防护（2026-08-16 实测）：外部工具（esbuild/IDE/杀软）原子写
      // 临时目录（.web-fs.ts.<pid>.<uuid>.tmpdir/）时，chokidar 尝试 watch 被占用
      // 的文件会抛 EBUSY 崩溃整个 vite 进程（dev 前端停摆"愣着"）——忽略这些
      // 临时产物目录，watcher 不再触碰
      ignored: [
        /[\\/]\.[^\\/]+\.\d+\.[0-9a-f-]{36}\.tmpdir([\\/]|$)/,
        /\.tmp$/,
      ],
    },
  },
  plugins: [wailsBindingsResolve, wasmDataStubs()],
});
