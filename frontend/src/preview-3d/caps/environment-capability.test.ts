// ===== EnvironmentCapability 测试（preview-3d/caps/environment-capability.ts）=====
// 覆盖：构造默认值、buildEnvironment 完整管线（mock canvas + Fake PMREM）、custom HDR 加载/清除/回退、
// 背景开关还原语义、缩略图与直方图数据分支、syncMeshIntensity、持久化守卫、告警去重、getMenuControls。
//
// 设计说明：
// - buildEnvironment 需要 canvas 2D（drawEnvEquirect）与 PMREMGenerator。happy-dom 无 2D 实现
//   （getContext("2d") 返回 null），故用 spyOn(document, "createElement") 提供 mock canvas；
//   PMREMGenerator 经 per-file vi.mock 扩展（compileEquirectangularShader / fromEquirectangular），
//   其余 three 导出取 actual。真实 WebGL 上传路径不在单测范围。
// - custom HDR 文件解码（RGBELoader.load → blob fetch）属 IO 集成路径，用 spy 标记
//   loadCustomHdrFromFile 成败来驱动 onPickCustomHdr 的两个分支。
// - ADR-196：参数量走全局 envState 单例。测试通过 setEnvState 预设环境参数，
//   beforeEach 调 resetEnvState() 防止跨测试泄漏；afterEach 调 clearEnvCallbacks() 防止 cap 泄漏。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  EnvironmentCapability,
  ENV_PRESETS,
  drawEnvEquirect,
  type EnvPreset,
  type EnvPresetId,
} from "./environment-capability.ts";
import { MODEL_DEFAULTS } from "../state/model-defaults.ts";
// ADR-196：统一状态层
import { resetEnvState, setEnvState } from "../state/env-state.ts";
import { clearEnvCallbacks } from "../state/env-dispatcher.ts";

// PMREMGenerator 扩展 mock：全局 setup 的 Fake 只有 fromScene，本文件需 fromEquirectangular
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakeWebGLRenderer {
    domElement = origCreateElement("div");
    setSize(): void {}
    setPixelRatio(): void {}
    render(): void {}
    dispose(): void {}
    getContext(): null { return null; }
  }
  class FakePMREMGenerator {
    compileEquirectangularShader(): void {}
    fromEquirectangular(): { texture: THREE.Texture; dispose: () => void } {
      return { texture: new actual.Texture(), dispose: () => {} };
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

// ---- mock canvas（happy-dom 无 2D 实现，getContext("2d") 返回 null）----
const origCreateElement = document.createElement.bind(document);

function makeMockCanvas(opts: { ctx?: Record<string, unknown> | null; dataUrl?: string } = {}): HTMLCanvasElement {
  const defaultCtx: Record<string, unknown> = {
    clearRect: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(16) }),
  };
  return {
    width: 0,
    height: 0,
    getContext: () => (opts.ctx === undefined ? defaultCtx : opts.ctx),
    toDataURL: () => opts.dataUrl ?? "data:image/png;base64,mock",
  } as unknown as HTMLCanvasElement;
}

let canvasSpy: ReturnType<typeof vi.spyOn> | null = null;
/** 拦截 document.createElement("canvas") 返回 mock；其他标签走原实现 */
function spyCanvas(opts: { ctx?: Record<string, unknown> | null; dataUrl?: string } = {}): void {
  canvasSpy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag === "canvas") return makeMockCanvas(opts);
    return origCreateElement(tag);
  }) as typeof document.createElement);
}
function unspyCanvas(): void {
  canvasSpy?.mockRestore();
  canvasSpy = null;
}

// ---- 假渲染器（PMREM 已 mock，仅需构造不报错）----
function makeFakeRenderer() {
  return {
    capabilities: { isWebGL2: true, maxTextures: 16 },
    properties: new Map(),
    info: { autoReset: true, memory: { textures: 0, geometries: 0 }, render: { calls: 0, triangles: 0, points: 0, frame: 0 }, reset: () => {} },
    domElement: { style: {}, tagName: "CANVAS" } as unknown as HTMLCanvasElement,
    getSize: () => ({ width: 512, height: 512 }),
    getPixelRatio: () => 1,
    getContext: () => null,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
  } as unknown as THREE.WebGLRenderer;
}

function newCap(opts: { enabled?: boolean } = {}) {
  const scene = new THREE.Scene();
  const renderer = makeFakeRenderer();
  return new EnvironmentCapability({
    scene,
    renderer,
    ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
  });
}

/** 造一个带 half-float RGB 数据的假 HDR DataTexture（image 结构 = { data, width, height }） */
function makeFakeHdrTexture(w = 4, h = 2, luminance = 0.5): THREE.DataTexture {
  const data = new Uint16Array(w * h * 3);
  const toHalf = (v: number): number => THREE.DataUtils.toHalfFloat(v);
  for (let i = 0; i < w * h; i++) {
    data[i * 3] = toHalf(luminance);
    data[i * 3 + 1] = toHalf(luminance);
    data[i * 3 + 2] = toHalf(luminance);
  }
  return new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
}

