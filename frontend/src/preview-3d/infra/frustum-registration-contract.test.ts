// @vitest-environment node
// ===== frustum 注册契约：全部预览格式必须「场景 root ⇄ modelRoots」成对（锐评 infra 轮抽象扫描）=====
//
// 抽象发现（非逐文件读，而是按「N 个实现方共享同一不变量」扫出来的）：
// `registerModelRoot` 是**各格式适配器各自的职责**——`registerBuiltScene`
// （infra/register-built-scene.ts）只把差量 roots 收进 sceneRegistry（供隐藏/取景/归属），
// **不代为注册** frustum 根。
//
// 于是「谁注册了 frustum 根」实际是一张手写清单：
//   ysm ✓（ysm-adapter.ts:244）  vrm ✓（vrm-adapter.ts:319）  fbx ✓（fbx-adapter.ts:290）
//   mmd ✓（mmd-build-scene.ts:40）  litematic ✓（litematic-adapter.ts:163）
//   **pack ✗（pack-model-adapter.ts:327 只 scene.add，无 registerModelRoot）**
//
// 后果：资源包模型**对视锥剔除不可见**——多模型同框时它永远不被剔除（性能），
// 且用户开启剔除后，`restoreModelGroupsVisible` / `_culled` 归属链对它失效。
// 与 F1（注册了却不注销）恰好是**镜像病**：一个多、一个少。
//
// **已于本轮修复**：pack-model-adapter 补 `registerModelRoot(group)`（与 scene.add 同处）
// + `disposeContent` 首行补 `unregisterModelRoot`。本文件把「每个格式都必须注册」固化为
// 可机验契约，防再漏一个格式。
//
// 本文件三层对账（锐评 2026-10-11 收口，全部派生、不自证）：
//   ① 派生注册集：扫描 adapters/ 真含 `registerModelRoot(` 的文件，必须 ⊆ FORMATS∪白名单；
//   ② 派生挂载集：扫描 views/app-preview 调 `mount3D(` 的入口文件 → 其 import 的
//      `make*Adapter` 工厂来源（仓内无「格式→适配器」单一 registry，各 view 逐格式挂载），
//      每个挂载适配器沿 adapters/ 内 import **闭包**必须命中注册调用——
//      mmd 的注册点在 mmd-build-scene 而非 adapter 模块，故用闭包而非模块本身判定；
//   ③ 恒真守卫：mmd-adapter.ts 自身不注册，证明 ② 真靠闭包做功、非碰运气。
// 仍剩盲区（诚实声明）：一个格式既没接进任何 mount3D 入口、也没注册——它无法预览，
// 不在本契约射程；堵它需在生产侧造 registry（架构改动，非契约测试所能为）。

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..", "..");
const P3D = resolve(ROOT, "frontend", "src", "preview-3d");

/** 全部预览格式的「注册调用点」清单（手工登记——新增格式须同时登记此处，
 *  与 pack 同型缺口会被下一条断言抓出） */
const FORMATS: Array<{ name: string; file: string; note: string }> = [
  { name: "ysm", file: "adapters/ysm-adapter.ts", note: "registerModelRoot 于 build" },
  { name: "vrm", file: "adapters/vrm/vrm-adapter.ts", note: "registerModelRoot 于 build" },
  { name: "fbx", file: "adapters/fbx/fbx-adapter.ts", note: "registerModelRoot 于 build" },
  { name: "mmd", file: "adapters/mmd/mmd-build-scene.ts", note: "registerModelRoot 于 build" },
  { name: "litematic", file: "adapters/litematic-adapter.ts", note: "registerModelRoot 于 build" },
  {
    name: "pack",
    file: "adapters/pack-model-adapter.ts",
    note: "本轮补：原为唯一漏网（只 scene.add）",
  },
];

