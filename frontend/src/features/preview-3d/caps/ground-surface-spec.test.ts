// @vitest-environment node
// ===== GroundSurfaceSpec 测试（features/preview-3d/caps/ground-surface-spec.ts）=====
// 地面材质单一事实源（借鉴 MikuMikuAR ADR-226 精髓，避开其双路径踩坑史）：
// Suite 1 buildGroundSurfaceSpec / surfaceSpecKey 确定性
// Suite 2 重建判别：structural 变化触发、appearance 变化不触发
// Suite 3 合约：rebuild == in-place（同 structural 下外观迁移两条路径产物等价）
// Suite 4 generateSurfacePixels 像素正确性（plain/grid/checker）
// Suite 5 textureRepeat 密度不变量

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_GROUND_SURFACE_PARAMS,
  buildGroundSurfaceSpec,
  surfaceSpecKey,
  groundSurfaceNeedsRebuild,
  generateSurfacePixels,
  applyGroundSurfaceAppearance,
  textureRepeat,
  type GroundMaterialParams,
} from "./ground-surface-spec.ts";

const baseParams = (): GroundMaterialParams => ({
  ...DEFAULT_GROUND_SURFACE_PARAMS,
});

function makeMap(): THREE.Texture {
  const tex = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 2, 2);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

describe("Suite 1 — spec 构建与 key 确定性", () => {
  it("同参数两次构建 spec 深度相等", () => {
    const p = { ...baseParams(), matSource: "checker" as const, matColor: 0xff8800 };
    const a = buildGroundSurfaceSpec(p, "");
    const b = buildGroundSurfaceSpec(p, "");
    expect(a).toEqual(b);
    expect(surfaceSpecKey(a)).toBe(surfaceSpecKey(b));
  });

  it("hex 颜色转 RGB 三元组；角度转弧度", () => {
    const p = { ...baseParams(), matSource: "solid" as const, matColor: 0x102030, matRotationDeg: 90 };
    const spec = buildGroundSurfaceSpec(p, "");
    expect(spec.structural.color).toEqual([0x10, 0x20, 0x30]);
    expect(spec.appearance.rotationRad).toBeCloseTo(Math.PI / 2);
  });

  it("textureToken 进 structural（key 含 token），appearance 字段不进 key", () => {
    const p = { ...baseParams(), matSource: "texture" as const };
    const withTok = buildGroundSurfaceSpec(p, "wood.png:512x512");
    const without = buildGroundSurfaceSpec(p, "");
    expect(surfaceSpecKey(withTok)).not.toBe(surfaceSpecKey(without));
    // 外观不同但 key 相同（structural 保持一致）
    const pA = { ...baseParams(), matSource: "grid" as const };
    const p2 = { ...pA, matOpacity: 0.3, matScale: 4, matRoughness: 0.1 };
    expect(surfaceSpecKey(buildGroundSurfaceSpec(pA, ""))).toBe(surfaceSpecKey(buildGroundSurfaceSpec(p2, "")));
  });

  it("key 对字段顺序不敏感（确定性序列化）", () => {
    const p1 = { ...baseParams(), matSource: "grid" as const, matGridSize: 8, matLineColor: 0x112233 };
    const p2 = { ...baseParams(), matLineColor: 0x112233, matGridSize: 8, matSource: "grid" as const };
    expect(surfaceSpecKey(buildGroundSurfaceSpec(p1, ""))).toBe(surfaceSpecKey(buildGroundSurfaceSpec(p2, "")));
  });
});