beforeEach(() => {
  resetEnvState(); // ADR-196：防止跨测试状态泄漏
  spyCanvas(); // 默认 mock canvas，所有 build 路径可用
});
afterEach(() => {
  unspyCanvas();
  clearEnvCallbacks(); // ADR-196：防止 cap 泄漏跨测试
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).__ysmRingLog;
});

describe("EnvironmentCapability — 构造与默认值", () => {
  it("构造默认值完整", () => {
    const cap = newCap();
    expect(cap.isEnabled()).toBe(true);
    expect(cap.getPresetId()).toBe("sky");
    expect(cap.getIntensity()).toBe(1.0);
    expect(cap.isUseAsBackground()).toBe(false);
    expect(cap.hasCustomHdr()).toBe(false);
    expect(cap.isCustomHdrLoading()).toBe(false);
    expect(cap.getCustomHdrName()).toBe("");
  });

  it("enabled:false 初始禁用", () => {
    const cap = newCap({ enabled: false });
    expect(cap.isEnabled()).toBe(false);
  });

  it("envState 覆盖生效", () => {
    setEnvState({ envPreset: "studio", envIntensity: 1.5, envUseAsBackground: true }, { source: "manual" });
    const cap = newCap();
    expect(cap.getPresetId()).toBe("studio");
    expect(cap.getIntensity()).toBe(1.5);
    expect(cap.isUseAsBackground()).toBe(true);
  });
});

describe("EnvironmentCapability — 预设切换", () => {
  it("setPresetId 切换预设（sky→studio→sunset）", () => {
    const cap = newCap();
    cap.setPresetId("studio");
    expect(cap.getPresetId()).toBe("studio");
    cap.setPresetId("sunset");
    expect(cap.getPresetId()).toBe("sunset");
    cap.setPresetId("night");
    expect(cap.getPresetId()).toBe("night");
  });

  it("setPresetId('custom') 无缓存时不切换（保持当前预设）", () => {
    const cap = newCap();
    const orig = cap.getPresetId();
    cap.setPresetId("custom");
    // 无 custom HDR 缓存 → 不切换
    expect(cap.getPresetId()).toBe(orig);
    expect(cap.hasCustomHdr()).toBe(false);
  });

  it("setPresetId('custom') 无缓存时走 __ysmRingLog 告警", () => {
    const log = vi.fn();
    (globalThis as Record<string, unknown>).__ysmRingLog = log;
    const cap = newCap();
    cap.setPresetId("custom");
    expect(log).toHaveBeenCalledWith("env", expect.stringContaining("自定义 HDR"), "warn");
  });

  it("setPresetId('custom') 有缓存时切换并复用 HDR 纹理（不 dispose）", () => {
    setEnvState({ envUseAsBackground: true }, { source: "manual" });
    const cap = newCap();
    const hdr = makeFakeHdrTexture();
    (cap as unknown as Record<string, unknown>).customHdrTex = hdr;
    (cap as unknown as Record<string, unknown>).customHdrName = "my.hdr";
    cap.setPresetId("custom");
    expect(cap.getPresetId()).toBe("custom");
    expect(cap.hasCustomHdr()).toBe(true);
    expect(cap.getCustomHdrName()).toBe("my.hdr");
  });

  it("setPreset 按模型类别套用（ENV_PRESET_BY_MODEL）", () => {
    const cap = newCap();
    cap.applyModelPreset("vrm");
    // vrm → studio
    expect(cap.getPresetId()).toBe("studio");
    expect(cap.getIntensity()).toBe(ENV_PRESETS.studio.defaultIntensity);
    cap.applyModelPreset("litematic");
    // litematic → forest
    expect(cap.getPresetId()).toBe("forest");
  });

  it("setPreset 未知模型类型回退 default（sky）", () => {
    const cap = newCap();
    cap.applyModelPreset("unknown_type");
    // unknown → MODEL_DEFAULTS.default → envPreset: "sky"
    expect(cap.getPresetId()).toBe(MODEL_DEFAULTS.default.envPreset);
  });

  it("applyModelPreset 不会跳到 custom（由用户主动选 HDR 才进）", () => {
    const cap = newCap();
    cap.applyModelPreset("default");
    expect(cap.getPresetId()).not.toBe("custom");
  });
});