/** 注销点可能与注册点不同文件（如 mmd 注册在 build-scene、注销在 build-result） */
const UNREGISTER_SITES: Array<{ name: string; file: string }> = [
  { name: "ysm", file: "adapters/ysm-adapter.ts" },
  { name: "vrm", file: "adapters/vrm/vrm-adapter.ts" },
  { name: "fbx", file: "adapters/fbx/fbx-adapter.ts" },
  { name: "mmd", file: "adapters/mmd/mmd-build-result.ts" },
  { name: "litematic", file: "adapters/litematic-adapter.ts" },
  { name: "pack", file: "adapters/pack-model-adapter.ts" },
];

function read(rel: string): string {
  return readFileSync(resolve(P3D, rel), "utf8");
}

/** 递归收集 adapters/ 下全部非测试 .ts，返回相对 P3D 的正斜杠路径（派生交叉校验用）。 */
function scanAdapterFiles(): string[] {
  const root = resolve(P3D, "adapters");
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
    }
  };
  walk(root);
  return out.map((p) => p.slice(P3D.length + 1).split(sep).join("/"));
}

/** 解析某文件里的一条 import 说明符为「相对 P3D 的正斜杠路径」（越界返回 null）。
 *  支持 `@/preview-3d/...` 别名与 `./`/`../` 相对；无扩展名补 `.ts`。 */
function resolveSpec(importerRel: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null; // 裸包名（three 等），跳过
  let rel: string;
  if (spec.startsWith("@/")) {
    if (!spec.startsWith("@/preview-3d/")) return null; // 越 preview-3d 边界，不追
    rel = spec.slice("@/preview-3d/".length);
  } else {
    const base = resolve(P3D, importerRel).replace(/[^\\/]+$/, "");
    const p = resolve(base, spec);
    if (p !== P3D && !p.startsWith(P3D + sep)) return null; // 越出 preview-3d 不追
    rel = p.slice(P3D.length + 1).split(sep).join("/");
  }
  if (!/\.[cm]?[jt]s$/.test(rel)) rel += ".ts";
  return rel;
}

/** 列出某文件全部本地 import 目标（相对 P3D 正斜杠路径），忽略越界与外部包。 */
function importSpecs(rel: string): string[] {
  const src = read(rel);
  const out: string[] = [];
  const re = /^\s*(?:import|export)[^\n]*?\bfrom\s+["']([^"']+)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const r = resolveSpec(rel, m[1]);
    if (r) out.push(r);
  }
  return out;
}

/** 从某适配器模块出发、仅在 adapters/ 层内闭包的（生产 .ts）可达文件集。
 *  注册责任在适配器层（infra 的 registerBuiltScene 不代为注册，见下一条断言），
 *  故闭包截断在 adapters/——既够覆盖 mmd（注册点在 mmd-build-scene）又不追进整个前端图。 */
function adapterClosure(rel: string): Set<string> {
  const seen = new Set<string>();
  const stack = [rel];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (seen.has(cur) || !cur.startsWith("adapters/")) continue;
    seen.add(cur);
    for (const next of importSpecs(cur)) {
      if (!seen.has(next) && !next.endsWith(".test.ts")) stack.push(next);
    }
  }
  return seen;
}

/** 列出从某 import 行导入且符合 `make*Adapter` 命名（格式适配器工厂）的目标 spec。
 *  只认真工厂——同一 view 还会 import ysm-model-preloader / ysm-preview-pipeline 这类
 *  辅助模块，它们不算格式适配器，也不该被要求注册。 */
function makeAdapterSpecs(rel: string): string[] {
  const src = read(rel);
  const out: string[] = [];
  const re = /^\s*import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop() as string);
    if (!names.some((n) => /^make[A-Z]\w*Adapter$/.test(n))) continue;
    const r = resolveSpec(rel, m[2]);
    if (r) out.push(r);
  }
  return out;
}

