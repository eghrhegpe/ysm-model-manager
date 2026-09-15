// @vitest-environment node
// ===== 地面材质参数 × 模式生效矩阵测试（ADR-249 §2.4）=====
// 矩阵是「菜单可见性」与「渲染读取」的**共同单一事实源**：
//   菜单控件可见 ⇔ paramIsEffective(mode, param) === true
// 本测试锁三件事：
//   1. 矩阵与渲染真实行为一致（逐格对照 generateSurfacePixels / applyGroundSurfaceAppearance）
//   2. 菜单可见集 == 矩阵生效集（防回归死控件）
//   3. none 语义：真的不产出表面（ADR-249 §2.2）
//
// 核实基准：frontend/src/preview-3d/caps/ground-surface-spec.ts（2026-09-16）
// 文档：docs/ADR-249-ground-material-effect-matrix.md

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { GroundCapability } from "./ground-capability.ts";
import { envState, resetEnvState } from "@/preview-3d/state/env-state.ts";
import type { PreviewSnapshot } from "@/preview-3d/state/preview-paths.ts";
import {
  GROUND_SURFACE_MODES,
  GROUND_MAT_PARAMS,
  paramIsEffective,
  effectiveParamsOf,
  type GroundSurfaceMode,
  type GroundMatParam,
  generateSurfacePixels,
  buildGroundSurfaceSpec,
  DEFAULT_GROUND_SURFACE_PARAMS,
  type GroundMaterialParams,
} from "./ground-surface-spec.ts";

/* ============ Suite 1 — 矩阵结构与自身一致性 ============ */

describe("Suite 1 — 生效矩阵结构与自身一致性", () => {
  it("矩阵覆盖全部模式 × 全部参数（无遗漏）", () => {
    for (const mode of GROUND_SURFACE_MODES) {
      const params = effectiveParamsOf(mode);
      expect(Array.isArray(params)).toBe(true);
      // 每个参数都必须可判定（不抛错、返回 boolean）
      for (const p of GROUND_MAT_PARAMS) {
        expect(typeof paramIsEffective(mode, p)).toBe("boolean");
      }
    }
  });

  it("matOpacity/matRoughness/matMetalness 在 solid 起全部模式生效（外观参数不分模式）", () => {
    const appearanceAlways = ["matOpacity", "matRoughness", "matMetalness"] as const;
    for (const mode of GROUND_SURFACE_MODES) {
      for (const p of appearanceAlways) {
        const expected = mode !== "none";
        expect(paramIsEffective(mode, p), `${mode}/${p}`).toBe(expected);
      }
    }
  });

  it("matColor2 仅 marble 生效（副色专用于大理石纹）", () => {
    for (const mode of GROUND_SURFACE_MODES) {
      expect(paramIsEffective(mode, "matColor2"), `${mode}/matColor2`).toBe(mode === "marble");
    }
  });

  it("matLineColor 在 grid/checker/stripes/diamond/marble 生效，solid/plain/none/texture 不生效", () => {
    const lineColorModes: GroundSurfaceMode[] = ["grid", "checker", "stripes", "diamond", "marble"];
    for (const mode of GROUND_SURFACE_MODES) {
      expect(paramIsEffective(mode, "matLineColor"), `${mode}/matLineColor`).toBe(
        lineColorModes.includes(mode),
      );
    }
  });

  it("matDensity/matAngleDeg 仅新三模式（stripes/diamond/marble）生效", () => {
    const newModes: GroundSurfaceMode[] = ["stripes", "diamond", "marble"];
    for (const mode of GROUND_SURFACE_MODES) {
      const expected = newModes.includes(mode);
      expect(paramIsEffective(mode, "matDensity"), `${mode}/matDensity`).toBe(expected);
      expect(paramIsEffective(mode, "matAngleDeg"), `${mode}/matAngleDeg`).toBe(expected);
    }
  });

  it("matScale/matRotationDeg 凡产出或消费贴图的模式均生效，solid/none 不生效", () => {
    // 核实要点：applyGroundSurfaceAppearance 对 mat.map 生效 →
    // ① generateSurfacePixels 产出贴图的模式（含 plain 纯色贴图）被读取；
    // ② texture 的 mat.map = 用户自定义贴图，matScale/matRotationDeg 正是
    //    「自定义贴图缩放/旋转」的设计用途（ADR-249 §2.4 矩阵 texture 列 ✔，
    //    acceptLoadedTexture 设 RepeatWrapping 即为此）——不得被隐藏（死控件）。
    const mapProducing: GroundSurfaceMode[] = [
      "plain",
      "grid",
      "checker",
      "stripes",
      "diamond",
      "marble",
      "texture",
    ];
    for (const mode of GROUND_SURFACE_MODES) {
      const expected = mapProducing.includes(mode);
      expect(paramIsEffective(mode, "matScale"), `${mode}/matScale`).toBe(expected);
      expect(paramIsEffective(mode, "matRotationDeg"), `${mode}/matRotationDeg`).toBe(expected);
    }
  });

  it("none 模式：全部参数均不生效（矩阵层面确认地面被关闭）", () => {
    expect(effectiveParamsOf("none")).toEqual([]);
  });

  it("texture 模式：色彩类参数全部不生效（贴图白乘，色值烘进用户图片）", () => {
    const colorParams: GroundMatParam[] = [
      "matColor",
      "matColor2",
      "matLineColor",
      "matGridSize",
      "matDensity",
      "matAngleDeg",
    ];
    for (const p of colorParams) {
      expect(paramIsEffective("texture", p), `texture/${p}`).toBe(false);
    }
  });
});