describe("EnvironmentCapability — buildEnvironment 管线（真实分支）", () => {
  it("enabled 下 apply 后 scene.environment 被赋值（PMREM 产物）", () => {
    const cap = newCap();
    cap.apply();
    expect(cap.isEnabled()).toBe(true);
    // scene.environment 来自 FakePMREM 的 rt.texture
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    expect(scene.environment).not.toBeNull();
  });

  it("setEnabled(false) 还原构造前的 scene.environment（null）", () => {
    const scene = new THREE.Scene();
    const cap = new EnvironmentCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply(); // build
    expect(scene.environment).not.toBeNull();
    cap.setEnabled(false); // build → disabled 分支
    expect(scene.environment).toBeNull();
    cap.setEnabled(true);
    expect(scene.environment).not.toBeNull();
  });

  it("构造前已有 environment 时，禁用还原为原引用", () => {
    const scene = new THREE.Scene();
    const original = new THREE.Texture();
    scene.environment = original;
    const cap = new EnvironmentCapability({ scene, renderer: makeFakeRenderer() });
    cap.apply();
    expect(scene.environment).not.toBe(original);
    cap.setEnabled(false);
    expect(scene.environment).toBe(original);
  });

  it("useAsBackground=true 时 background 挂源纹理；false 还原 prevBackground", () => {
    const scene = new THREE.Scene();
    const cap = new EnvironmentCapability({ scene, renderer: makeFakeRenderer() });
    cap.setUseAsBackground(true);
    expect(scene.background).not.toBeNull();
    cap.setUseAsBackground(false);
    expect(scene.background).toBeNull(); // prevBackground 初始为 null
  });

  it("prevBackground 是 Color 时禁用还原保留 Color 实例", () => {
    const scene = new THREE.Scene();
    const color = new THREE.Color(0xff0000);
    scene.background = color;
    const cap = new EnvironmentCapability({ scene, renderer: makeFakeRenderer() });
    cap.setUseAsBackground(true);
    expect(scene.background).not.toBe(color);
    cap.setUseAsBackground(false);
    expect(scene.background).toBe(color);
  });

  it("程序化背景源在切换/禁用时被 dispose，custom HDR 缓存不被误 dispose", () => {
    setEnvState({ envUseAsBackground: true }, { source: "manual" });
    const cap = newCap();
    cap.apply();
    const bgSrc = (cap as unknown as { backgroundSrcTex: THREE.Texture }).backgroundSrcTex;
    const disposeSpy = vi.spyOn(bgSrc, "dispose");
    cap.setUseAsBackground(false); // 重建 → 旧程序化 CanvasTexture dispose
    expect(disposeSpy).toHaveBeenCalled();
  });

  it("setResolution 在 enabled 时重建、disabled 时不动", () => {
    const cap = newCap();
    cap.apply();
    const scene = (cap as unknown as { scene: THREE.Scene }).scene;
    const envBefore = scene.environment;
    cap.setResolution(512);
    expect(scene.environment).not.toBe(envBefore); // 重建

    cap.setEnabled(false);
    cap.setResolution(256);
    expect(scene.environment).toBeNull(); // disabled 不重建，保持还原态
  });

  it("preset=custom 无缓存时 build 告警一次并回退 studio", () => {
    const log = vi.fn();
    (globalThis as Record<string, unknown>).__ysmRingLog = log;
    const cap = newCap();
    // 直接置 preset=custom（模拟内部状态），触发 buildEnvironment
    setEnvState({ envPreset: "custom" }, { source: "manual" });
    cap.apply();
    expect(log).toHaveBeenCalledWith("env", expect.stringContaining("HDR"), "warn");
    // 告警后回退 studio
    expect(cap.getPresetId()).toBe("studio");
    // 第二次不再告警（customHdrWarnedMissing 去重）
    setEnvState({ envPreset: "custom" }, { source: "manual" });
    cap.apply();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("preset=custom 无缓存且无 __ysmRingLog 时走 console.warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cap = newCap();
    setEnvState({ envPreset: "custom" }, { source: "manual" });
    cap.apply();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("custom"));
    warnSpy.mockRestore();
  });

  it("dispose 还原 environment/background 并清空 custom 缓存", () => {
    const scene = new THREE.Scene();
    const color = new THREE.Color(0x123456);
    scene.background = color;
    const cap = new EnvironmentCapability({ scene, renderer: makeFakeRenderer() });
    const hdr = makeFakeHdrTexture();
    (cap as unknown as Record<string, unknown>).customHdrTex = hdr;
    (cap as unknown as Record<string, unknown>).customHdrName = "a.hdr";
    cap.setUseAsBackground(true);
    cap.apply();
    expect(scene.environment).not.toBeNull();
    cap.dispose();
    expect(scene.environment).toBeNull();
    expect(scene.background).toBe(color);
    expect(cap.hasCustomHdr()).toBe(false);
    expect(cap.getCustomHdrName()).toBe("");
  });
});