describe("Suite 2 — 重建判别 groundSurfaceNeedsRebuild", () => {
  it("structural 任一字段变化 → true", () => {
    const prev = buildGroundSurfaceSpec({ ...baseParams(), matSource: "checker" as const }, "");
    const cases: Array<Partial<GroundMaterialParams>> = [
      { matSource: "grid" },
      { matColor: 0xffffff },
      { matLineColor: 0xffffff },
      { matGridSize: 16 },
    ];
    for (const patch of cases) {
      const next = buildGroundSurfaceSpec({ ...baseParams(), matSource: "checker" as const, ...patch }, "");
      expect(groundSurfaceNeedsRebuild(prev, next), JSON.stringify(patch)).toBe(true);
    }
    // token 变化
    const nextTok = buildGroundSurfaceSpec({ ...baseParams(), matSource: "texture" as const }, "a.png");
    const fromEmpty = buildGroundSurfaceSpec({ ...baseParams(), matSource: "texture" as const }, "");
    expect(groundSurfaceNeedsRebuild(fromEmpty, nextTok)).toBe(true);
  });

  it("appearance 全字段变化 → false（原地更新即可）", () => {
    const prev = buildGroundSurfaceSpec(baseParams(), "");
    const next = buildGroundSurfaceSpec(
      { ...baseParams(), matOpacity: 0.42, matScale: 3.5, matRotationDeg: 200, matRoughness: 0.15, matMetalness: 0.9 },
      "",
    );
    expect(groundSurfaceNeedsRebuild(prev, next)).toBe(false);
  });
});

describe("Suite 3 — 合约：rebuild == in-place", () => {
  const MESH_SIZE = 50;

  /** 重建路径：全新材质 + 从 spec 落地 */
  function rebuildPath(spec: ReturnType<typeof buildGroundSurfaceSpec>): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial();
    if (spec.structural.mode !== "solid" && spec.structural.mode !== "none") {
      mat.map = makeMap(); // 模拟重建时挂纹理
    }
    applyGroundSurfaceAppearance(mat, spec, MESH_SIZE);
    return mat;
  }

  /** 原地路径：已有材质上连续 apply */
  function inplacePath(from: ReturnType<typeof buildGroundSurfaceSpec>, to: ReturnType<typeof buildGroundSurfaceSpec>): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial();
    if (from.structural.mode !== "solid" && from.structural.mode !== "none") {
      mat.map = makeMap();
    }
    applyGroundSurfaceAppearance(mat, from, MESH_SIZE);
    applyGroundSurfaceAppearance(mat, to, MESH_SIZE); // 原地迁移动作
    return mat;
  }

  function expectMaterialsEqual(a: THREE.MeshStandardMaterial, b: THREE.MeshStandardMaterial): void {
    expect(a.opacity).toBeCloseTo(b.opacity);
    expect(a.transparent).toBe(b.transparent);
    expect(a.roughness).toBeCloseTo(b.roughness);
    expect(a.metalness).toBeCloseTo(b.metalness);
    if (a.map && b.map) {
      expect(a.map.repeat.x).toBeCloseTo(b.map.repeat.x);
      expect(a.map.repeat.y).toBeCloseTo(b.map.repeat.y);
      expect(a.map.rotation).toBeCloseTo(b.map.rotation);
    } else {
      expect(a.map).toBe(b.map);
    }
  }

  const structuralBase = { ...baseParams(), matSource: "checker" as const };

  it("opacity 迁移：两路径产物一致", () => {
    const sA = buildGroundSurfaceSpec(structuralBase, "");
    const sB = buildGroundSurfaceSpec({ ...structuralBase, matOpacity: 0.5 }, "");
    expectMaterialsEqual(rebuildPath(sB), inplacePath(sA, sB));
  });

  it("scale/rotation 迁移：UV transform 两路径一致", () => {
    const sA = buildGroundSurfaceSpec(structuralBase, "");
    const sB = buildGroundSurfaceSpec({ ...structuralBase, matScale: 3, matRotationDeg: 45 }, "");
    expectMaterialsEqual(rebuildPath(sB), inplacePath(sA, sB));
  });

  it("PBR 标量迁移：两路径产物一致", () => {
    const sA = buildGroundSurfaceSpec(structuralBase, "");
    const sB = buildGroundSurfaceSpec({ ...structuralBase, matRoughness: 0.2, matMetalness: 0.8 }, "");
    expectMaterialsEqual(rebuildPath(sB), inplacePath(sA, sB));
  });

  it("apply 不触碰 map 引用与 color（structural 归属不被原地路径污染）", () => {
    const mat = new THREE.MeshStandardMaterial();
    const tex = makeMap();
    mat.map = tex;
    mat.color.setHex(0x123456);
    applyGroundSurfaceAppearance(mat, buildGroundSurfaceSpec({ ...baseParams(), matOpacity: 0.7 }, ""), 50);
    expect(mat.map).toBe(tex);
    expect(mat.color.getHex()).toBe(0x123456);
  });

  it("repeat 由 textureRepeat 单点计算（两路径一致，scale 生效）", () => {
    const sA = buildGroundSurfaceSpec(structuralBase, "");
    const sB = buildGroundSurfaceSpec({ ...structuralBase, matScale: 2.5 }, "");
    const rebuilt = rebuildPath(sB);
    expect(rebuilt.map!.repeat.x).toBeCloseTo(textureRepeat(50, 2.5));
    expectMaterialsEqual(rebuilt, inplacePath(sA, sB));
  });
});

