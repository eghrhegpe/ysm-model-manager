import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import { resolve } from "path";
import { wailsBindingsResolve } from "./vite-wails-bindings-resolve.ts";
import { wasmDataStubs } from "./vite-wasm-data-stubs.ts";
import { checkLocalesSync } from "./vite-locale-check.ts";
import { ALIAS_DIRS, FILE_ALIASES } from "./vite-alias-shared.ts";

// ADR-146：目录级路径别名（永久禁止 catch-all `@/*`）。
// `#root` 为过渡措施——把越界读仓库根 JSON 的引用收口为 `#root/x.json`，
// 仅减不增（R4 冻结基线），终态由 Wails 侧 bridge 注入，本文件不锁时间点。
// ALIAS_DIRS/FILE_ALIASES 单一事实源在 ./vite-alias-shared.ts（web 构建同源消费，
// 防双写漂移——vite.web.config.ts 曾因手抄副本漏同步致 build:web 长期红）。
const SRC_DIR = fileURLToPath(new URL("./src", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: ".",
  // 索引 1.6：版本号构建注入（与 vite.web.config.ts 同源，__APP_VERSION__ ← WEB_VERSION
  // 环境变量；web-common.ts 的 webCommonBindings 引用，桌面构建也需定义防 ReferenceError）
  define: {
    __APP_VERSION__: JSON.stringify(process.env.WEB_VERSION || "web"),
  },
  build: {
    outDir: "dist",
    // vite 8 起 rolldown 内核：构建选项迁到 rolldownOptions（rollupOptions 已弃用，会吐告警）。
    // 仅桌面构建去掉 chunk/asset 内容哈希、纯固定产物名——桌面整包同发、无 CDN 长缓存需求，
    // 且 chunk 名（app / vendor-* / shared-infra / preview-library …）彼此不撞、也不与入口 index 撞。
    // web 构建（vite.web.config.ts）刻意保留哈希以走 Pages CDN 缓存失效，本文件不动它。
    rolldownOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        // 唯一真冲突：虚拟模块 `_wasm-data-stub_*` 被主线程与 worker 双构建各自产出同名 chunk，
        // 纯固定名会互相覆盖、致 worker 引用坏包；对其保留内容哈希，其余稳定 chunk 名纯固定。
        chunkFileNames(chunkInfo) {
          if (chunkInfo.name.startsWith("_wasm-data-stub")) {
            return "assets/[name]-[hash].js";
          }
          return "assets/[name].js";
        },
        assetFileNames: "assets/[name].[ext]",
        // manualChunks 拆分（2026-10 审计：主 chunk app-content 达 ~2.76 MB，>500 kB 告警）。
        // 只按 node_modules 归属路由，判定条件只依赖稳定路径前缀，业务文件增删不改分法，
        // 因此 vendor 不会因业务改动漂哈希。
        // 分法依据（代码读不出的信息——基线实测）：
        //   基线主 chunk 2,764 kB 里 ~2.2 MB 是 vendor：three 本体（~738 kB）、three 生态插件
        //   @moeru/three-mmd* + @pixiv/three-vrm*（~247 kB）、MMD 物理引擎 ammojs-typed
        //   （~1.75 MB，被 @moeru/three-mmd-physics-ammo 引入）、@wailsio/runtime。拆出后
        //   app-content 落到 ~553 kB（见下方「为什么不拆 preview-3d」）。
        //   1. `three` 单拆：单一大 vendor，且 app-modules.ts:159 已动态 import("three") 预加载
        //      （ADR-101），天然独立 chunk 边界——单独成包可长期走 HTTP 缓存。
        //   2. `@moeru`/`@pixiv` 归 vendor-three-ecosystem：只被 preview-3d 消费、与 three 同频
        //      升级（同包缓存命中高），不与主 UI 混。
        //   3. `ammojs-typed`（ammo）单独成包 vendor-ammo：MMD 骨骼物理的 WASM 包装库，体积
        //      ~1.75 MB，与 three 生态无耦合、独立演进；塞进 ecosystem 会让它膨胀到 ~2 MB。
        //   4. `@wailsio/runtime` 归 vendor-runtime：Wails 运行时桥，版本由 Go 侧 bindings 决定，
        //      与前端业务改动无关。
        //   5. 其余 node_modules 归 vendor-misc：fflate 等小工具，量小且几乎不变。
        // 为什么不把 preview-3d 单拆出去：preview-3d 是 app-content/index.ts 副作用
        //   `import "@/views/app-preview/index.ts"` 静态拉入的，且内部值导入成环——
        //   menu 值导入 adapters（vrm-bone-ui）与 caps（scene-capability-registry），
        //   adapters/caps 又值导入 infra（render-host 等）。按子目录拆成 core/features 两组
        //   必然产生 circular chunk（模块被重复打包）；整拆一坨则从 553 kB 变成 ~3.8 MB 单文件，
        //   比主 chunk 更糟。故此处不动 preview-3d，交给 Rolldown 既有的动态 import 边界
        //   （shared-infra / preview-library / texture-cache / gpu-load-calibrate）分流。
        // 不做：动态 import 化 app-preview（改时序/引入 loading 态，属 src 层决策，超本文件边界）。
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // 先判更具体的生态插件与 ammo，再判 three 本体（three/addons 也含 node_modules/three）
            if (id.includes("node_modules/@moeru") || id.includes("node_modules/@pixiv"))
              return "vendor-three-ecosystem";
            if (id.includes("node_modules/ammojs-typed")) return "vendor-ammo";
            if (id.includes("node_modules/three")) return "vendor-three";
            if (id.includes("node_modules/@wailsio")) return "vendor-runtime";
            return "vendor-misc";
          }
          return undefined;
        },
      },
    },
  },
  // ADR-146 别名解析：目录级白名单 + `#root` 过渡别名（catch-all `@/*` 永不在列）。
  // vite 字符串 find 做前缀匹配，本仓顶层目录无前缀包含关系（ui≠utils 等），无歧义。
  // find 用字面量字符串（便于 check-path-hygiene 解析 ALIAS_DIRS 做双写一致性校验）。
  resolve: {
    alias: [
      ...ALIAS_DIRS.map((d) => ({ find: `@/${d}`, replacement: resolve(SRC_DIR, d) })),
      ...Object.entries(FILE_ALIASES).map(([name, file]) => ({ find: `@/${name}`, replacement: resolve(SRC_DIR, file) })),
      { find: "#root", replacement: REPO_ROOT },
    ],
  },
  // 显式声明 **e2e-web 经 `/@id/` 反射引用**的 three addons（2026-10-07 冷缓存 CI 修复）。
  //
  // 为什么必须显式列：`frontend/e2e-web/postprocessing.spec.ts` 在页面内直接
  // `import("/@id/three/examples/jsm/postprocessing/SSRPass.js")`。`/@id/` 经 vite 解析出的
  // **模块 id 是 `three/examples/jsm/...`**，而本仓源码（preview-3d）引的是
  // `three/addons/...`——**两条不同的 id**。vite 的启动扫描只看得见静态 import 图，
  // 因此 `/@id/` 这条 id 不在预打包集合内：首次请求时 optimizer 才现补并**整页 reload**，
  // 把正在跑的 `page.evaluate` 连同 in-flight 模块请求一起掐死（CI 缓存每次冷 → 恒红）。
  // 列进 include 后启动即预打包，既无运行时发现、也无 reload、更无 `/@id/` 短暂 502 窗口。
  //
  // 同模块双形态（addons + examples）都保留，各自独立 id 互不影响，勿「去重」合并——
  // 合并会让其中一条重新掉回运行时发现路径，本行注释即为此而写。
  optimizeDeps: {
    include: [
      "three/addons/postprocessing/EffectComposer.js",
      "three/addons/postprocessing/OutputPass.js",
      "three/addons/postprocessing/RenderPass.js",
      "three/addons/postprocessing/SSAOPass.js",
      "three/addons/postprocessing/SSRPass.js",
      "three/addons/postprocessing/UnrealBloomPass.js",
      // e2e-web `/@id/` 反射引用的等价 id（与上面是**不同模块 id**，见注释）
      "three/examples/jsm/postprocessing/EffectComposer.js",
      "three/examples/jsm/postprocessing/OutputPass.js",
      "three/examples/jsm/postprocessing/RenderPass.js",
      "three/examples/jsm/postprocessing/SSRPass.js",
      "three/examples/jsm/postprocessing/UnrealBloomPass.js",
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
  plugins: [wailsBindingsResolve, wasmDataStubs(), checkLocalesSync()],
});