describe("EnvironmentCapability — custom HDR 交互入口", () => {
  /** mock 文件选择器：createElement("input") 返回带 files 的假 input，click() 同步触发 onchange */
  function spyFilePicker(file: File | null): void {
    const fakeInput = {
      type: "",
      accept: "",
      multiple: false,
      files: file ? [file] : null,
      onchange: null as ((this: unknown, ev: unknown) => void) | null,
      remove(): void {},
      click(): void { this.onchange?.call(this, {}); },
    };
    canvasSpy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag === "input") return fakeInput as unknown as HTMLInputElement;
      if (tag === "canvas") return makeMockCanvas();
      return origCreateElement(tag);
    }) as typeof document.createElement);
  }

  function makeHdrFile(): File {
    return new File([new Uint8Array([0x23, 0x3f]), new Uint8Array(8)], "test.hdr", { type: "image/vnd.radiance" });
  }

  it("取消选择（无文件）时不改变状态", async () => {
    const cap = newCap();
    spyFilePicker(null);
    // files 为 null → onchange resolve(null) → onPickCustomHdr 早退
    await cap.onPickCustomHdr();
    expect(cap.getPresetId()).toBe("sky");
    expect(cap.hasCustomHdr()).toBe(false);
  });

  it("窗口 focus 兜底（300ms 后仍未选文件）→ resolve(null) 早退", async () => {
    vi.useFakeTimers();
    try {
      const cap = newCap();
      // files=null 且 click 不触发 onchange：等 focus 兜底分支
      const fakeInput = {
        type: "",
        accept: "",
        multiple: false,
        files: null,
        onchange: null as ((this: unknown, ev: unknown) => void) | null,
        remove(): void {},
        click(): void { /* 不触发 onchange，模拟浏览器取消行为 */ },
      };
      canvasSpy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
        if (tag === "input") return fakeInput as unknown as HTMLInputElement;
        if (tag === "canvas") return makeMockCanvas();
        return origCreateElement(tag);
      }) as typeof document.createElement);

      const pending = cap.onPickCustomHdr();
      // 触发 window focus（pickHdrFile 注册了 once listener）
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(300);
      await pending;
      expect(cap.getPresetId()).toBe("sky"); // 早退，状态不变
    } finally {
      vi.useRealTimers();
    }
  });

  it("解码成功 → preset=custom 并重建环境", async () => {
    const cap = newCap();
    spyFilePicker(makeHdrFile());
    // 真实 loadCustomHdrFromFile 成功时会写入 customHdrTex 缓存，mock 保持同语义
    vi.spyOn(cap as unknown as { loadCustomHdrFromFile: (f: File) => Promise<boolean> }, "loadCustomHdrFromFile")
      .mockImplementation(async () => {
        (cap as unknown as Record<string, unknown>).customHdrTex = makeFakeHdrTexture();
        (cap as unknown as Record<string, unknown>).customHdrName = "test.hdr";
        return true;
      });
    await cap.onPickCustomHdr();
    expect(cap.getPresetId()).toBe("custom");
    expect(cap.hasCustomHdr()).toBe(true);
  });

  it("解码失败 → 回退 studio 并重建环境", async () => {
    const cap = newCap();
    spyFilePicker(makeHdrFile());
    vi.spyOn(cap as unknown as { loadCustomHdrFromFile: (f: File) => Promise<boolean> }, "loadCustomHdrFromFile")
      .mockResolvedValue(false);
    await cap.onPickCustomHdr();
    expect(cap.getPresetId()).toBe("studio");
  });

  it("onClearCustomHdr 清缓存：custom 回 studio，非 custom 保持", () => {
    const cap = newCap();
    const hdr = makeFakeHdrTexture();
    (cap as unknown as Record<string, unknown>).customHdrTex = hdr;
    (cap as unknown as Record<string, unknown>).customHdrName = "x.hdr";
    cap.setPresetId("custom");
    cap.onClearCustomHdr();
    expect(cap.hasCustomHdr()).toBe(false);
    expect(cap.getCustomHdrName()).toBe("");
    expect(cap.getPresetId()).toBe("studio");
  });

  it("onClearCustomHdr 非 custom 预设时保持当前预设", () => {
    setEnvState({ envPreset: "night" }, { source: "manual" });
    const cap = newCap();
    const hdr = makeFakeHdrTexture();
    (cap as unknown as Record<string, unknown>).customHdrTex = hdr;
    cap.onClearCustomHdr();
    expect(cap.getPresetId()).toBe("night");
    expect(cap.hasCustomHdr()).toBe(false);
  });

  it("有缓存时 loadState 读回 custom 保留（saveState 不存 HDR 的二次保险分支）", () => {
    localStorage.setItem("ysm-scene-cap-environment", JSON.stringify({ preset: "custom" }));
    const cap = newCap();
    // 先注入缓存（模拟用户已加载 HDR 后再 loadState 的罕见时序）
    (cap as unknown as Record<string, unknown>).customHdrTex = makeFakeHdrTexture(1, 1);
    cap.loadState();
    expect(cap.getPresetId()).toBe("custom");
  });
});

