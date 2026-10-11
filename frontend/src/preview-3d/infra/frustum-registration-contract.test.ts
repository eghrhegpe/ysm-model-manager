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
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, sep } from "node:path";

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

it("派生注册集 ⊇ FORMATS，且多出者必须在重注册白名单内（防清单漂移）", () => {
    // 原断言只在 FORMATS 内自证（漏登记的文件根本不进集合），属**自证断言**——
    // 「新格式漏登记」永不会红（锐评 2026-10-11 P1 抓出的假闸）。
    // 现改为**从 adapters 目录派生**真含 `registerModelRoot(` 的文件集，再对账：
    //   ① 每个 FORMATS 文件必须都在派生集内（清单项丢失 = 该格式不注册了，红）；
    //   ② 派生集里不属于 FORMATS 的文件必须落在 RE_REGISTER_ALLOWLIST（重建后重注册位）
    //      ——新增一个「注册了却没入表、也不在重注册白名单」的文件，红。
    // 诚实边界（写进注释，不吹成 fail-closed）：一个「新格式适配器既没注册、也没入表」的
    // 缺口静态扫描抓不到——那需 registry（格式→适配器）派生，超出本文件范围。
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
