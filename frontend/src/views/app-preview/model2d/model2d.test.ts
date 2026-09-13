// @vitest-environment node
// ===== model2d 命中区域坐标测试（ADR-021 扩展，防坐标回归）=====
// calcBoneHitZones：2D 正交投影热区计算（scale/偏移/骨骼位移/绕 pivot 旋转/前后视图）。
import { describe, it, expect, vi, type Mock } from "vitest";
import { calcBoneHitZones, renderModel2D } from "./model2d.ts";
import { collectBoneBounds } from "./model2d-geom.ts";
import type { BedrockModel, BedrockCube } from "./model2d.ts";
import type { BoneTransform, Vec3 } from "@/utils/animation/animation.ts";

/** 便捷构造：单骨骼单 cube 模型 */
function cubeModel(bone: string, cube: BedrockCube): BedrockModel {
  return { bones: [{ name: bone, cubes: [cube] }] };
}

const SIMPLE_CUBE = { origin: [0, 0, 0], size: [2, 4, 6] };

describe("calcBoneHitZones 基础投影", () => {
  it("前视图无旋转：x=origin.x, y=-(maxY), w=size.x, h=size.y", () => {
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      1, 0, 0, true, 1, 0, null,
    );
    expect(zones).toHaveLength(1);
    expect(zones[0]).toEqual({ name: "bone", x: 0, y: -4, w: 2, h: 4 });
  });

  it("scale 放大 + ox/oy 偏移生效", () => {
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      2, 100, 50, true, 1, 0, null,
    );
    expect(zones[0].x).toBe(100); // ox + mnX*scale
    expect(zones[0].y).toBe(42); // oy - mxY*scale = 50 - 4*2
    expect(zones[0].w).toBe(4); // 2*2
    expect(zones[0].h).toBe(8); // 4*2
  });

  it("骨骼 position 位移参与热区计算", () => {
    const transforms = new Map<string, BoneTransform>([
      ["bone", { position: [1, 2, 3] as Vec3 }],
    ]);
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      1, 0, 0, true, 1, 0, transforms,
    );
    expect(zones[0].x).toBe(1); // x 整体 +1
    expect(zones[0].y).toBe(-6); // maxY = 4+2
    expect(zones[0].w).toBe(2);
    expect(zones[0].h).toBe(4);
  });

  it("无 cubes 的骨骼被跳过", () => {
    const zones = calcBoneHitZones(
      { bones: [{ name: "empty", cubes: [] }] },
      1, 0, 0, true, 1, 0, null,
    );
    expect(zones).toHaveLength(0);
  });

  it("模型为空返回空数组", () => {
    expect(calcBoneHitZones({}, 1, 0, 0, true, 1, 0, null)).toEqual([]);
  });
});

describe("calcBoneHitZones 旋转", () => {
  it("绕 pivot Z 轴旋转 90°：热区随旋转变化", () => {
    // pivot 默认 [1,2,3]；Z 旋转 90° 后 x∈[-1,3], y∈[1,3]
    const transforms = new Map<string, BoneTransform>([
      ["bone", { rotation: [0, 0, 90] as Vec3 }],
    ]);
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      1, 0, 0, true, 1, 0, transforms,
    );
    expect(zones[0].x).toBeCloseTo(-1, 5);
    expect(zones[0].y).toBeCloseTo(-3, 5);
    expect(zones[0].w).toBeCloseTo(4, 5);
    expect(zones[0].h).toBeCloseTo(2, 5);
  });

  it("视图旋转角 cosA/sinA 参与投影（Y 轴旋转）", () => {
    // 旋转 90°：cosA=0, sinA=1 → rxx = -cz, rz2 = cx
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      1, 0, 0, true, 0, 1, null,
    );
    // 前视图 py2 = cy：x 范围取 -cz ∈ [-6,0]，y 范围 cy ∈ [0,4]
    expect(zones[0].x).toBe(-6);
    expect(zones[0].w).toBe(6);
    expect(zones[0].y).toBe(-4);
    expect(zones[0].h).toBe(4);
  });
});