describe("EnvironmentCapability — 缩略图与直方图", () => {
  it("getCustomHdrThumbnail 无缓存返回 null", () => {
    const cap = newCap();
    expect(cap.getCustomHdrThumbnail()).toBeNull();
  });

  it("getCustomHdrThumbnail 有缓存时降采样输出 dataURL", () => {
    const cap = newCap();
    (cap as unknown as Record<string, unknown>).customHdrTex = makeFakeHdrTexture(4, 2, 0.5);
    const url = cap.getCustomHdrThumbnail(8, 4);
    expect(url).toBe("data:image/png;base64,mock");
  });

  it("getCustomHdrThumbnail image 缺字段 / ctx 缺失时返回 null", () => {
    const cap = newCap();
    // image 为 undefined（DataTexture 空构造）
    (cap as unknown as Record<string, unknown>).customHdrTex = new THREE.DataTexture();
    expect(cap.getCustomHdrThumbnail()).toBeNull();
    // ctx 为 null（getContext 返回 null 的 mock canvas）
    spyCanvas({ ctx: null });
    (cap as unknown as Record<string, unknown>).customHdrTex = makeFakeHdrTexture();
    expect(cap.getCustomHdrThumbnail()).toBeNull();
  });

  it("getPresetThumbnail 每个预设返回 dataURL；custom 返回 null", () => {
    const cap = newCap();
    for (const id of Object.keys(ENV_PRESETS) as Array<Exclude<EnvPresetId, "custom">>) {
      const dataUrl = cap.getPresetThumbnail(id, 64);
      expect(dataUrl).toBe("data:image/png;base64,mock");
    }
    expect(cap.getPresetThumbnail("custom" as EnvPresetId, 64)).toBeNull();
  });

  it("getLuminanceHistogram 无数据源时全 0", () => {
    const cap = newCap();
    const hist = cap.getLuminanceHistogram();
    expect(hist).toHaveLength(16);
    expect(hist.every((v) => v === 0)).toBe(true);
  });

  it("getLuminanceHistogram customHdrTex 分支：half-float 逐像素入 bin", () => {
    const cap = newCap();
    (cap as unknown as Record<string, unknown>).customHdrTex = makeFakeHdrTexture(4, 2, 0.5); // 8 像素
    const hist = cap.getLuminanceHistogram();
    // lum=0.5 → mapped=1/3 → bin=5
    expect(hist.reduce((a, b) => a + b, 0)).toBe(8);
    expect(hist[5]).toBe(8);
  });

  it("getLuminanceHistogram 程序化背景分支：读 canvas 像素", () => {
    setEnvState({ envUseAsBackground: true }, { source: "manual" });
    const cap = newCap();
    cap.apply(); // backgroundSrcTex = mock canvas（默认 ctx）
    const hist = cap.getLuminanceHistogram();
    // mock getImageData 返回 4 像素全 0（黑）→ bin 0
    expect(hist.reduce((a, b) => a + b, 0)).toBe(4);
    expect(hist[0]).toBe(4);
  });

  it("getLuminanceHistogram canvas 读取抛错时静默返回全 0", () => {
    setEnvState({ envUseAsBackground: true }, { source: "manual" });
    const cap = newCap();
    cap.apply();
    // 把 backgroundSrcTex 换成会抛错的 canvas
    const throwing = makeMockCanvas({ ctx: null });
    (throwing as unknown as { getContext: () => never }).getContext = () => {
      throw new Error("tainted");
    };
    (cap as unknown as { backgroundSrcTex: THREE.Texture }).backgroundSrcTex = { image: throwing } as unknown as THREE.Texture;
    const hist = cap.getLuminanceHistogram();
    expect(hist.every((v) => v === 0)).toBe(true);
  });

  it("getLuminanceHistogram backgroundSrcTex 无 canvas image 时全 0", () => {
    const cap = newCap();
    (cap as unknown as { backgroundSrcTex: THREE.Texture }).backgroundSrcTex = { image: {} } as unknown as THREE.Texture;
    expect(cap.getLuminanceHistogram().every((v) => v === 0)).toBe(true);
  });
});

