// @vitest-environment node
// ===== GroundSurfaceSpec 测试（preview-3d/caps/ground-surface-spec.ts）=====
// 地面材质单一事实源（借鉴 MikuMikuAR ADR-226 精髓，避开其双路径踩坑史）：
// Suite 1 buildGroundSurfaceSpec / surfaceSpecKey 确定性
// Suite 2 重建判别：structural 变化触发、appearance 变化不触发
// Suite 3 合约：rebuild == in-place（同 structural 下外观迁移两条路径产物等价）
// Suite 4 generateSurfacePixels 像素正确性（plain/grid/checker）
// Suite 5 textureRepeat 密度不变量
// Suite 6 叠加层 spec（ADR-249 §2.3 独立格线层）

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { tiledFbm } from "./surface-pixels/noise.ts";
import {
  DEFAULT_GROUND_SURFACE_PARAMS,
  buildGroundSurfaceSpec,
  surfaceSpecKey,
  groundSurfaceNeedsRebuild,
  generateSurfacePixels,
  applyGroundSurfaceAppearance,
  textureRepeat,
  buildGroundOverlaySpec,
  overlaySpecKey,
  overlayNeedsRebuild,
  generateOverlayPixels,
  type GroundMaterialParams,
  type GroundSurfaceMode,
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
    const p = { ...baseParams(), matSource: "marble" as const, matColor: 0xff8800 };
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
    const pA = { ...baseParams(), matSource: "sand" as const };
    const p2 = { ...pA, matOpacity: 0.3, matScale: 4, matRoughness: 0.1 };
    expect(surfaceSpecKey(buildGroundSurfaceSpec(pA, ""))).toBe(surfaceSpecKey(buildGroundSurfaceSpec(p2, "")));
  });

  it("key 对字段顺序不敏感（同值异键序 → 同 key）", () => {
    const base = { ...baseParams(), matSource: "sand" as const, matColor: 0x112233 };
    // 同值，但参数对象键插入序相反：规范序列化后 key 必须相等
    const reversed = Object.fromEntries(
      Object.entries(base).reverse(),
    ) as unknown as GroundMaterialParams;
    expect(surfaceSpecKey(buildGroundSurfaceSpec(base, ""))).toBe(
      surfaceSpecKey(buildGroundSurfaceSpec(reversed, "")),
    );
  });

  it("structural 逐字段完备：任一字段变化 key 必变（锁死「新增字段自动纳入」）", () => {
    const spec = buildGroundSurfaceSpec({ ...baseParams(), matSource: "sand" as const }, "");
    const base = surfaceSpecKey(spec);
    // code_review 74cc9ad95 #1/#3：嵌套三元扁平化为具名 helper（批次规则禁嵌套三元）
    const mutate = (v: unknown): unknown => {
      if (Array.isArray(v)) return (v as number[]).map((n) => n + 1);
      if (typeof v === "number") return v + 1;
      return `${String(v)}#`;
    };
    for (const [field, value] of Object.entries(spec.structural)) {
      const mutated = {
        ...spec.structural,
        [field]: mutate(value),
      } as typeof spec.structural;
      expect(surfaceSpecKey({ ...spec, structural: mutated })).not.toBe(base);
    }
  });

  it("key 对 structural 键插入序不敏感（规范序列化契约）", () => {
    // code_review 74cc9ad95 #2/#4 回归锚：整体 JSON.stringify 依赖键插入序，仅
    // buildGroundSurfaceSpec 字面量固定序的约定兜底；排序键投影后同内容异键序 key 相等
    const spec = buildGroundSurfaceSpec({ ...baseParams(), matSource: "sand" as const }, "");
    const stA = spec.structural as unknown as Record<string, unknown>;
    const keys = Object.keys(stA);
    const stB = Object.fromEntries([...keys].reverse().map((k) => [k, stA[k]])) as unknown as typeof spec.structural;
    expect(surfaceSpecKey({ ...spec, structural: stB })).toBe(
      surfaceSpecKey(spec),
    );
  });
});