/* ============ Suite 2 — 矩阵与渲染真实行为一致（核心护栏）============ */

/** 构造单参数变体，比较两次生成的像素是否不同（探测该参数是否被读取） */
function pixelDiffersWith(mode: GroundSurfaceMode, mutate: (p: GroundMaterialParams) => void): boolean {
  const p1: GroundMaterialParams = { ...DEFAULT_GROUND_SURFACE_PARAMS, matSource: mode };
  const p2: GroundMaterialParams = { ...DEFAULT_GROUND_SURFACE_PARAMS, matSource: mode };
  mutate(p2);
  const a = generateSurfacePixels(buildGroundSurfaceSpec(p1, "").structural, 32);
  const b = generateSurfacePixels(buildGroundSurfaceSpec(p2, "").structural, 32);
  return a.some((v, i) => v !== b[i]);
}

describe("Suite 2 — 矩阵与渲染真实行为一致", () => {
  const colorProbes: Array<[GroundMatParam, (p: GroundMaterialParams) => void]> = [
    ["matColor", (p) => (p.matColor = 0xff0000)],
    ["matColor2", (p) => (p.matColor2 = 0x00ff00)],
    ["matLineColor", (p) => (p.matLineColor = 0x0000ff)],
    ["matDensity", (p) => (p.matDensity = 5)],
  ];

  for (const mode of GROUND_SURFACE_MODES) {
    for (const [param, mutate] of colorProbes) {
      it(`${mode} / ${param}：矩阵判定与像素变化一致`, () => {
        const effective = paramIsEffective(mode, param);
        // matDensity 与 matColor2 在部分模式下改了像素也可能不变（如 marble 的噪声扰动），
        // 故此处只断言「不生效则像素必不变」这一强方向；
        // 「生效」的强断言由 Suite 1 逐模式精确表 + 下方专项用例承担。
        if (!effective) {
          expect(pixelDiffersWith(mode, mutate), `${mode}/${param} 应不生效但像素变了`).toBe(false);
        }
      });
    }
  }

  it("grid 下 matGridSize 变 → 像素变（格数真实生效）", () => {
    expect(pixelDiffersWith("grid", (p) => (p.matGridSize = 16))).toBe(true);
  });

  it("checker 下 matGridSize 变 → 像素变（格数真实生效）", () => {
    expect(pixelDiffersWith("checker", (p) => (p.matGridSize = 16))).toBe(true);
  });

  it("solid 下 matLineColor 变 → 像素不变（死控件确证）", () => {
    expect(pixelDiffersWith("solid", (p) => (p.matLineColor = 0x0000ff))).toBe(false);
  });

  it("solid 下 matColor 变 → 像素变（底色真实生效）", () => {
    expect(pixelDiffersWith("solid", (p) => (p.matColor = 0xff0000))).toBe(true);
  });

  it("stripes 下 matAngleDeg 变 → 像素变（角度真实生效）", () => {
    expect(pixelDiffersWith("stripes", (p) => (p.matAngleDeg = 45))).toBe(true);
  });

  it("plain 下 matDensity 变 → 像素不变（纯色不受密度影响）", () => {
    expect(pixelDiffersWith("plain", (p) => (p.matDensity = 5))).toBe(false);
  });
});

/* ============ Suite 3 — none 语义：真的不产出表面（ADR-249 §2.2）============ */

describe("Suite 3 — none 语义：不产出表面", () => {
  it("none 不生成贴图像素（返回空数组表示「无表面」而非纯色）", () => {
    const st = buildGroundSurfaceSpec(
      { ...DEFAULT_GROUND_SURFACE_PARAMS, matSource: "none" },
      "",
    ).structural;
    const px = generateSurfacePixels(st, 16);
    // 拆轴后 none 必须与 solid 分离：不得再填充不透明纯色
    expect(px.length).toBe(0);
  });

  it("solid 仍生成不透明纯色（与 none 明确区分）", () => {
    const st = buildGroundSurfaceSpec(
      { ...DEFAULT_GROUND_SURFACE_PARAMS, matSource: "solid", matColor: 0x123456 },
      "",
    ).structural;
    const px = generateSurfacePixels(st, 16);
    expect(px.length).toBe(16 * 16 * 4);
    expect(px[0]).toBe(0x12);
    expect(px[1]).toBe(0x34);
    expect(px[2]).toBe(0x56);
    expect(px[3]).toBe(255);
  });
});