describe("EnvironmentCapability — 强度控制", () => {
  it("setIntensity 设置反射强度（0~5 有效范围）", () => {
    const cap = newCap();
    cap.setIntensity(2.0);
    expect(cap.getIntensity()).toBe(2.0);
    cap.setIntensity(0.5);
    expect(cap.getIntensity()).toBe(0.5);
  });

  it("setIntensity clamp 到 [0, 5]", () => {
    const cap = newCap();
    cap.setIntensity(-1);
    expect(cap.getIntensity()).toBe(0);
    cap.setIntensity(10);
    expect(cap.getIntensity()).toBe(5);
  });

  it("setIntensity 对 Standard 材质下发 envMapIntensity，Basic 材质跳过", () => {
    const scene = new THREE.Scene();
    const std = new THREE.MeshStandardMaterial();
    const basic = new THREE.MeshBasicMaterial();
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), std));
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), basic));
    const multi = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]);
    scene.add(group, multi);
    const cap = new EnvironmentCapability({ scene, renderer: makeFakeRenderer() });
    cap.setIntensity(2.5);
    expect(std.envMapIntensity).toBe(2.5);
    expect((multi.material as THREE.MeshStandardMaterial[])[0].envMapIntensity).toBe(2.5);
    expect((multi.material as THREE.MeshStandardMaterial[])[1].envMapIntensity).toBe(2.5);
  });

  it("syncMeshIntensity 对指定 roots 下发当前强度", () => {
    const std = new THREE.MeshStandardMaterial();
    const root = new THREE.Mesh(new THREE.BoxGeometry(), std);
    setEnvState({ envIntensity: 1.8 }, { source: "manual" });
    const cap = newCap();
    cap.syncMeshIntensity([root]);
    expect(std.envMapIntensity).toBe(1.8);
  });
});

describe("EnvironmentCapability — 背景开关 / 启用禁用", () => {
  it("setUseAsBackground 切换", () => {
    const cap = newCap();
    expect(cap.isUseAsBackground()).toBe(false);
    cap.setUseAsBackground(true);
    expect(cap.isUseAsBackground()).toBe(true);
    cap.setUseAsBackground(false);
    expect(cap.isUseAsBackground()).toBe(false);
  });

  it("setEnabled(false) 禁用环境贴图，setEnabled(true) 恢复", () => {
    const cap = newCap();
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
  });
});

describe("EnvironmentCapability — 持久化", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("saveState / loadState 完整周期", () => {
    setEnvState({ envPreset: "sunset", envIntensity: 1.4, envUseAsBackground: true }, { source: "manual" });
    const cap = newCap();
    cap.saveState();
    // 新 cap 从 localStorage 恢复
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.getPresetId()).toBe("sunset");
    expect(cap2.getIntensity()).toBe(1.4);
    expect(cap2.isUseAsBackground()).toBe(true);
    expect(cap2.isEnabled()).toBe(true);
  });

  it("saveState：custom 无缓存时落盘为 studio", () => {
    const cap = newCap();
    setEnvState({ envPreset: "custom" }, { source: "manual" });
    cap.saveState();
    const saved = JSON.parse(localStorage.getItem("ysm-scene-cap-environment") ?? "{}") as { preset: string };
    expect(saved.preset).toBe("studio");
  });

  it("loadState 空存储时保持默认值", () => {
    setEnvState({ envPreset: "night" }, { source: "manual" });
    const cap = newCap();
    cap.loadState(); // 无存储 → 不覆盖
    expect(cap.getPresetId()).toBe("night");
  });

  it("loadState 读回 preset=custom 但无缓存 → 回退 studio", () => {
    localStorage.setItem("ysm-scene-cap-environment", JSON.stringify({ preset: "custom", enabled: true, intensity: 1.0, resolution: 1024, useAsBackground: false }));
    const cap = newCap();
    cap.loadState();
    // custom 无缓存 → 回退 studio
    expect(cap.getPresetId()).toBe("studio");
  });

  it("loadState 读回 custom 无缓存时走 __ysmRingLog 告警且只告警一次", () => {
    const log = vi.fn();
    (globalThis as Record<string, unknown>).__ysmRingLog = log;
    localStorage.setItem("ysm-scene-cap-environment", JSON.stringify({ preset: "custom" }));
    const cap = newCap();
    cap.loadState();
    expect(cap.getPresetId()).toBe("studio");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("loadState 非法 preset 字符串不覆盖当前值", () => {
    localStorage.setItem("ysm-scene-cap-environment", JSON.stringify({ preset: "bogus", intensity: "high", resolution: "big", useAsBackground: "yes" }));
    setEnvState({ envPreset: "night" }, { source: "manual" });
    const cap = newCap();
    cap.loadState();
    expect(cap.getPresetId()).toBe("night");
    expect(cap.getIntensity()).toBe(1.0); // 默认值未被 "high" 覆盖
    expect(cap.isUseAsBackground()).toBe(false);
  });

  it("loadState 读回合法 preset 时正确恢复", () => {
    localStorage.setItem("ysm-scene-cap-environment", JSON.stringify({ preset: "forest", enabled: false, intensity: 1.1, resolution: 1024, useAsBackground: true }));
    const cap = newCap();
    cap.loadState();
    expect(cap.getPresetId()).toBe("forest");
    expect(cap.isEnabled()).toBe(false);
    expect(cap.getIntensity()).toBe(1.1);
    expect(cap.isUseAsBackground()).toBe(true);
  });
});