describe("Suite 2 — 重建判别 groundSurfaceNeedsRebuild", () => {
  it("structural 任一字段变化 → true", () => {
    const prev = buildGroundSurfaceSpec({ ...baseParams(), matSource: "marble" as const }, "");
    const cases: Array<Partial<GroundMaterialParams>> = [
      { matSource: "sand" },
      { matColor: 0xffffff },
      { matColor2: 0xffffff },
      { matGridSize: 16 },
    ];
    for (const patch of cases) {
      const next = buildGroundSurfaceSpec({ ...baseParams(), matSource: "marble" as const, ...patch }, "");
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

  const structuralBase = { ...baseParams(), matSource: "marble" as const };

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
  // ⚠️ 刀⑳：本用例原名「plain：全图均匀填充 color」却传 `matSource: "solid"` —— 名实不符，
  // 导致 `"plain"` 分支**从未被覆盖**，掩盖了「素面渲染成格线」的真 bug（见下条用例）。
  it("solid：全图均匀填充 color", () => {
    const st = buildGroundSurfaceSpec({ ...baseParams(), matSource: "solid", matColor: 0xaabbcc }, "").structural;
    const px = generateSurfacePixels(st, 4);
    expect(px.length).toBe(4 * 4 * 4);
    for (let i = 0; i < px.length; i += 4) {
      expect([px[i], px[i + 1], px[i + 2]]).toEqual([0xaa, 0xbb, 0xcc]);
      expect(px[i + 3]).toBe(255);
    }
  });

  it("plain（素面）：必须与 solid 同为纯色，禁止出现任何图案像素（刀⑳ 真 bug 回归）", () => {
    const st = buildGroundSurfaceSpec(
      { ...baseParams(), matSource: "plain", matColor: 0xaabbcc, matGridSize: 4 },
      "",
    ).structural;
    const px = generateSurfacePixels(st, 8);
    for (let i = 0; i < px.length; i += 4) {
      expect([px[i], px[i + 1], px[i + 2]]).toEqual([0xaa, 0xbb, 0xcc]); // 全图纯色，无线色
      expect(px[i + 3]).toBe(255);
    }
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

/* ============ Suite 6 — 叠加层 spec（ADR-249 §2.3）============ */

describe("Suite 6 — 叠加层 spec / 像素生成", () => {
  const ov = (style: "none" | "grid" | "checker") =>
    buildGroundOverlaySpec({ overlayStyle: style, overlayColor: 0xff0000, overlaySize: 8, overlayOpacity: 0.5 });

  it("buildGroundOverlaySpec：hex → [r,g,b] 拆解正确", () => {
    const s = buildGroundOverlaySpec({
      overlayStyle: "grid",
      overlayColor: 0x3366cc,
      overlaySize: 12,
      overlayOpacity: 0.25,
    });
    expect(s.color).toEqual([0x33, 0x66, 0xcc]);
    expect(s.style).toBe("grid");
    expect(s.size).toBe(12);
    expect(s.opacity).toBe(0.25);
  });

  it("overlaySpecKey：style/color/size 入 key；opacity 不入（外观参数走原地）", () => {
    const a = ov("grid");
    const b = { ...a, opacity: 0.9 };
    expect(overlaySpecKey(a)).toBe(overlaySpecKey(b));
    expect(overlayNeedsRebuild(a, b)).toBe(false);
    expect(overlayNeedsRebuild(a, { ...a, size: 16 })).toBe(true);
    expect(overlayNeedsRebuild(a, { ...a, style: "checker" })).toBe(true);
    expect(overlayNeedsRebuild(null, a)).toBe(true);
  });

  it("generateOverlayPixels：none 返回空数组（表示无叠加）", () => {
    expect(generateOverlayPixels("none", 16, [255, 255, 255], 8).length).toBe(0);
  });

  it("generateOverlayPixels：grid 透明底 + 不透明线（alpha 二值化）", () => {
    const px = generateOverlayPixels("grid", 32, [255, 0, 0], 8);
    expect(px.length).toBe(32 * 32 * 4);
    let opaque = 0;
    let transparent = 0;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] === 255) opaque++;
      else if (px[i] === 0) transparent++;
    }
    expect(opaque).toBeGreaterThan(0);
    expect(transparent).toBeGreaterThan(0);
    // 线面积占比 < 50%（格线而非实心）
    expect(opaque).toBeLessThan(transparent);
  });

  it("generateOverlayPixels：checker 与 grid 像素分布不同（样式真实生效）", () => {
    const a = generateOverlayPixels("grid", 32, [255, 0, 0], 8);
    const b = generateOverlayPixels("checker", 32, [255, 0, 0], 8);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  // ADR-249 §2.4 死控件回归：格数必须真实改变像素。
  // 初版硬编码 `sizePx / 8` 且不设 map.repeat，「叠加格数」滑杆拖了没反应。
  it("generateOverlayPixels：cells 变化 → 像素分布变化（格数真实生效）", () => {
    const few = generateOverlayPixels("grid", 64, [255, 0, 0], 4);
    const many = generateOverlayPixels("grid", 64, [255, 0, 0], 16);
    expect(Array.from(few)).not.toEqual(Array.from(many));
    const countLines = (px: Uint8Array): number => {
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] === 255) n++;
      return n;
    };
    // 格数越多，线（不透明像素）越多
    expect(countLines(many)).toBeGreaterThan(countLines(few));
  });

  it("generateOverlayPixels：cells 相同则像素完全一致（确定性）", () => {
    const a = generateOverlayPixels("checker", 32, [1, 2, 3], 6);
    const b = generateOverlayPixels("checker", 32, [1, 2, 3], 6);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("线色真实进入像素：不同 color 产出不同 RGB", () => {
    const red = generateOverlayPixels("grid", 32, [255, 0, 0], 8);
    const blue = generateOverlayPixels("grid", 32, [0, 0, 255], 8);
    // 找到第一个不透明像素比较首通道
    const firstOpaque = (px: Uint8Array): number => {
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] === 255) return px[i];
      return -1;
    };
    expect(firstOpaque(red)).toBe(255);
    expect(firstOpaque(blue)).toBe(0);
  });
});

/* ============ Suite 7 — 噪声材质 sand/grass（ADR-251）============ */

describe("Suite 7 — 噪声材质 sand / grass", () => {
  const mode = (m: GroundSurfaceMode, over: Partial<GroundMaterialParams> = {}) =>
    buildGroundSurfaceSpec(
      {
        ...DEFAULT_GROUND_SURFACE_PARAMS,
        matSource: m,
        matColor: 0x000000,
        matColor2: 0xffffff,
        ...over,
      },
      "",
    );

  it("sand/grass 产出非均匀像素（是材质不是纯色）", () => {
    for (const m of ["sand", "grass"] as const) {
      const st = mode(m).structural;
      const px = generateSurfacePixels(st, 32);
      expect(px.length, `${m} 应有像素`).toBe(32 * 32 * 4);
      const first = px[0];
      let varied = false;
      for (let i = 0; i < px.length; i += 4) if (px[i] !== first) varied = true;
      expect(varied, `${m} 应为噪声而非均匀色`).toBe(true);
    }
  });

  it("sand 与 grass 像素分布不同（频率/对比度确实不同）", () => {
    const a = generateSurfacePixels(mode("sand").structural, 32);
    const b = generateSurfacePixels(mode("grass").structural, 32);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("sand/grass 与 marble 像素分布不同（不同材质）", () => {
    const sand = generateSurfacePixels(mode("sand").structural, 32);
    const marble = generateSurfacePixels(mode("marble").structural, 32);
    expect(Array.from(sand)).not.toEqual(Array.from(marble));
  });

  it("sand/grass 读 color2：副色变化 → 像素变化", () => {
    for (const m of ["sand", "grass"] as const) {
      const dark = generateSurfacePixels(mode(m, { matColor2: 0x111111 }).structural, 32);
      const light = generateSurfacePixels(mode(m, { matColor2: 0xeeeeee }).structural, 32);
      expect(Array.from(dark), `${m} 副色应生效`).not.toEqual(Array.from(light));
    }
  });


  it("sand/grass 确定性：同参数两次生成完全一致", () => {
    for (const m of ["sand", "grass"] as const) {
      expect(Array.from(generateSurfacePixels(mode(m).structural, 32))).toEqual(
        Array.from(generateSurfacePixels(mode(m).structural, 32)),
      );
    }
  });

  it("sand/grass 进 structural（变则重建）", () => {
    const a = mode("sand");
    const b = mode("sand", { matDensity: 2 });
    expect(groundSurfaceNeedsRebuild(a, b)).toBe(true);
    expect(groundSurfaceNeedsRebuild(a, a)).toBe(false);
  });
});

/* ============ Suite 8 — 叠加层补齐几何图案（ADR-251）============ */

describe("Suite 8 — 叠加层 stripes / diamond", () => {
  const px = (style: "grid" | "checker" | "stripes" | "diamond") =>
    generateOverlayPixels(style, 32, [255, 255, 255], 8);

  it("stripes/diamond 均为透明底 + 不透明线（可叠加而非实心）", () => {
    for (const style of ["stripes", "diamond"] as const) {
      const p = px(style);
      let opaque = 0;
      let transparent = 0;
      for (let i = 3; i < p.length; i += 4) {
        if (p[i] === 255) opaque++;
        else if (p[i] === 0) transparent++;
      }
      expect(opaque, `${style} 应有线`).toBeGreaterThan(0);
      expect(transparent, `${style} 应有透明区`).toBeGreaterThan(0);
    }
  });

  it("四种叠加样式两两像素不同（样式真实生效）", () => {
    const styles = ["grid", "checker", "stripes", "diamond"] as const;
    const seen = styles.map((s) => Array.from(px(s)));
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        expect(seen[i], `${styles[i]} vs ${styles[j]}`).not.toEqual(seen[j]);
      }
    }
  });

  it("stripes/diamond 确定性", () => {
    for (const style of ["stripes", "diamond"] as const) {
      expect(Array.from(px(style))).toEqual(Array.from(px(style)));
    }
  });
});

/* ============ Suite 9 — 4D 环面无缝（RepeatWrapping 接缝根治）============ */

describe("Suite 9 — 4D 环面无缝噪声（治平铺接缝）", () => {
  it("tiledFbm 周期 1：u→u+1 / v→v+1 严格相等（任意 angleRad 仍无缝）", () => {
    const freqs: Array<[number, number]> = [
      [3, 5],
      [8, 8],
      [1, 12],
      [5, 3],
    ];
    for (const [fx, fy] of freqs) {
      for (const a of [0, 0.7, 2.3, 5.1]) {
        const u = 0.31;
        const v = 0.57;
        const a1 = tiledFbm(u, v, fx, fy, a, 4);
        const a2 = tiledFbm(u + 1, v, fx, fy, a, 4);
        const a3 = tiledFbm(u, v + 1, fx, fy, a, 4);
        expect(a1).toBeCloseTo(a2, 9);
        expect(a1).toBeCloseTo(a3, 9);
      }
    }
  });

  it("tiledFbm 确定性：同参两次一致（seed 噪声非 Math.random）", () => {
    const a = tiledFbm(0.2, 0.8, 6, 6, 1.1, 4);
    const b = tiledFbm(0.2, 0.8, 6, 6, 1.1, 4);
    expect(a).toBe(b);
  });

  // 生成器层回归：4D 无缝改造后，噪声材质仍非均匀、可复现；
  // angleRad 现已改为「环面相位偏移」（任意角度无缝），不再旋转坐标系。
  const build = (m: GroundSurfaceMode) =>
    buildGroundSurfaceSpec(
      { ...DEFAULT_GROUND_SURFACE_PARAMS, matSource: m, matColor: 0x000000, matColor2: 0xffffff },
      "",
    ).structural;

  for (const m of ["marble", "sand", "grass"] as const) {
    it(`${m}：生成器非均匀且确定性（4D 无缝改造行为保持）`, () => {
      const st = build(m);
      const a = generateSurfacePixels(st, 32);
      const b = generateSurfacePixels(st, 32);
      const first = a[0];
      let varied = false;
      for (let i = 0; i < a.length; i += 4) if (a[i] !== first) varied = true;
      expect(varied, `${m} 应为噪声而非均匀色`).toBe(true);
      expect(Array.from(a)).toEqual(Array.from(b));
    });
  }
});