describe("calcBoneHitZones 后视图", () => {
  it("isFront=false 时 py2 取 rz2（z 投影）", () => {
    // cosA=1, sinA=0 → rz2 = cz ∈ [0,6]
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      1, 0, 0, false, 1, 0, null,
    );
    expect(zones[0].x).toBe(0);
    expect(zones[0].w).toBe(2);
    expect(zones[0].y).toBe(-6); // maxY = 6（z 轴）
    expect(zones[0].h).toBe(6);
  });
});

describe("calcBoneHitZones 补充分支", () => {
  it("骨骼 X 轴旋转 90°：Y 方向按 cos(rx) 压缩为 0", () => {
    const transforms = new Map<string, BoneTransform>([
      ["bone", { rotation: [90, 0, 0] as Vec3 }],
    ]);
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      1, 0, 0, true, 1, 0, transforms,
    );
    // cos(90°)=0 → 所有角点 cy 压到 pivot.y=2，高度归零
    expect(zones[0].h).toBeCloseTo(0, 5);
    expect(zones[0].y).toBeCloseTo(-2, 5);
    expect(zones[0].w).toBe(2); // X 旋转不影响 x 范围
  });

  it("cube 显式 pivot 覆盖默认中心（Z 旋转绕自定义 pivot）", () => {
    const cube = { origin: [0, 0, 0], size: [2, 4, 6], pivot: [0, 0, 0] };
    const transforms = new Map<string, BoneTransform>([
      ["bone", { rotation: [0, 0, 90] as Vec3 }],
    ]);
    const zones = calcBoneHitZones(
      cubeModel("bone", cube),
      1, 0, 0, true, 1, 0, transforms,
    );
    // pivot=[0,0,0]，Z 旋转 90°：角点 (x,y) → (-y,x)
    // x∈[0,2],y∈[0,4] → x'∈[-4,0], y'∈[0,2]
    expect(zones[0].x).toBeCloseTo(-4, 5);
    expect(zones[0].w).toBeCloseTo(4, 5);
    expect(zones[0].y).toBeCloseTo(-2, 5);
    expect(zones[0].h).toBeCloseTo(2, 5);
  });

  it("position + rotation 同时作用", () => {
    const transforms = new Map<string, BoneTransform>([
      ["bone", { position: [5, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 }],
    ]);
    const zones = calcBoneHitZones(
      cubeModel("bone", SIMPLE_CUBE),
      1, 0, 0, true, 1, 0, transforms,
    );
    expect(zones[0].x).toBe(5); // 仅 x 平移
    expect(zones[0].w).toBe(2);
  });
});

// ── renderModel2D 冒烟测试 ──
// canvas 2D 在 jsdom 不可用（getContext 返回 null），用 Proxy mock ctx：
// 任意方法返回 vi.fn()，measureText 特判返回 {width}，ctx.canvas 提供宽高。
interface MockCtx {
  canvas: { width: number; height: number };
  measureText: () => { width: number };
  clearRect: Mock;
  fillRect: Mock;
  fillText: Mock;
  /** strokeStyle 赋值历史（取色口径断言用；restore() 是 no-op，故终值 ≈ 最后一次赋值） */
  _strokes: string[];
  /** fillStyle 赋值历史 */
  _fills: string[];
}

function makeMockCtx(w = 180, h = 180): MockCtx {
  const target: Record<string, unknown> = {
    canvas: { width: w, height: h },
    _strokes: [] as string[],
    _fills: [] as string[],
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "measureText") return () => ({ width: 20 });
      if (typeof prop !== "string") return undefined;
      if (prop in t) return t[prop];
      t[prop] = vi.fn();
      return t[prop];
    },
    set(t, prop, value) {
      if (typeof prop !== "string") return true;
      if (prop === "strokeStyle") (t._strokes as string[]).push(String(value));
      if (prop === "fillStyle") (t._fills as string[]).push(String(value));
      t[prop] = value;
      return true;
    },
  }) as unknown as MockCtx;
}

