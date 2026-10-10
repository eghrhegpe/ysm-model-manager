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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

  it("仅含 `registerModelRoot(` 出现的文件数与流程格式数一致（防新格式漏登记）", () => {
    // 该断言是「清单未过期」的守卫：新增格式适配器若忘了登记 FORMATS，
    // 它照样会在这里被计入，从而与清单长度不符 → 提示补登记。
    const filesWithRegister = new Set(FORMATS.map((f) => f.file));
    const counted = [...filesWithRegister].filter((f) => read(f).includes("registerModelRoot"));
    expect(counted.length, "登记表内每个格式都必须含注册调用").toBe(FORMATS.length);
  });
});
