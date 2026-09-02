// @vitest-environment node
// ===== ADR-153 守卫：WASM 资产必须保持按需加载 =====
// 背景：`stats.worker.test.ts` 用 vi.mock 整体替换 ysm-worker-loader，因此测不到
// 「base / mt 是否真的懒加载」这一核心不变量。若有人把 import() 改回静态 import，
// stats.worker chunk 会从 ~12 KB 膨胀回 ~1.6 MB，而全部 5081 条单测仍全绿——
// 静态 import 只影响打包产物，不影响运行时语义。
// 本守卫直接对源码做静态断言，在 build 之前即可拦截退化。
// 覆盖两个方向：① loader 内不得出现静态 import；② 解锁开关 worker.format="es" 存在
// （vite 默认 iife 强制 inlineDynamicImports，缺此开关会直接构建失败）。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LOADER = fileURLToPath(new URL("./ysm-worker-loader.ts", import.meta.url));
const VITE_MAIN = fileURLToPath(new URL("../../vite.config.js", import.meta.url));
const VITE_WEB = fileURLToPath(new URL("../../vite.web.config.ts", import.meta.url));

/** 四组数据模块：base（单线程）与 mt（pthread）各一对，运行时互斥 */
const DATA_MODULES = [
  "ysm-wasm-data.js",
  "ysm-glue-data.js",
  "ysm-wasm-data-mt.js",
  "ysm-glue-data-mt.js",
];

const read = (p: string): string => readFileSync(p, "utf-8");

/**
 * 静态 import 的两种形态，均会令模块随 worker chunk 全量打包：
 *   `import { x } from "./mod.js"`（具名）  /  `import "./mod.js"`（副作用）
 * 动态形态 `import("./mod.js")` 不匹配：`import` 后紧跟 `(`，无空白分隔。
 */
const staticImportRe = (mod: string): RegExp =>
  new RegExp(
    `^\\s*import\\s+(?:[^;("']*from\\s+)?["'][^"']*${mod.replace(/\./g, "\\.")}["']`,
    "m",
  );

describe("ADR-153 守卫：WASM 资产按需加载", () => {
  const loader = read(LOADER);

  it("loader 不得静态 import 任何 WASM 数据模块", () => {
    for (const mod of DATA_MODULES) {
      expect(
        loader,
        `检测到 ${mod} 的静态 import——会随 worker chunk 全量打包，另一个变体成为死重`,
      ).not.toMatch(staticImportRe(mod));
    }
  });

  it("loader 必须对四组数据模块均使用动态 import", () => {
    for (const mod of DATA_MODULES) {
      expect(loader, `缺少 ${mod} 的动态 import`).toContain(`import("./${mod}")`);
    }
  });

  it("vite worker 打包格式必须为 es（iife 不支持 code-splitting）", () => {
    for (const [label, file] of [
      ["vite.config.js", VITE_MAIN],
      ["vite.web.config.ts", VITE_WEB],
    ] as const) {
      // 锚定 worker: { ... } 块体，避免文件他处的 format: "es" 掩盖缺失。
      // 用花括号深度配平找块尾（块内注释可能含 { type: "module" } 等嵌套）。
      const raw = read(file);
      const start = raw.indexOf("worker:") + "worker:".length;
      let depth = 0, end = start;
      for (let i = start; i < raw.length; i++) {
        if (raw[i] === "{") depth++;
        else if (raw[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      const workerBody = raw.slice(start, end);
      expect(workerBody, `${label} 的 worker 段缺少 format: "es"`).toMatch(/format:\s*["']es["']/);
    }
  });
});