function makeMockCanvas(w = 180, h = 180) {
  const ctx = makeMockCtx(w, h);
  const listeners = new Map<string, Array<{ fn: Function; signal?: AbortSignal }>>();
  const removeEventListener = vi.fn((event: string, fn: Function) => {
    const arr = listeners.get(event);
    if (arr) {
      const idx = arr.findIndex((e) => e.fn === fn);
      if (idx !== -1) arr.splice(idx, 1);
    }
  });
  const addEventListener = vi.fn(
    (event: string, fn: Function, options?: { signal?: AbortSignal }) => {
      if (!listeners.has(event)) listeners.set(event, []);
      const entry: { fn: Function; signal?: AbortSignal } = { fn };
      if (options?.signal) entry.signal = options.signal;
      listeners.get(event)!.push(entry);
      if (options?.signal) {
        options.signal.addEventListener(
          "abort",
          () => {
            const arr = listeners.get(event);
            if (arr) {
              const idx = arr.indexOf(entry);
              if (idx !== -1) {
                arr.splice(idx, 1);
                removeEventListener(event, fn);
              }
            }
          },
          { once: true },
        );
      }
    },
  );
  return {
    width: w,
    height: h,
    getContext: () => ctx,
    addEventListener,
    removeEventListener,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    _ctx: ctx,
  };
}