describe("EnvironmentCapability — getMenuNodes 结构（节点化后 group 由 folder 表达）", () => {
  it("非总开关节点全部嵌套在 folder 内（节点化后 group 由 folder 承载）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // env-enabled 平铺
    expect(nodes[0]!.id).toBe("env-enabled");
    // 其余节点在 folder children 内
    const bgFolder = nodes[2]!;
    expect(bgFolder.kind).toBe("folder");
    expect(bgFolder.labelKey).toBe("preview.envGroupBackground");
    const bgChildIds = bgFolder.children!.map((c) => c.id);
    expect(bgChildIds).toContain("env-use-as-background");
    expect(bgChildIds).toContain("env-intensity");
    expect(bgChildIds).toContain("cap-group-env-histogram");
    // folder labelKey 对应原 group
    expect(nodes[1]!.labelKey).toBe("preview.envGroupPreset");
    expect(nodes[3]!.labelKey).toBe("preview.envGroupCustomHdr");
  });

  it("toggle 开关操作同步状态（节点 control 闭包）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    const enabledNode = nodes.find((n) => n.id === "env-enabled")!;
    expect(enabledNode.control!.get!(undefined)).toBe(true);
    enabledNode.control!.set!(false);
    expect(cap.isEnabled()).toBe(false);
    expect(enabledNode.control!.get!(undefined)).toBe(false);
    enabledNode.control!.set!(true);
    expect(cap.isEnabled()).toBe(true);
  });

  it("强度滑块读写同步（节点 control 闭包）", () => {
    const cap = newCap();
    const bgFolder = cap.getMenuNodes()[2]!;
    const intensityNode = bgFolder.children!.find((c) => c.id === "env-intensity")!;
    intensityNode.control!.set!(2.5);
    expect(cap.getIntensity()).toBe(2.5);
    expect(intensityNode.control!.get!(undefined)).toBe(2.5);
  });

  it("背景开关读写同步（节点 control 闭包）", () => {
    const cap = newCap();
    const bgFolder = cap.getMenuNodes()[2]!;
    const bgNode = bgFolder.children!.find((c) => c.id === "env-use-as-background")!;
    bgNode.control!.set!(true);
    expect(cap.isUseAsBackground()).toBe(true);
    expect(bgNode.control!.get!(undefined)).toBe(true);
  });
});

describe("EnvironmentCapability — 预设数据完整性", () => {
  it("drawEnvEquirect sunRadius=0 时跳过太阳圆盘", () => {
    const canvas = makeMockCanvas();
    const zeroSun: EnvPreset = {
      ...ENV_PRESETS.sky,
      sunRadius: 0, // radius <= 0 → 跳过 radial 圆盘分支
      hazeLayers: 0,
    };
    expect(() => drawEnvEquirect(canvas, zeroSun)).not.toThrow();
  });

  it("drawEnvEquirect 多层 haze 不炸", () => {
    const canvas = makeMockCanvas();
    const hazy: EnvPreset = { ...ENV_PRESETS.studio, hazeLayers: 3 };
    expect(() => drawEnvEquirect(canvas, hazy)).not.toThrow();
  });

  it("ENV_PRESETS 每个预设字段完整", () => {
    for (const [id, p] of Object.entries(ENV_PRESETS)) {
      expect(p.id).toBe(id);
      expect(typeof p.label).toBe("string");
      expect(typeof p.zenith).toBe("number");
      expect(typeof p.horizon).toBe("number");
      expect(typeof p.nadir).toBe("number");
      expect(typeof p.sunColor).toBe("number");
      expect(typeof p.sunPos.x).toBe("number");
      expect(typeof p.sunPos.y).toBe("number");
      expect(typeof p.sunRadius).toBe("number");
      expect(typeof p.hazeLayers).toBe("number");
      expect(typeof p.defaultIntensity).toBe("number");
      expect(p.sunPos.y).toBeGreaterThanOrEqual(0);
      expect(p.sunPos.y).toBeLessThanOrEqual(1);
      expect(p.sunRadius).toBeGreaterThanOrEqual(0);
      expect(p.defaultIntensity).toBeGreaterThanOrEqual(0);
    }
  });

  it("MODEL_DEFAULTS 覆盖所有已知模型类型", () => {
    const expectedTypes = ["default", "ysm", "vrm", "mmd", "mmd-scene", "litematic", "resourcepack"];
    for (const t of expectedTypes) {
      expect(MODEL_DEFAULTS[t as keyof typeof MODEL_DEFAULTS]).toBeDefined();
    }
  });
});