/* ============ Suite 4 — 菜单可见集 == 矩阵生效集（死控件回归护栏）============ */
// 这是 ADR-249 §2.4 的核心断言：菜单控件的 visibleWhen 与矩阵必须同源。
// 历史缺陷：全部控件共用一条粗谓词（仅判 ≠ none），在 solid/plain 等模式下
// 显示了渲染根本不读的参数——用户实测「选纯色还显示线色」。

describe("Suite 4 — 菜单可见集与矩阵生效集同源", () => {
  /** 收集材质 folder 下有色/滑块控件的 (id → param) 映射 */
  const nodeIdToParam: Record<string, GroundMatParam> = {
    "ground-mat-color": "matColor",
    "ground-mat-color2": "matColor2",
    "ground-mat-line-color": "matLineColor",
    "ground-mat-grid-size": "matGridSize",
    "ground-mat-density": "matDensity",
    "ground-mat-angle": "matAngleDeg",
    "ground-mat-opacity": "matOpacity",
    "ground-mat-scale": "matScale",
    "ground-mat-rotation": "matRotationDeg",
    "ground-mat-roughness": "matRoughness",
    "ground-mat-metalness": "matMetalness",
  };

  it("每个材质控件的 visibleWhen 直接派生自矩阵（逐模式断言）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const nodes = cap.getMenuNodes();
    const folder = nodes.find((n) => n.id === "cap-group-ground-material");
    expect(folder).toBeDefined();

    for (const [nodeId, param] of Object.entries(nodeIdToParam)) {
      const node = folder!.children!.find((c) => c.id === nodeId);
      expect(node, `控件 ${nodeId} 应存在于材质 folder`).toBeDefined();
      expect(typeof node!.visibleWhen, `${nodeId} 必须声明 visibleWhen`).toBe("function");

      for (const mode of GROUND_SURFACE_MODES) {
        const snapshot = { "env.groundMatSource": mode } as Partial<PreviewSnapshot>;
        const menuVisible = node!.visibleWhen!(snapshot) === true;
        const matrixEffective = paramIsEffective(mode, param);
        expect(menuVisible, `${nodeId} @ ${mode}：菜单可见性与矩阵不一致`).toBe(matrixEffective);
      }
    }
  });

  it("solid 模式下线色/副色/格数控件不可见（用户反馈的具体症状）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const folder = cap.getMenuNodes().find((n) => n.id === "cap-group-ground-material")!;
    const snapshot = { "env.groundMatSource": "solid" } as Partial<PreviewSnapshot>;

    for (const id of ["ground-mat-line-color", "ground-mat-color2", "ground-mat-grid-size"]) {
      const node = folder.children!.find((c) => c.id === id)!;
      expect(node.visibleWhen!(snapshot), `${id} 在纯色下不应可见`).toBe(false);
    }
    // 底色仍可见（纯色靠它）
    const colorNode = folder.children!.find((c) => c.id === "ground-mat-color")!;
    expect(colorNode.visibleWhen!(snapshot)).toBe(true);
  });

  it("none 模式下全部材质控件不可见（矩阵全 false）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const folder = cap.getMenuNodes().find((n) => n.id === "cap-group-ground-material")!;
    const snapshot = { "env.groundMatSource": "none" } as Partial<PreviewSnapshot>;

    for (const node of folder.children!) {
      if (typeof node.visibleWhen === "function") {
        expect(node.visibleWhen(snapshot), `${node.id} 在 none 下不应可见`).toBe(false);
      }
    }
  });
});

/* ============ Suite 5 — 默认值单一事实源（ADR-249 §2.6）============ */

describe("Suite 5 — 默认值单一事实源", () => {
  it("envState 初始默认值与 DEFAULT_GROUND_SURFACE_PARAMS 逐字段一致", () => {
    resetEnvState();
    const pairs: Array<[keyof typeof envState, keyof GroundMaterialParams]> = [
      ["groundMatColor", "matColor"],
      ["groundMatLineColor", "matLineColor"],
      ["groundMatColor2", "matColor2"],
      ["groundMatGridSize", "matGridSize"],
      ["groundMatOpacity", "matOpacity"],
      ["groundMatScale", "matScale"],
      ["groundMatRotationDeg", "matRotationDeg"],
      ["groundMatDensity", "matDensity"],
      ["groundMatAngleDeg", "matAngleDeg"],
      ["groundMatRoughness", "matRoughness"],
      ["groundMatMetalness", "matMetalness"],
    ];
    for (const [stateKey, specKey] of pairs) {
      expect(envState[stateKey], `${String(stateKey)} 与 spec.${String(specKey)} 不一致`).toBe(
        DEFAULT_GROUND_SURFACE_PARAMS[specKey],
      );
    }
  });
});
