// ===== toneMapping 属主归还：sky 在场时不得「整块跳过」（2026-10-11）=====
//
// 被测缺陷：`postprocessing-composer.ts|restoreOutputSettings` 原实现以
// `if (getTypedCap(this.caps,"sky")?.isEnabled()) return;` **整块提前退出**——
// 因 sky 也写 `renderer.toneMapping`（写入 ACESFilmic 并自行引用计数归还），
// 作者担心「盲还原会把 sky 的值打回默认」。
//
// 但「sky 在场」与「sky 是 toneMapping 的当前持有者」是两件事：
//   - sky 只写 **ACESFilmic**（定值，`sky-capability.ts|apply`）；
//   - pp 写 `toneMappingValue(envState.ppToneMapping)`（用户可选 none/linear/reinhard/
//     aces/cineon）。
// 当 pp 的取值 ≠ ACESFilmic（例：用户选 "reinhard"）时，renderer 上的值就是 **pp 的**，
// 与 sky 无关——此时提前退出 = pp 放弃归还自己写的值。
//
// 泄漏场景（本文件钉死）：
//   ① sky 开启（写 ACES，快照 prev=NoToneMapping）
//   ② pp 开启且用户选 reinhard（快照 prevToneMapping=ACES[sky 的值]，写 Reinhard）
//   ③ pp 关闭 → 提前退出，Reinhard **残留**（既非 sky 的 ACES，也非原始 NoToneMapping）
//   ④ sky 再关闭 → sky 的 releaseTone 还原到它自己的快照 NoToneMapping
//      ——但若用户此后重开 pp 选 aces，renderer 已是 NoToneMapping，行为与预期错位。
//
// 正确语义：**逐字段归属判定**（对齐同文件 outputColorSpace 的既有范式，以及
// `frustum-cull.ts` 的 `_culled` 抑制态归属）——「renderer 上仍是本 cap 写的值」才归还；
// sky 的值与本 cap 写值不同时不受影响，天然不会打回 sky。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { clearEnvCallbacks } from "@/preview-3d/state/env-dispatcher.ts";
import { resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { PostprocessingCapability } from "./postprocessing-capability.ts";

beforeEach(() => {
  resetEnvState();
  clearEnvCallbacks();
});
afterEach(() => {
  clearEnvCallbacks();
});

/** 最小 fake renderer（输出设置字段可变；与 postprocessing-capability.test.ts 同形） */
function makeRenderer(
  toneMapping: THREE.ToneMapping = THREE.NoToneMapping,
  colorSpace: THREE.ColorSpace = THREE.LinearSRGBColorSpace,
) {
  return {
    toneMapping,
    toneMappingExposure: 1,
    outputColorSpace: colorSpace,
    domElement: { style: {}, width: 512, height: 512, tagName: "CANVAS" },
    getSize: (v: { x: number; y: number }) => {
      v.x = 512;
      v.y = 512;
      return v;
    },
    getPixelRatio: () => 1,
    capabilities: { isWebGL2: true, maxTextures: 16 },
    properties: new Map(),
    info: {
      autoReset: true,
      memory: { textures: 0, geometries: 0 },
      render: { calls: 0, triangles: 0, points: 0, frame: 0 },
      reset: () => {},
    },
    getContext: () => ({ getContextAttributes: () => ({ antialias: true }) }),
  } as unknown as THREE.WebGLRenderer;
}

/** 伪造 sky cap：只为「sky 是否在场且启用」这一查询服务（组合根注入的查询器） */
function fakeSkyCap(enabled: boolean) {
  return { isEnabled: () => enabled } as unknown as import("./scene-capability.ts").SceneCapability;
}

function makeCap(opts: {
  renderer: THREE.WebGLRenderer;
  skyEnabled?: boolean | null;
  toneMapping?: "none" | "linear" | "reinhard" | "aces" | "cineon";
}) {
  const skyCap =
    opts.skyEnabled === null || opts.skyEnabled === undefined
      ? undefined
      : fakeSkyCap(opts.skyEnabled);
  const caps =
    skyCap === undefined
      ? undefined
      : ({
          getById: (id: string) => (id === "sky" ? skyCap : undefined),
        } as unknown as import("./scene-capability.ts").SceneCapabilityLookup);

  if (opts.toneMapping) {
    setEnvState({ ppToneMapping: opts.toneMapping }, { source: "manual" });
  }
  return new PostprocessingCapability({
    scene: new THREE.Scene(),
    renderer: opts.renderer,
    camera: new THREE.PerspectiveCamera(50, 1, 0.1, 100),
    ...(caps !== undefined ? { caps } : {}),
  });
}

describe("toneMapping 属主归还 —— sky 在场不等于 sky 持有（逐字段判定）", () => {
  it("sky 开启但 renderer 上是 pp 写的非 ACES 值：关 pp 必须归还（当前实现会残留）", () => {
    // 构造期快照 = NoToneMapping（模拟「sky 已先写过 ACES，pp 构造时看到的是 ACES」——
    // 此处直接用 prev=NoToneMapping 更严苛：归还目标与 sky 值不同，能暴露「整块跳过」）
    const renderer = makeRenderer(THREE.NoToneMapping);
    const cap = makeCap({ renderer, skyEnabled: true, toneMapping: "reinhard" });

    cap.setEnabled(true);
    // pp 启用：写自己的 reinhard（≠ sky 的 ACES）
    expect(renderer.toneMapping, "pp 启用后写 reinhard").toBe(THREE.ReinhardToneMapping);

    cap.setEnabled(false);
    // 关键断言：sky 在场，但 renderer 上是 **pp 写的值**（非 ACES）→ 必须归还构造期快照。
    // 旧实现 `if (skyOwns) return;` 会残留 Reinhard。
    expect(
      renderer.toneMapping,
      "sky 在场但 renderer 上是 pp 写的值 → pp 必须归还（不得因 sky 在场整块跳过）",
    ).toBe(THREE.NoToneMapping);
  });

  it("sky 开启且 renderer 上是 sky 的 ACES：关 pp 不得打回 sky 的值（保留既有保护）", () => {
    const renderer = makeRenderer(THREE.NoToneMapping);
    const cap = makeCap({ renderer, skyEnabled: true, toneMapping: "reinhard" });

    cap.setEnabled(true);
    expect(renderer.toneMapping).toBe(THREE.ReinhardToneMapping);

    // 模拟 sky 应用后接管（sky 写 ACES，覆盖了 pp 的值）
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    cap.setEnabled(false);
    // renderer 上已是 sky 的值（≠ pp 写值）→ pp 不是持有者 → 不得覆盖
    expect(
      renderer.toneMapping,
      "renderer 上非 pp 写值时不得盲还原（这是原提前退出想保住的场景）",
    ).toBe(THREE.ACESFilmicToneMapping);
  });

  it("pp 写 aces 且 sky 也写 aces：值相同，归还不改变结果（无害）", () => {
    const renderer = makeRenderer(THREE.NoToneMapping);
    const cap = makeCap({ renderer, skyEnabled: true, toneMapping: "aces" });

    cap.setEnabled(true);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    cap.setEnabled(false);
    // 值与 sky 相同时归还不产生视觉变化
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
  });

  it("无 sky（caps 缺席）时行为不变：仍按逐字段判定归还", () => {
    const renderer = makeRenderer(THREE.NoToneMapping);
    const cap = makeCap({ renderer, skyEnabled: null, toneMapping: "cineon" });

    cap.setEnabled(true);
    expect(renderer.toneMapping).toBe(THREE.CineonToneMapping);
    cap.setEnabled(false);
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
  });
});
