// ===== env-ibl.ts 守卫（ADR-091-d1 拆分叶 + ADR-311-d1 判别样本）=====
// 病根锁：IBL 资产管线（PMREM 预滤波/三通路取图/背景槽/dispose 顺序收敛）下沉 EnvIbl，
// 此前仅经 environment-capability.test.ts 白盒探针（iblOf）间接覆盖，叶层零直测。
// 本测试把三条关键分支**叶层双侧**钉死（判别样本）：
//   · applyBackground(null) 显式回退（enabled/useAsBackground=false → 还原 prevBackground）
//   · envSource="sky" 取图失败 → 回落预设（不黑场景）
//   · PMREM 生成失败 → 回滚还原 prevEnvironment + 清背景
// 正当依赖隔离（非自证）：mock three 的 WebGLRenderer/PMREMGenerator（真实现需 WebGL）、
// drawEnvEquirect/luminanceHistogram（像素运算，env-pixels 独立单测）、getTypedCap/ringLog（重依赖）；
// 断言目标始终是 EnvIbl 自身导出。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as THREE from "three";
import { resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { EnvHdrCache } from "./env-hdr-cache.ts";
import { EnvIbl, type EnvIblHost } from "./env-ibl.ts";

const h = vi.hoisted(() => ({
  logMock: vi.fn(),
  drawMock: vi.fn(),
  lumMock: vi.fn(() => new Array<number>(16).fill(0)),
  getTypedCapMock: vi.fn(),
  /** 置 true 令 FakePMREMGenerator.fromEquirectangular 抛错（PMREM 失败回滚探针） */
  pmremFail: false,
  /** 置 true 令 FakePMREMGenerator 的 rt.texture 用预置 sentinel（判别「新 PMREM 产物 vs 旧槽位」） */
  pmremCalls: 0,
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakeWebGLRenderer {
    domElement = document.createElement("div");
    setSize(): void {}
    setPixelRatio(): void {}
    render(): void {}
    dispose(): void {}
    getContext(): null {
      return null;
    }
  }
  class FakePMREMGenerator {
    compileEquirectangularShader(): void {}
    fromEquirectangular(): { texture: THREE.Texture; dispose: () => void } {
      h.pmremCalls += 1;
      if (h.pmremFail) throw new Error("pmrem boom");
      // 保真：真 PMREM 产物是 cubeUV 图集（mapping=CubeUVReflectionMapping）——
      // 不设则「preset 走 PMREM 而非 D-3 直装 sky」的 mapping 判别断言失真
      const tex = new actual.Texture();
      tex.mapping = actual.CubeUVReflectionMapping;
      return { texture: tex, dispose: () => {} };
    }
    fromScene(): { texture: THREE.Texture; dispose: () => void } {
      return { texture: new actual.Texture(), dispose: () => {} };
    }
    dispose(): void {}
  }
  return {
    ...actual,
    WebGLRenderer: FakeWebGLRenderer as unknown as typeof actual.WebGLRenderer,
    PMREMGenerator: FakePMREMGenerator as unknown as typeof actual.PMREMGenerator,
  };
});

vi.mock("./env-pixels.ts", () => ({
  drawEnvEquirect: h.drawMock,
  luminanceHistogram: h.lumMock,
}));
vi.mock("./scene-capability.ts", () => ({
  getTypedCap: h.getTypedCapMock,
  ringLog: h.logMock,
}));

/** 构造 EnvIbl + 可注入的 scene 哨兵（prevEnvironment 捕获基线） */
function makeHost(opts: { caps?: unknown; sentinel?: THREE.Texture | null } = {}): {
  ibl: EnvIbl;
  scene: THREE.Scene;
  hdr: EnvHdrCache;
  sentinel: THREE.Texture | null;
} {
  const scene = new THREE.Scene();
  const sentinel = opts.sentinel === undefined ? new THREE.Texture() : opts.sentinel;
  scene.environment = sentinel;
  const hdr = new EnvHdrCache();
  const host: EnvIblHost = {
    scene,
    renderer: new THREE.WebGLRenderer(),
    hdr,
  };
  if (opts.caps !== undefined) host.caps = opts.caps as EnvIblHost["caps"];
  return { ibl: new EnvIbl(host), scene, hdr, sentinel };
}

function makeSkyCap(impl: { tex?: THREE.Texture | null; throws?: boolean }): unknown {
  return {
    // 透传 force 参数由 sky 真实现消费；本桩不依赖阈值门控，故不声明形参
    bakeEnvironmentTexture: () => {
      if (impl.throws) throw new Error("sky bake boom");
      if (impl.tex) return impl.tex;
      return null;
    },
  };
}

beforeEach(() => {
  resetEnvState();
  h.logMock.mockReset();
  h.drawMock.mockReset();
  h.lumMock.mockReset();
  h.getTypedCapMock.mockReset();
  h.getTypedCapMock.mockReturnValue(undefined);
  h.pmremFail = false;
  h.pmremCalls = 0;
});

afterEach(() => {
  resetEnvState();
  h.logMock.mockRestore();
});

describe("EnvIbl preset 通路（基线）", () => {
  it("envSource=preset：build 把 PMREM 产物挂到 scene.environment（非旧槽位、非 null）", () => {
    const { ibl, scene, sentinel } = makeHost();
    setEnvState({ envEnabled: true, envSource: "preset" }, { source: "manual", force: true });
    ibl.build();

    expect(h.pmremCalls, "预设走 PMREM 预滤波一次").toBe(1);
    expect(scene.environment).not.toBeNull();
    expect(scene.environment, "槽位换新，非哨兵").not.toBe(sentinel);
    expect(
      (scene.environment as THREE.Texture).mapping,
      "预设走 PMREM → cubeUV 图集（D-3 直装 sky 才跳过重烤）",
    ).toBe(THREE.CubeUVReflectionMapping);
  });
});

describe("applyBackground(null) 显式回退（ADR-311-d1 判别样本：判真侧）", () => {
  it("useAsBackground=false：背景槽还原 prevBackground（不挂新图）", () => {
    const prevBg = new THREE.Color(0x224466);
    const scene = new THREE.Scene();
    scene.background = prevBg;
    const hdr = new EnvHdrCache();
    const ibl = new EnvIbl({ scene, renderer: new THREE.WebGLRenderer(), hdr });
    setEnvState(
      { envEnabled: true, envSource: "preset", envUseAsBackground: false },
      { source: "manual", force: true },
    );

    ibl.build();

    expect(scene.background, "不回退即挂新背景，错").toBe(prevBg);
  });

  it("enabled=false：环境关闭 → 背景还原 prevBackground + environment 还原 prevEnvironment", () => {
    const prevBg = new THREE.Color(0x112233);
    // 背景哨兵须在**构造前**设——EnvIbl 构造即捕获 prevBackground，晚设则 prevBackground=null、还原即 null
    const scene = new THREE.Scene();
    scene.background = prevBg;
    const sentinel = new THREE.Texture();
    scene.environment = sentinel;
    const ibl = new EnvIbl({ scene, renderer: new THREE.WebGLRenderer(), hdr: new EnvHdrCache() });
    setEnvState(
      { envEnabled: false, envSource: "preset", envUseAsBackground: true },
      { source: "manual", force: true },
    );

    ibl.build();

    expect(scene.environment, "关闭即还原 prevEnvironment").toBe(sentinel);
    expect(scene.background).toBe(prevBg);
  });
});

describe("envSource=sky 取图失败回落预设（ADR-311-d1 判别样本：不黑场景）", () => {
  it("sky 无 bakeEnvironmentTexture（缺查询器）→ 回落预设 PMREM，不黑场景", () => {
    h.getTypedCapMock.mockReturnValue(undefined); // 无 sky cap
    const { ibl, scene, sentinel } = makeHost();
    setEnvState({ envEnabled: true, envSource: "sky" }, { source: "manual", force: true });

    ibl.build();

    expect(scene.environment, "缺 sky 查询器不得黑场景").not.toBeNull();
    expect(scene.environment, "回落的是本管线 PMREM 产物，非哨兵").not.toBe(sentinel);
  });

  it("sky.bakeEnvironmentTexture 返回 null → 回落预设 PMREM", () => {
    h.getTypedCapMock.mockReturnValue(makeSkyCap({ tex: null }));
    const { ibl, scene } = makeHost();
    setEnvState({ envEnabled: true, envSource: "sky" }, { source: "manual", force: true });

    ibl.build();

    expect(scene.environment).not.toBeNull();
  });

  it("sky.bakeEnvironmentTexture 抛错 → 记 warn + 回落预设", () => {
    h.getTypedCapMock.mockReturnValue(makeSkyCap({ throws: true }));
    const { ibl, scene } = makeHost();
    setEnvState({ envEnabled: true, envSource: "sky" }, { source: "manual", force: true });

    ibl.build();

    expect(scene.environment, "烘焙失败仍不黑场景").not.toBeNull();
    expect(h.logMock).toHaveBeenCalledWith(
      "env",
      expect.stringContaining("取天空烘焙纹理失败"),
      "warn",
    );
  });

  it("sky 取图成功（D-3 直装）：scene.environment 直装 sky 纹理（env 仍是槽位唯一写者）", () => {
    const skyTex = new THREE.Texture();
    h.getTypedCapMock.mockReturnValue(makeSkyCap({ tex: skyTex }));
    const { ibl, scene } = makeHost();
    setEnvState({ envEnabled: true, envSource: "sky" }, { source: "manual", force: true });

    ibl.build();

    expect(scene.environment, "D-3 直装：sky 产物已是 cubeUV 图集，不再二次滤波").toBe(skyTex);
    expect(h.pmremCalls, "直装不重烤").toBe(0);
  });
});

describe("PMREM 生成失败回滚（ADR-311-d1 判别样本：失败不悬空）", () => {
  // ⚠️ 变异实证（2026-10-09 主模型亲自变异）：仅移除 pmremToSceneEnv catch 里的
  // `scene.environment = this.prevEnvironment`，本用例**仍绿**——因 `fromEquirectangular`
  // 抛错发生在 `envTexture` 赋值之前，`scene.environment` 本未被改写，catch 那行还原是
  // **防御性冗余**（与 build 的 enabled=false 分支 / dispose 同构的对齐防御）。
  // 本用例实际断言的是可观察保证：失败后槽位不悬空 + 背景清空 + 记 error。
  // 判别力锚在下方 dispose 用例（变异移 dispose 还原 → 转红，已实证）。
  it("fromEquirectangular 抛错 → 还原 prevEnvironment + 清背景", () => {
    const { ibl, scene, sentinel } = makeHost();
    setEnvState({ envEnabled: true, envSource: "preset" }, { source: "manual", force: true });
    h.pmremFail = true;

    ibl.build();

    expect(scene.environment, "失败回滚到构造时 prevEnvironment").toBe(sentinel);
    expect(h.logMock).toHaveBeenCalledWith("env", expect.stringContaining("PMREM 生成失败"), "error");
    // 失败后 applyBackground(null)：背景不应挂任何 PMREM 源图
    expect(scene.background).toBeNull();
  });
});

describe("EnvIbl.dispose 两槽位还原 + 释放", () => {
  it("dispose：还原 environment 到 prevEnvironment（envOwnsSceneEnvironment 收敛）", () => {
    const { ibl, scene, sentinel } = makeHost();
    setEnvState({ envEnabled: true, envSource: "preset" }, { source: "manual", force: true });
    ibl.build();
    expect(scene.environment).not.toBe(sentinel);

    ibl.dispose();

    expect(scene.environment, "dispose 还原到构造时 prevEnvironment").toBe(sentinel);
  });

  it("dispose 幂等：二次 dispose 不抛错", () => {
    const { ibl } = makeHost();
    setEnvState({ envEnabled: true, envSource: "preset" }, { source: "manual", force: true });
    ibl.build();
    ibl.dispose();
    expect(() => ibl.dispose()).not.toThrow();
  });

  it("getLuminanceHistogram 委托 luminanceHistogram（16 bin）", () => {
    const { ibl } = makeHost();
    expect(ibl.getLuminanceHistogram()).toHaveLength(16);
    expect(h.lumMock).toHaveBeenCalled();
  });
});