describe("EnvironmentCapability — getMenuNodes（ADR-195 刀2 cap 直产节点）", () => {
  it("完整树 = env-enabled 平铺 toggle + preset/background/customHdr 三 folder（组分裂修复：background 含 histogram）", () => {
    const cap = newCap();
    const nodes = cap.getMenuNodes();
    // 4 顶层项
    expect(nodes).toHaveLength(4);
    // 0: env-enabled toggle 原生（能力总开关，无 group）
    expect(nodes[0]!.kind).toBe("toggle");
    expect(nodes[0]!.id).toBe("env-enabled");
    nodes[0]!.control!.set!(false);
    expect(cap.isEnabled()).toBe(false);
    nodes[0]!.control!.set!(true);
    expect(cap.isEnabled()).toBe(true);
    // 1: preset folder
    expect(nodes[1]!.kind).toBe("folder");
    expect(nodes[1]!.labelKey).toBe("preview.envGroupPreset");
    // 2: background folder（组分裂修复：含 use-as-background + intensity + histogram）
    const bgFolder = nodes[2]!;
    expect(bgFolder.kind).toBe("folder");
    expect(bgFolder.labelKey).toBe("preview.envGroupBackground");
    expect(bgFolder.children!.map((c) => c.id)).toEqual([
      "env-use-as-background",
      "env-intensity",
      "cap-group-env-histogram",
    ]);
    // background 组内 toggle/slider 原生节点读写闭包直连 cap
    const useAsBg = bgFolder.children![0]!;
    expect(useAsBg.kind).toBe("toggle");
    expect(useAsBg.hintKey).toBe("preview.envUseAsBackgroundHint");
    useAsBg.control!.set!(true);
    expect(cap.isUseAsBackground()).toBe(true);
    const intensity = bgFolder.children![1]!;
    expect(intensity.kind).toBe("slider");
    intensity.control!.set!(2.5);
    expect(cap.getIntensity()).toBe(2.5);
    // background 组内 histogram controls 节点
    const histNode = bgFolder.children![2]!;
    expect(histNode.kind).toBe("controls");
    const histControls = typeof histNode.controls === "function" ? histNode.controls() : histNode.controls;
    expect(histControls![0]!.kind).toBe("histogram");
    expect(histControls![0]!.id).toBe("env-histogram");
    // 3: customHdr folder
    expect(nodes[3]!.kind).toBe("folder");
    expect(nodes[3]!.labelKey).toBe("preview.envGroupCustomHdr");
  });

  it("preset folder 内 preset-thumb 走 controls 通道节点（控件定义内嵌）", () => {
    const cap = newCap();
    const presetFolder = cap.getMenuNodes()[1]!;
    const thumbNode = presetFolder.children![0]!;
    expect(thumbNode.kind).toBe("controls");
    expect(thumbNode.id).toBe("cap-group-env-preset-thumb");
    const controls = typeof thumbNode.controls === "function" ? thumbNode.controls() : thumbNode.controls;
    expect(controls![0]!.kind).toBe("preset-thumb");
    expect(controls![0]!.id).toBe("env-preset");
    // thumb 配置完整
    expect(controls![0]!.thumb).toBeDefined();
    expect(controls![0]!.thumb!.size).toBe(64);
    expect(controls![0]!.thumb!.options.length).toBe(5);
    expect(controls![0]!.thumb!.activeValue()).toBe("sky");
    // onSelect 切换预设
    controls![0]!.thumb!.onSelect("studio");
    expect(cap.getPresetId()).toBe("studio");
  });

  it("customHdr folder 内 image + button 走 controls 通道节点", () => {
    const cap = newCap();
    const hdrFolder = cap.getMenuNodes()[3]!;
    expect(hdrFolder.children!.map((c) => c.id)).toEqual([
      "cap-group-env-hdr-preview",
      "cap-group-env-hdr-buttons",
    ]);
    // image controls 节点
    const previewNode = hdrFolder.children![0]!;
    expect(previewNode.kind).toBe("controls");
    const previewControls = typeof previewNode.controls === "function" ? previewNode.controls() : previewNode.controls;
    expect(previewControls![0]!.kind).toBe("image");
    expect(previewControls![0]!.id).toBe("env-hdr-preview");
    // button controls 节点（pick + clear）
    const btnNode = hdrFolder.children![1]!;
    expect(btnNode.kind).toBe("controls");
    const btnControls = typeof btnNode.controls === "function" ? btnNode.controls() : btnNode.controls;
    expect(btnControls!.map((c) => c.id)).toEqual(["env-pick-hdr", "env-clear-hdr"]);
    // pick button 语义
    const pickBtn = btnControls![0]!;
    expect(pickBtn.kind).toBe("button");
    expect(pickBtn.button!.variant).toBe("primary");
    expect(pickBtn.button!.disabled!()).toBe(false);
    // clear button 语义
    const clearBtn = btnControls![1]!;
    expect(clearBtn.kind).toBe("button");
    expect(clearBtn.button!.variant).toBe("ghost");
    expect(clearBtn.button!.disabled!()).toBe(true); // 无 custom HDR → 禁用
    // 注入缓存后 clear 不再禁用
    (cap as unknown as Record<string, unknown>).customHdrTex = makeFakeHdrTexture(1, 1);
    expect(clearBtn.button!.disabled!()).toBe(false);
  });
});
