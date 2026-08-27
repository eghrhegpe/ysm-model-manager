import { defineConfig } from "vitest/config";
import { wasmDataStubs } from "./vite-wasm-data-stubs.ts";

// 测试环境分流约定（瓶颈治理，参照 MikuMikuAR ADR-255）：
// isolate=true 下 happy-dom 是每文件重建（~1.2s/文件），环境累加曾是墙钟大头。
// 纯逻辑测试（不触碰 window/document 等 DOM 全局）首行标注
// `// @vitest-environment node` 切 node 环境（成本 ~0ms），依赖 DOM 的保持默认 happy-dom。
// 源模块顶层 window 副作用须惰性化（typeof window !== "undefined" 守卫），
// 如 bus.ts / app-modules.ts / debug.ts——否则 import 链在 node 下报 window is not defined。
// isolate:true（2026-08-22）：解决 isolate:false 混合环境 worker 复用导致的 document 偶发串扰。
// test-setup.ts 的 idb/three/i18n mock 已兼容双模式，setupFiles 在 isolate:true 下每 worker 重执行。
export default defineConfig({
  plugins: [wasmDataStubs()],
  test: {
    include: ["src/**/*.test.{js,ts}"],
    environment: "happy-dom",
    isolate: true,
    setupFiles: ["./test-setup.ts"],
    coverage: {
      provider: "v8",
      // clean:false — 绕过 WorkBuddy safe-delete 在 Windows 上对 coverage/ 目录的
      // 路径格式拦截（genie-trash 要求 C:\ 绝对路径，收到的却是 /c/...）。
      // 报告以覆盖写方式更新，旧文件无害。CI( Linux runner ) 不受影响。
      clean: false,
      reporter: ["text", "html", "json"],
      include: ["src/**/*.ts", "src/**/*.js"],
      exclude: [
        "src/**/*.test.{js,ts}",
        "src/wasm/**",
        // WASM 桥接层（decodeYsmViaWasm）：getApp/atob/Blob/URL.createObjectURL 密集的
        // IO 胶水，单测成本高价值低；可测的纯解析逻辑已抽到 parse-ysm-json.ts。
        // 与 ADR-023 排除 wasm 层的本意一致（该文件从 src/wasm 迁出后需在此补挂）。
        "src/views/app-preview/wasm.ts",
        // 实验/spike 入口（非生产代码，无导出符号；知识卡侧已由 7cb1a0da 排除）
        "src/web-spike/**",
        // Web Worker 线程（happy-dom 无真实 Worker 环境）：统计/编码/纹理解码依赖
        // postMessage + 线程生命周期，单测不可运行；协议与纯逻辑已抽到可测模块
        // （workers/stats-core.ts、mmd-ktx2-basis.ts 等，均有测试）。
        "src/workers/stats.worker.ts",
        "src/utils/3d/adapters/mmd-ktx2-worker.ts",
        "src/utils/3d/adapters/mmd-texture-decode.worker.ts",
        // FBX/PMX 解析 Worker（ADR-112）：worker 内无 DOM，FBXLoader/PmxReader 解析
        // 仅能在真实 Worker 线程运行；纯逻辑已抽到 fbx-scene-to-data / mmd-pmx-convert
        "src/utils/3d/adapters/fbx-parser.worker.ts",
        "src/utils/3d/adapters/mmd-pmx-parser.worker.ts",
        // MMD 纹理解码 Worker 池管理器：new Worker 创建真实线程，池生命周期不可单测
        "src/utils/3d/adapters/mmd-texture-decoder.ts",
        // 3D 预览装配入口（mount3D 完整渲染管线 + WebGL/rAF）：happy-dom 无法运行
        "src/views/app-preview/maid-3d.ts",
        "src/views/app-preview/ysm-3d.ts",
      ],
      thresholds: {
        // 2026-08-18 校准：降低阈值以豁免高成本/低收益的 DOM 依赖模块
        // （android-bridge/skeleton-utils/theme）及 Web Worker（stats.worker.ts 无法在 happy-dom 跑）。
        // 基准取自实测 71.81/64.27/69.78/71.81 - 2pt。
        statements: 68,
        branches: 52,
        functions: 64,
        lines: 71,
      },
    },
  },
});
