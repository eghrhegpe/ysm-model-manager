// ===== SSRPass 上游泄漏补丁：dispose 必须释放 ssrMaterial（2026-10-11）=====
//
// 实证（读 `three/examples/jsm/postprocessing/SSRPass.js` 的 `dispose()`）：
// 官方实现释放 7 个 render target（beauty/prev/normal/metalness/ssr/blur/blur2）
// + 7 个材质（normalMaterial / metalnessOn/OffMaterial / blurMaterial /
// blurMaterial2 / copyMaterial / depthRenderMaterial）+ fsQuad，
// **但 `this.ssrMaterial` 缺位**——它是主 ShaderMaterial，持 `tDiffuse` / `tNormal` /
// `tMetalness` / `tDepth` 四张纹理引用与全部 defines/uniforms（`SSRPass.js:354-375`）。
//
// 后果：每次 SSRPass 实例销毁都漏一个 ShaderMaterial 及其 GPU program。
// 本仓既有规避 = 「切档不重建 composer」（`syncReflectionMode` 只调档位，
// `applySSRModeToPass`），从根上避免**累积**——但**单次实例**的 ssrMaterial 仍永不释放，
// 直至整个 composer 被拆（且拆时同样漏）。
//
// 本文件钉死补丁行为：`disposeComposer()` 必须显式释放 ssrMaterial。
// 反向保护：删掉补丁行 → 本测试红。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function makeFakeRenderer() {
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

/** 建一个启用了 SSR 的 cap（reflectionMode != envmap-only ⇒ composer 内含 SSRPass） */
function makeSsrCap() {
  setEnvState({ ppReflectionMode: "envmap+ssr" }, { source: "manual" });
  const cap = new PostprocessingCapability({
    scene: new THREE.Scene(),
    renderer: makeFakeRenderer(),
    camera: new THREE.PerspectiveCamera(50, 1, 0.1, 100),
  });
  cap.setEnabled(true); // 惰性构建 composer（含 SSRPass）
  return cap;
}

/** 白盒取 composer 叶实例（TS private 运行时即普通属性，同仓既有探针范式） */
function composerOf(cap: PostprocessingCapability) {
  return cap["composerHost"] as unknown as {
    ssrPass: { ssrMaterial: THREE.ShaderMaterial; dispose(): void } | null;
    disposeComposer(): void;
  };
}

describe("SSRPass.dispose 上游泄漏补丁（ssrMaterial 显式释放）", () => {
  it("前置事实：上游 SSRPass.dispose 确实漏释放 ssrMaterial（补丁的立论基础）", async () => {
    // 直接构造官方 SSRPass，调其 dispose，断言 ssrMaterial.dispose **未被调用**。
    // 这条若不成立（上游已修），补丁与本节可整体撤除。
    const { SSRPass } = await import("three/addons/postprocessing/SSRPass.js");
    const pass = new SSRPass({
      renderer: makeFakeRenderer(),
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(50, 1, 0.1, 100),
      width: 64,
      height: 64,
      selects: null,
      groundReflector: null,
      isBouncing: false,
    } as never);

    const spy = vi.spyOn(pass.ssrMaterial, "dispose");
    pass.dispose();
    expect(
      spy,
      "上游若已修此漏，应改为 toHaveBeenCalled 并撤除本仓补丁（见文件头注释）",
    ).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("补丁生效：disposeComposer 显式释放 ssrMaterial", () => {
    const cap = makeSsrCap();
    const host = composerOf(cap);
    expect(host.ssrPass, "前置：SSR 档位下 composer 应含 ssrPass").not.toBeNull();

    const spy = vi.spyOn(host.ssrPass!.ssrMaterial, "dispose");
    host.disposeComposer();

    expect(
      spy,
      "补丁须补上游缺的 ssrMaterial.dispose（否则每次拆链漏一个 ShaderMaterial + program）",
    ).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("幂等：disposeComposer 连续调用两次不抛错（ssrPass 已置 null 即跳过）", () => {
    const cap = makeSsrCap();
    const host = composerOf(cap);
    host.disposeComposer();
    expect(() => host.disposeComposer(), "二次 dispose 必须安全（null 守卫）").not.toThrow();
  });

  it("cap.dispose 全链走通：ssrMaterial 被释放且不抛错", () => {
    const cap = makeSsrCap();
    const host = composerOf(cap);
    const spy = vi.spyOn(host.ssrPass!.ssrMaterial, "dispose");
    expect(() => cap.dispose()).not.toThrow();
    expect(spy, "cap.dispose → disposeComposer → 补丁释放 ssrMaterial").toHaveBeenCalled();
    spy.mockRestore();
  });
});