describe("renderModel2D 冒烟（canvas 2D mock）", () => {
  const SIMPLE_MODEL = {
    bones: [{ name: "body", cubes: [{ origin: [0, 0, 0], size: [4, 8, 4] }] }],
  };

  it("空 canvas 或空模型 → 提前返回不抛错、不绘制", () => {
    expect(() =>
      renderModel2D(null as unknown as HTMLCanvasElement, SIMPLE_MODEL, null),
    ).not.toThrow();
    const canvas = makeMockCanvas();
    expect(() =>
      renderModel2D(canvas as unknown as HTMLCanvasElement, { bones: [] }, null),
    ).not.toThrow();
    expect(() =>
      renderModel2D(canvas as unknown as HTMLCanvasElement, {}, null),
    ).not.toThrow();
    expect(canvas._ctx.clearRect).not.toHaveBeenCalled();
  });

  it("静态模型渲染 → clearRect/fillRect 被调用 + 绑定鼠标监听", () => {
    const canvas = makeMockCanvas();
    renderModel2D(canvas as unknown as HTMLCanvasElement, SIMPLE_MODEL, null, {});
    expect(canvas._ctx.clearRect).toHaveBeenCalled();
    expect(canvas._ctx.fillRect).toHaveBeenCalled();
    expect(canvas.addEventListener).toHaveBeenCalledWith("pointermove", expect.any(Function), {
      signal: expect.any(AbortSignal),
    });
    expect(canvas.addEventListener).toHaveBeenCalledWith("pointerleave", expect.any(Function), {
      signal: expect.any(AbortSignal),
    });
  });

  it("showLabels 默认开启 → fillText 绘制骨骼名", () => {
    const canvas = makeMockCanvas();
    renderModel2D(canvas as unknown as HTMLCanvasElement, SIMPLE_MODEL, null, {});
    expect(canvas._ctx.fillText).toHaveBeenCalled();
  });

  it("showLabels=false → 不绘制标签", () => {
    const canvas = makeMockCanvas();
    renderModel2D(canvas as unknown as HTMLCanvasElement, SIMPLE_MODEL, null, { showLabels: false });
    expect(canvas._ctx.fillText).not.toHaveBeenCalled();
  });

  it("动画骨骼（boneTransforms）渲染不抛错", () => {
    const canvas = makeMockCanvas();
    const transforms = new Map<string, BoneTransform>([
      ["body", { position: [0, 1, 0] as Vec3, rotation: [0, 0, 30] as Vec3 }],
    ]);
    expect(() =>
      renderModel2D(canvas as unknown as HTMLCanvasElement, SIMPLE_MODEL, null, {
        boneTransforms: transforms,
      }),
    ).not.toThrow();
    expect(canvas._ctx.fillRect).toHaveBeenCalled();
  });

  it("带 rotation 的头部 cube 渲染不抛错", () => {
    const canvas = makeMockCanvas();
    const model = {
      bones: [
        { name: "head", cubes: [{ origin: [0, 24, 0], size: [4, 4, 4], rotation: [0, 45, 0] }] },
      ],
    };
    expect(() =>
      renderModel2D(canvas as unknown as HTMLCanvasElement, model, null, {}),
    ).not.toThrow();
  });

  it("调用返回的清理函数可移除旧监听（AbortController 模式）", () => {
    const canvas = makeMockCanvas();
    const cleanup = renderModel2D(canvas as unknown as HTMLCanvasElement, SIMPLE_MODEL, null, {});
    expect(canvas.removeEventListener).not.toHaveBeenCalled();
    cleanup();
    expect(canvas.removeEventListener).toHaveBeenCalledWith("pointermove", expect.any(Function));
    expect(canvas.removeEventListener).toHaveBeenCalledWith("pointerleave", expect.any(Function));
  });

  it("pointermove 触发重绘（命中或离开均重绘一次）", () => {
    const canvas = makeMockCanvas();
    renderModel2D(canvas as unknown as HTMLCanvasElement, SIMPLE_MODEL, null, {});
    // vitest 4 类型更严：find 可能返回 undefined，非空断言（renderModel2D 必注册 pointermove）
    const onMove = canvas.addEventListener.mock.calls.find((c) => c[0] === "pointermove")![1];
    const before = canvas._ctx.clearRect.mock.calls.length;
    onMove({ clientX: 90, clientY: 90 });
    expect(canvas._ctx.clearRect.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("collectBoneBounds 包围盒计算", () => {
  const opts = (applyCubeRot: boolean) => ({
    cosA: 1,
    sinA: 0,
    isFront: true,
    boneTransforms: null,
    applyCubeRot,
  });

  it("无旋转时包围盒等于 aabb（px=x, py=y）", () => {
    const model = cubeModel("bone", SIMPLE_CUBE);
    expect(collectBoneBounds(model, opts(true)).get("bone")).toEqual({
      mnX: 0,
      mxX: 2,
      mnY: 0,
      mxY: 4,
    });
  });

  it("cube 级旋转使包围盒跟随（applyCubeRot=true ≠ false）", () => {
    const rotCube = { origin: [0, 0, 0], size: [2, 4, 6], rotation: [0, 0, 90] } as BedrockCube;
    const model = cubeModel("bone", rotCube);
    const withRot = collectBoneBounds(model, opts(true)).get("bone")!;
    const noRot = collectBoneBounds(model, opts(false)).get("bone")!;
    expect(withRot).not.toEqual(noRot);
    expect(withRot.mxX - withRot.mnX).toBeCloseTo(4, 5); // 旋转 90° 后宽度=原高度
    expect(withRot.mxY - withRot.mnY).toBeCloseTo(2, 5); // 高度=原宽度
  });

  it("applyCubeRot=false 时回退为未旋转包围盒", () => {
    const rotCube = { origin: [0, 0, 0], size: [2, 4, 6], rotation: [0, 0, 90] } as BedrockCube;
    const model = cubeModel("bone", rotCube);
    expect(collectBoneBounds(model, opts(false)).get("bone")).toEqual({
      mnX: 0,
      mxX: 2,
      mnY: 0,
      mxY: 4,
    });
  });
});

// ── 骨架线取色口径（canvas 2D 不消费 CSS 变量，故经 getComputedStyle 实时读取主题值）──
// 回归背景：曾硬编码 rgba(205,214,244,·) 作描边、金黄 #ffd460 作高亮，画布底为
// 「主题 --bg + 12% 黑罩」——亮色主题（warm/sakura/mint）下两者对比度 ≈1.06:1 / ≈1.15:1，
// 骨骼线几乎不可见（只剩色块没有线）。现口径：描边走 --txt（暗色主题浅、亮色主题深），
// 填充/高亮走 --accent（variables.css 规范保证对 --bg ≥4.5:1）。
describe("骨架线取色走主题变量（跨六主题可见性）", () => {
  const MODEL = { bones: [{ name: "body", cubes: [{ origin: [0, 0, 0], size: [4, 8, 4] }] }] };

  /** 注入主题变量表：node 环境无 document/getComputedStyle，themeRgba 的实时读取依赖二者 */
  function withTheme(vars: Record<string, string>, fn: () => void): void {
    const g = globalThis as unknown as Record<string, unknown>;
    const hadDoc = "document" in g;
    const prevDoc = g.document;
    const hadGcs = "getComputedStyle" in g;
    const prevGcs = g.getComputedStyle;
    g.document = { documentElement: {} };
    g.getComputedStyle = () => ({ getPropertyValue: (n: string) => vars[n] ?? "" });
    try {
      fn();
    } finally {
      if (hadDoc) g.document = prevDoc;
      else delete g.document;
      if (hadGcs) g.getComputedStyle = prevGcs;
      else delete g.getComputedStyle;
    }
  }

  /** 渲染一份并返回取色历史（showLabels=false 避免标签色混入断言集合） */
  function renderWith(vars: Record<string, string>): MockCtx {
    const canvas = makeMockCanvas();
    withTheme(vars, () => {
      renderModel2D(canvas as unknown as HTMLCanvasElement, MODEL, null, { showLabels: false });
    });
    return canvas._ctx;
  }

  const DARK = { "--accent": "#9575cd", "--txt": "#e0d5f5", "--bg": "#11111b" };
  const LIGHT = { "--accent": "#8b4513", "--txt": "#3e2723", "--bg": "#f5f0e1" };

  it("主视图描边取自 --txt（暗色主题浅线 / 亮色主题深线）", () => {
    expect(renderWith(DARK)._strokes).toContain("rgba(224,213,245,0.8)");
    expect(renderWith(LIGHT)._strokes).toContain("rgba(62,39,35,0.8)");
  });

  it("cube 填充取自 --accent", () => {
    expect(renderWith(DARK)._fills).toContain("rgba(149,117,205,0.45)");
    expect(renderWith(LIGHT)._fills).toContain("rgba(139,69,19,0.45)");
  });

  it("取色随主题切换变化（硬编码时代两主题取色集合相同）", () => {
    expect(renderWith(DARK)._strokes).not.toEqual(renderWith(LIGHT)._strokes);
  });

  it("不再出现硬编码浅色描边（205,214,244）", () => {
    for (const vars of [DARK, LIGHT]) {
      const ctx = renderWith(vars);
      expect(ctx._strokes.join("|")).not.toContain("205,214,244");
      expect(ctx._fills.join("|")).not.toContain("205,214,244");
    }
  });

  it("非 hex 主题值（color-mix/空）→ 回退默认色，不抛错", () => {
    const ctx = renderWith({
      "--accent": "color-mix(in srgb, #fff 10%, transparent)",
      "--txt": "",
      "--bg": "",
    });
    expect(ctx._strokes).toContain("rgba(224,213,245,0.8)"); // --txt 回退默认
    expect(ctx._fills).toContain("rgba(124,131,255,0.45)"); // --accent 回退默认
  });

  it("无 DOM（themeRgba 实时读取抛错）→ 静默回退，不中断渲染", () => {
    const canvas = makeMockCanvas();
    expect(() =>
      renderModel2D(canvas as unknown as HTMLCanvasElement, MODEL, null, { showLabels: false }),
    ).not.toThrow();
    expect(canvas._ctx._strokes).toContain("rgba(224,213,245,0.8)");
  });
});