describe("Suite 4 — generateSurfacePixels", () => {
  it("plain：全图均匀填充 color", () => {
    const st = buildGroundSurfaceSpec({ ...baseParams(), matSource: "solid", matColor: 0xaabbcc }, "").structural;
    const px = generateSurfacePixels(st, 4);
    expect(px.length).toBe(4 * 4 * 4);
    for (let i = 0; i < px.length; i += 4) {
      expect([px[i], px[i + 1], px[i + 2]]).toEqual([0xaa, 0xbb, 0xcc]);
      expect(px[i + 3]).toBe(255);
    }
  });

  it("checker：相邻 cell 颜色交替（color 与 lineColor 棋盘交错）", () => {
    const st = buildGroundSurfaceSpec(
      { ...baseParams(), matSource: "checker", matColor: 0xffffff, matLineColor: 0x000000, matGridSize: 4 },
      "",
    ).structural;
    const px = generateSurfacePixels(st, 8); // cell=2px
    const at = (x: number, y: number): number[] => {
      const i = (y * 8 + x) * 4;
      return [px[i], px[i + 1], px[i + 2]];
    };
    expect(at(0, 0)).toEqual([255, 255, 255]);
    expect(at(1, 0)).toEqual([255, 255, 255]);
    expect(at(2, 0)).toEqual([0, 0, 0]);
    expect(at(0, 2)).toEqual([0, 0, 0]); // 行交替
    expect(at(2, 2)).toEqual([255, 255, 255]);
  });

  it("grid：cell 边界为线色，内部为底色", () => {
    const st = buildGroundSurfaceSpec(
      { ...baseParams(), matSource: "grid", matColor: 0x111111, matLineColor: 0xeeeeee, matGridSize: 4 },
      "",
    ).structural;
    const px = generateSurfacePixels(st, 8); // cell=2px：x/y∈{0,2,4,6} 为线
    const at = (x: number, y: number): number[] => {
      const i = (y * 8 + x) * 4;
      return [px[i], px[i + 1], px[i + 2]];
    };
    expect(at(0, 0)).toEqual([238, 238, 238]); // 边界线
    expect(at(1, 1)).toEqual([17, 17, 17]); // 内部
    expect(at(4, 3)).toEqual([238, 238, 238]);
    expect(at(5, 5)).toEqual([17, 17, 17]);
  });
});

describe("Suite 5 — textureRepeat 密度不变量", () => {
  it("repeat = meshSize / TILE_WORLD_SIZE / scale（单点维护）", () => {
    expect(textureRepeat(50, 1)).toBeCloseTo(5); // 默认 50 世界单位 / 10 / 1
    expect(textureRepeat(50, 2)).toBeCloseTo(2.5);
    expect(textureRepeat(100, 1)).toBeCloseTo(10);
  });

  it("scale 越大 repeat 越小（防拉伸方向正确）", () => {
    expect(textureRepeat(50, 4)).toBeLessThan(textureRepeat(50, 1));
  });
});