/** 派生「真正被挂载的格式适配器模块」：扫描 views/app-preview 里调 mount3D( 的入口文件，
 *  取其 import 的 make*Adapter 工厂来源。这是唯一可机器派生的格式↔适配器事实源——
 *  新格式只要接进 view 就会被扫到，不再依赖手写 FORMATS 清单。 */
function mountedAdapterModules(): string[] {
  const views = resolve(ROOT, "frontend", "src", "views", "app-preview");
  const out = new Set<string>();
  for (const e of readdirSync(views, { withFileTypes: true })) {
    if (!e.name.endsWith("-3d.ts")) continue;
    const rel = relative(P3D, resolve(views, e.name)).split(sep).join("/");
    if (!read(rel).includes("mount3D(")) continue; // 非挂载入口（如 detail-3d 面板）跳过
    for (const spec of makeAdapterSpecs(rel)) {
      if (spec.startsWith("adapters/")) out.add(spec);
    }
  }
  return [...out].sort();
}

describe("frustum 根的注册契约（逐格式全绿）", () => {
  it.each(FORMATS)("$name：调用 registerModelRoot（清单与源码一致）", ({ file, name }) => {
    expect(read(file), `${name} 应注册 frustum 根`).toContain("registerModelRoot");
  });

  it.each(UNREGISTER_SITES)("$name：调用 unregisterModelRoot（成对注销）", ({ file, name }) => {
    expect(read(file), `${name} 应有 unregisterModelRoot`).toContain("unregisterModelRoot");
  });

  it("registerBuiltScene 不代为注册 frustum 根（注册责任在适配器，不是 infra）", () => {
    const src = read("infra/register-built-scene.ts");
    expect(
      src,
      "若将来 infra 代为注册，则各适配器的注册调用会变成冗余——届时本契约语义需重写",
    ).not.toContain("registerModelRoot");
  });

  // 重建后**重注册**位白名单：若未来某文件既 scene.add 又在 build 外重挂载时重注册，
// 必须显式登记于此（当前为空——派生集与 FORMATS 应完全重合）。
// 注意：`unregisterModelRoot(` 会被 includes("registerModelRoot") 误命中，故派生扫描用调用点正则。
const RE_REGISTER_ALLOWLIST: readonly string[] = [];

/** 真调用 `registerModelRoot(` 的判定：排除 `unregisterModelRoot(` 与前缀 import。
 *  用纯字符串判定而非正则字面量——本仓 auto-import 词法在正则里遇 `(?<!` 会断串，
 *  把正则内部的标识符当成裸引用误报（锐评 2026-10-11 实测踩坑）。 */
const WORD_CHARS = new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$".split(""));
function hasRegisterCall(src: string): boolean {
  let i = src.indexOf("registerModelRoot(");
  while (i >= 0) {
    const lineStart = src.lastIndexOf("\n", i) + 1;
    const lineEnd = src.indexOf("\n", i);
    const line = src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd);
    const prev = i > lineStart ? src[i - 1] : "";
    const isUnregister = src.slice(Math.max(0, i - 2), i) === "un";
    const inImport = line.includes("import");
    if (!inImport && !isUnregister && !WORD_CHARS.has(prev)) return true;
    i = src.indexOf("registerModelRoot(", i + 1);
  }
  return false;
}

it("被 mount3D 挂载的每个适配器，其 adapters/ 闭包内必须有 registerModelRoot 调用（新格式漏注册即红）", () => {
    // 补上一条「诚实边界」的另一半：派生注册集只能看出「注册了却没人登记」的缺口，
    // 看不出「接进了预览入口却根本没注册」的缺口。现改从挂载入口（views/app-preview
    // 中调 mount3D 的文件）派生真正在用的适配器模块集，沿 import 闭包追注册点——
    // mmd 的注册在 mmd-build-scene（闭包可达），故用闭包而非模块本身判定。
    const mounted = mountedAdapterModules();
    expect(mounted.length, "派生挂载集不应为空（否则本断言失去意义）").toBeGreaterThan(0);

    const unregistered = mounted.filter(
      (m) => ![...adapterClosure(m)].some((f) => hasRegisterCall(read(f))),
    );
    expect(
      unregistered,
      "每个被挂载的格式适配器，其 adapters/ 闭包内都必须真调用 registerModelRoot(",
    ).toEqual([]);
  });

it("FORMATS 每个注册位都必须落在某个挂载适配器的闭包内（派生防漂移）", () => {
    // 反向兜底：若 FORMATS 里某个注册文件既不被挂载、也不被任何挂载适配器闭包可达，
    // 说明清单项已脱离预览入口（死登记）——派生挂载集应能解释每个注册位。
    const mounted = mountedAdapterModules();
    const closureOf = new Set<string>();
    for (const m of mounted) for (const f of adapterClosure(m)) closureOf.add(f);

    const listed = FORMATS.map((f) => f.file);
    const missing = listed.filter((f) => !closureOf.has(f));
    expect(
      missing,
      "FORMATS 每个注册文件都须被某个挂载适配器闭包可达（脱离预览入口的死登记要移出清单）",
    ).toEqual([]);
  });

it("闭包判定真实生效（mmd 注册在 build-scene 而非 adapter 模块——防派生退化成恒真）", () => {
    // 若未来 mmd 把注册挪回 adapter 模块，或某个共享文件里冒出 registerModelRoot，
    // 这条会立刻暴露：闭包判定若退化成「模块自带/共享层碰运气」，mmd 这一例必然翻车。
    expect(
      hasRegisterCall(read("adapters/mmd/mmd-adapter.ts")),
      "前置：mmd-adapter.ts 自身不应注册（注册点在 mmd-build-scene）",
    ).toBe(false);
    expect(
      [...adapterClosure("adapters/mmd/mmd-adapter.ts")].some((f) => hasRegisterCall(read(f))),
      "闭包应能沿 import 追到 mmd-build-scene 的注册调用",
    ).toBe(true);
  });

it("派生注册集 ⊇ FORMATS，且多出者必须在重注册白名单内（防清单漂移）", () => {
    // 原断言只在 FORMATS 内自证（漏登记的文件根本不进集合），属**自证断言**——
    // 「新格式漏登记」永不会红（锐评 2026-10-11 P1 抓出的假闸）。
    // 现改为**从 adapters 目录派生**真含 `registerModelRoot(` 的文件集，再对账：
    //   ① 每个 FORMATS 文件必须都在派生集内（清单项丢失 = 该格式不注册了，红）；
    //   ② 派生集里不属于 FORMATS 的文件必须落在 RE_REGISTER_ALLOWLIST（重建后重注册位）
    //      ——新增一个「注册了却没入表、也不在重注册白名单」的文件，红。
    // 诚实边界：本断言只解决「注册了却没人登记」；「接进了预览入口却根本没注册」由下方
    // 「被 mount3D 挂载的每个适配器…」那条派生断言兜住（从 views 挂载点反查适配器闭包）。
    // 仍剩的盲区：一个格式既没接进任何 mount3D 入口、也没注册——它无法预览，故不在本契约射程。
    const derived = new Set(scanAdapterFiles().filter((f) => hasRegisterCall(read(f))));
    const listed = FORMATS.map((f) => f.file);

    const missing = listed.filter((f) => !derived.has(f));
    expect(missing, "FORMATS 清单内每个格式的文件都必须真调用 registerModelRoot(").toEqual([]);

    const unlisted = [...derived].filter((f) => !listed.includes(f)).sort();
    const stray = unlisted.filter((f) => !RE_REGISTER_ALLOWLIST.includes(f));
    expect(
      stray,
      "派生出的注册文件应全部来自 FORMATS 或重注册白名单；多出者需登记为重建后重注册位",
    ).toEqual([]);
  });
});
