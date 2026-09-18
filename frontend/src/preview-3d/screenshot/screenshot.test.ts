// screenshotFromRenderer 单测——该纯函数此前**无任何直接覆盖**（既有 screenshot-render.test.ts
// 只测 renderMultiAngle）。本文件锁定两条状态还原契约：
//   ① 透明背景：渲染期须把 scene.background 置 null。three 在 WebGLBackground.js:55-58 对
//      `background.isColor` 会 `setClear(background, 1)`（alpha 硬编码 1）并 forceClear，
//      **覆盖**本函数设的 setClearColor(0x000000, 0) → 不置 null 则透明永远失效。
//   ② 尺寸复位：共享 renderer 被 opts.width 改尺寸后必须还原，否则后续预览帧停在截图尺寸。
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { screenshotFromRenderer } from "./screenshot.ts";

/** 最小 fake renderer：只覆盖 screenshotFromRenderer 触碰到的面 */
function makeFakeRenderer() {
  const domElement = {
    width: 512,
    height: 512,
    toDataURL: vi.fn(() => "data:image/png;base64,QUJD"),
  } as unknown as HTMLCanvasElement;
  return {
    domElement,
    render: vi.fn(),
    setSize: vi.fn(),
    getSize: (v: THREE.Vector2) => {
      v.x = 512;
      v.y = 512;
      return v;
    },
    getClearColor: (c: THREE.Color) => c,
    getClearAlpha: () => 1,
    setClearColor: vi.fn(),
  };
}

function makeArgs() {
  const raw = makeFakeRenderer();
  return {
    raw,
    renderer: raw as unknown as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(50, 1, 0.1, 100),
  };
}

describe("screenshotFromRenderer — 空值/未就绪守卫", () => {
  it("缺 renderer / scene / camera → null", () => {
    const { renderer, scene, camera } = makeArgs();
    expect(screenshotFromRenderer(null, scene, camera)).toBeNull();
    expect(screenshotFromRenderer(renderer, null, camera)).toBeNull();
    expect(screenshotFromRenderer(renderer, scene, null)).toBeNull();
  });

  it("canvas 尺寸为 0（未就绪）→ null", () => {
    const { raw, renderer, scene, camera } = makeArgs();
    (raw.domElement as unknown as { width: number }).width = 0;
    expect(screenshotFromRenderer(renderer, scene, camera)).toBeNull();
  });

  it("正常路径 → 返回无 data: 前缀的 base64", () => {
    const { renderer, scene, camera } = makeArgs();
    expect(screenshotFromRenderer(renderer, scene, camera)).toBe("QUJD");
  });
});

describe("screenshotFromRenderer — 透明背景契约（P1）", () => {
  it("渲染期 scene.background 须为 null，读后还原为同一对象", () => {
    const { raw, renderer, scene, camera } = makeArgs();
    const bg = new THREE.Color("#171820");
    scene.background = bg;
    let during: unknown = "unset";
    raw.render.mockImplementation(() => {
      during = scene.background;
    });
    expect(screenshotFromRenderer(renderer, scene, camera)).toBe("QUJD");
    expect(during).toBeNull();
    // 还原必须是同一引用（预览观感不变）
    expect(scene.background).toBe(bg);
  });

  it("scene.background 原本为 null 时不报错", () => {
    const { renderer, scene, camera } = makeArgs();
    expect(scene.background).toBeNull();
    expect(screenshotFromRenderer(renderer, scene, camera)).toBe("QUJD");
    expect(scene.background).toBeNull();
  });

  it("渲染抛错时 scene.background 同样还原（finally 语义）", () => {
    const { raw, renderer, scene, camera } = makeArgs();
    const bg = new THREE.Color("#171820");
    scene.background = bg;
    raw.render.mockImplementation(() => {
      throw new Error("gl boom");
    });
    expect(screenshotFromRenderer(renderer, scene, camera)).toBeNull();
    expect(scene.background).toBe(bg);
  });

  it("透明捕获：setClearColor(0,0) 后还原原清屏色", () => {
    const { raw, renderer, scene, camera } = makeArgs();
    screenshotFromRenderer(renderer, scene, camera);
    expect(raw.setClearColor).toHaveBeenNthCalledWith(1, 0x000000, 0);
    expect(raw.setClearColor).toHaveBeenNthCalledWith(2, expect.anything(), 1);
  });
});

describe("screenshotFromRenderer — 尺寸复位契约（P2）", () => {
  it("opts.width 触发 setSize 后须复位到原尺寸", () => {
    const { raw, renderer, scene, camera } = makeArgs();
    expect(screenshotFromRenderer(renderer, scene, camera, { width: 128, height: 128 })).toBe("QUJD");
    expect(raw.setSize).toHaveBeenNthCalledWith(1, 128, 128, false);
    // 不复位 → 共享 renderer 的后续预览帧停在 128×128
    expect(raw.setSize).toHaveBeenNthCalledWith(2, 512, 512, false);
  });

  it("尺寸相同 → 不 setSize（不做无谓 GL 状态刷新）", () => {
    const { raw, renderer, scene, camera } = makeArgs();
    screenshotFromRenderer(renderer, scene, camera, { width: 512 });
    expect(raw.setSize).not.toHaveBeenCalled();
  });

  it("render 抛错时也必须复位（不留污染）", () => {
    const { raw, renderer, scene, camera } = makeArgs();
    raw.render.mockImplementation(() => {
      throw new Error("gl boom");
    });
    expect(
      screenshotFromRenderer(renderer, scene, camera, { width: 128, height: 128 }),
    ).toBeNull();
    expect(raw.setSize).toHaveBeenLastCalledWith(512, 512, false);
  });
});