describe("Suite 6 — 新材质模式（stripes/diamond/marble）", () => {
  const params = (overrides: Partial<GroundMaterialParams>): GroundMaterialParams => ({
    ...baseParams(),
    ...overrides,
  });

  it("stripes 模式像素：奇偶列方向（angle=0）每半 cell 交替 color / lineColor", () => {
    // gridSize=8, sizePx=32 → cell=4px；density=1 → stripe 宽度 cell/2=2px
    const st = buildGroundSurfaceSpec(
      params({ matSource: "stripes", matColor: 0xff0000, matLineColor: 0x0000ff, matGridSize: 8, matAngleDeg: 0, matDensity: 1 }),
      "",
    ).structural;
    const px = generateSurfacePixels(st, 32);
    const at = (x: number, y: number): number[] => {
      const i = (y * 32 + x) * 4;
      return [px[i], px[i + 1], px[i + 2]];
    };
    // angle=0 竖条纹：x=0（第一列）应是 color 红；x=2（跨过半 cell）应是 lineColor 蓝
    expect(at(0, 0)).toEqual([255, 0, 0]);
    expect(at(2, 0)).toEqual([0, 0, 255]);
    expect(at(4, 0)).toEqual([255, 0, 0]);
    // 垂直方向同一列，颜色一致
    expect(at(0, 10)).toEqual([255, 0, 0]);
  });

  it("diamond 模式像素：对角线存在 lineColor（黑色）绘制，面积不超过 50%", () => {
    const st = buildGroundSurfaceSpec(
      params({ matSource: "diamond", matColor: 0xcccccc, matLineColor: 0x000000, matGridSize: 4, matAngleDeg: 0, matDensity: 1 }),
      "",
    ).structural;
    const px = generateSurfacePixels(st, 32);
    let blackPx = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) blackPx++;
    }
    const total = (32 * 32);
    expect(blackPx).toBeGreaterThan(0);
    expect(blackPx).toBeLessThan(total * 0.5);
  });

  it("marble 模式：像素不是完全均匀（含噪声扰动），大理石纹占比 >5%", () => {
    const st = buildGroundSurfaceSpec(
      params({ matSource: "marble", matColor: 0xe6dcc8, matColor2: 0xb4aa96, matGridSize: 6, matDensity: 1, matAngleDeg: 0 }),
      "",
    ).structural;
    const px = generateSurfacePixels(st, 64);
    expect(px.length).toBe(64 * 64 * 4);
    let different = 0;
    const [cr, cg, cb] = [230, 220, 200];
    for (let i = 0; i < px.length; i += 4) {
      const dr = Math.abs(px[i] - cr), dg = Math.abs(px[i + 1] - cg), db = Math.abs(px[i + 2] - cb);
      if (dr > 2 || dg > 2 || db > 2) different++;
    }
    expect(different).toBeGreaterThan(64 * 64 * 0.05);
  });

  it("marble 可复现：两次同参调用像素完全一致（seed 噪声而非 Math.random）", () => {
    const p = params({ matSource: "marble", matColor: 0xe6dcc8, matColor2: 0xb4aa96, matGridSize: 6, matDensity: 1, matAngleDeg: 0 });
    const a = generateSurfacePixels(buildGroundSurfaceSpec(p, "").structural, 32);
    const b = generateSurfacePixels(buildGroundSurfaceSpec(p, "").structural, 32);
    expect(a).toEqual(b);
  });

  it("matColor2 / matDensity / matAngleDeg 变化 → structural specKey 变化（触发重建）", () => {
    const base = params({ matSource: "solid", matColor: 0xff0000, matColor2: 0x0000ff, matDensity: 1, matAngleDeg: 0 });
    const a = buildGroundSurfaceSpec(base, "");
    const b = buildGroundSurfaceSpec(params({ ...base, matColor2: 0x00ff00 }), "");
    const c = buildGroundSurfaceSpec(params({ ...base, matDensity: 2 }), "");
    const d = buildGroundSurfaceSpec(params({ ...base, matAngleDeg: 45 }), "");
    expect(groundSurfaceNeedsRebuild(a, b)).toBe(true);
    expect(groundSurfaceNeedsRebuild(a, c)).toBe(true);
    expect(groundSurfaceNeedsRebuild(a, d)).toBe(true);
    expect(groundSurfaceNeedsRebuild(a, a)).toBe(false);
  });
});
