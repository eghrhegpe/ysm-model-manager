// ===== 后处理「空转」短路：启用但无任何子效果时直渲，跳过 composer 离屏往返（2026-10-12）=====
//
// 病症（ADR-299 已修一半，本文件收另一半）：
// ADR-299 修的是「**未启用**却每帧付管线过路费」——`ppEnabled=false` 时 `composer.render`
// 恒返回 true，使 render-host 的直渲兜底成死代码。实测常驻税 1.05ms/帧（+53.7%）。
//
// 但**启用后无任何子效果**这一态仍在白付：
//   `ppEnabled=true` + bloom/ssao/ssr 三者全关时，`EffectComposer.render` 仍会跑
//   `RenderPass`（整场渲进**离屏 HalfFloat RT**）+ `OutputPass`（全屏 quad 再拷回画布）
//   ——两趟全屏工作量，换来的是**与直渲完全相同的画面**。
//
// 为什么「完全相同」（本短路的正确性根据，非猜测）：
//   ① `OutputPass` 不产生新效果——它读 `renderer.toneMapping` / `outputColorSpace`
//      （`OutputPass.js:97-114`）把同一变换烘进自己的 shader，属**重复** renderer 自身
//      在 `renderer.render()` 里已做的 toneMapping + 色彩空间转换；
//   ② 故 `ppToneMapping`/色彩空间**不依赖 composer**：`applyToneMapping` 直接写
//      `renderer.toneMapping`/`renderer.outputColorSpace`（见本 cap 同名方法），
//      renderer 自渲即生效。
//   ⇒ 三者全关时直渲与走 composer **逐像素等价**，短路不改变任何可见结果。
//
// 反向保护：删掉短路（恒走 composer）→ 「直渲被调用」断言红。
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
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

function makeRenderer() {
  return {
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
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

function makeCap() {
  const cap = new PostprocessingCapability({
    scene: new THREE.Scene(),
    renderer: makeRenderer(),
    camera: new THREE.PerspectiveCamera(50, 1, 0.1, 100),
  });
  return cap;
}

/** 白盒取 composer 叶（TS private 运行时即普通属性，同仓既有探针范式） */
function composerOf(cap: PostprocessingCapability) {
  return cap["composerHost"] as unknown as {
    isFullyIdle(): boolean;
    render(dt: number, lightCap: null): void;
    composer: { render: (dt: number) => void } | null;
  };
}

describe("后处理空转短路：启用但无子效果 → 不走 composer", () => {
  it("三者全关 ⇒ isFullyIdle 为真（判据只看启用的子效果维度）", () => {
    const cap = makeCap();
    setEnvState(
      { ppEnabled: true, ppBloomEnabled: false, ppSsaoEnabled: false, ppReflectionMode: "envmap-only" },
      { source: "manual" },
    );
    cap.setEnabled(true); // 建 composer
    expect(composerOf(cap).isFullyIdle(), "无任何启用的子效果 ⇒ 空转").toBe(true);
  });

  it("任一子效果开启 ⇒ isFullyIdle 为假（不得误判为可短路）", () => {
    const cap = makeCap();
    setEnvState({ ppEnabled: true, ppBloomEnabled: true }, { source: "manual" });
    cap.setEnabled(true);
    expect(composerOf(cap).isFullyIdle(), "bloom 开 ⇒ 非空转").toBe(false);

    setEnvState({ ppBloomEnabled: false, ppSsaoEnabled: true }, { source: "manual" });
    expect(composerOf(cap).isFullyIdle(), "ssao 开 ⇒ 非空转").toBe(false);

    setEnvState({ ppSsaoEnabled: false, ppReflectionMode: "envmap+ssr" }, { source: "manual" });
    expect(composerOf(cap).isFullyIdle(), "ssr 开 ⇒ 非空转").toBe(false);
  });

  it("空转时 composer.render 不被调用（省下离屏 RT + 全屏 quad 两趟）", () => {
    const cap = makeCap();
    setEnvState(
      { ppEnabled: true, ppBloomEnabled: false, ppSsaoEnabled: false, ppReflectionMode: "envmap-only" },
      { source: "manual" },
    );
    cap.setEnabled(true);
    const host = composerOf(cap);
    const spy = vi.spyOn(host.composer!, "render");

    // cap.render 判过 enabled 门 + hasComposer —— 空转须在此层短路回 false（交 render-host 直渲）
    const handled = cap.render(0.016, null);

    expect(handled, "空转 ⇒ 返回 false，交 render-host 直渲（toneMapping 由 renderer 自渲生效）").toBe(
      false,
    );
    expect(spy, "空转时不得调 composer.render").not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("非空转时 composer.render 确实被调用（短路不得误伤正常路径）", () => {
    const cap = makeCap();
    setEnvState({ ppEnabled: true, ppBloomEnabled: true }, { source: "manual" });
    cap.setEnabled(true);
    const host = composerOf(cap);
    // 真 composer.render 会逐 pass 触真 WebGL（happy-dom 无 GL）——本用例只验「是否被调」，
    // 故整体替换为 spy（不透传原始实现），避免测试依赖 GL 而假红。
    const spy = vi.fn();
    host.composer!.render = spy;

    const handled = cap.render(0.016, null);

    expect(handled, "有子效果 ⇒ 走 composer，返回 true").toBe(true);
    expect(spy, "非空转须真渲染").toHaveBeenCalledTimes(1);
  });

  it("三档反射模式判据：envmap-only 不算子效果，其余两档都算", () => {
    const cap = makeCap();
    cap.setEnabled(true);
    const host = composerOf(cap);

    setEnvState(
      { ppEnabled: true, ppBloomEnabled: false, ppSsaoEnabled: false, ppReflectionMode: "envmap-only" },
      { source: "manual" },
    );
    expect(host.isFullyIdle(), "envmap-only = 无 SSR").toBe(true);

    setEnvState({ ppReflectionMode: "ssr-only" }, { source: "manual" });
    expect(host.isFullyIdle(), "ssr-only ⇒ 非空转").toBe(false);
  });
});

// ===== SSR 反射缓冲缩放：档位值真的落到 pass 上（接线缝）=====
describe("SSR resolutionScale 接线（档位 → pass）", () => {
  it("建 SSR pass 时按档位设 resolutionScale（不是恒 1）", async () => {
    const { PERF_PRESET_KEY, __resetSsrScaleCacheForTest } = await import(
      "@/preview-3d/state/perf-presets.ts"
    );
    localStorage.setItem(PERF_PRESET_KEY, "low"); // 0.5
    __resetSsrScaleCacheForTest();
    try {
      const cap = makeCap();
      setEnvState({ ppEnabled: true, ppReflectionMode: "envmap+ssr" }, { source: "manual" });
      cap.setEnabled(true); // 建 composer（含 SSRPass）
      const host = cap["composerHost"] as unknown as {
        ssrPass: { resolutionScale: number } | null;
      };
      expect(host.ssrPass, "SSR 档位下应含 ssrPass").not.toBeNull();
      expect(
        host.ssrPass!.resolutionScale,
        "low 档 ⇒ 0.5（上游默认 1 = 全分辨率；本仓须显式设，否则该旋钮永不生效）",
      ).toBe(0.5);
    } finally {
      localStorage.clear();
      __resetSsrScaleCacheForTest();
    }
  });
});
