// @vitest-environment node
// ===== 多角度截图渲染器测试（ADR-136 第四刀随实现迁至 preview-3d）=====
// 覆盖 renderMultiAngle 全部路径：
//  - spec 获取/解析失败 → null（P2 修复：不 reject 防 unhandled rejection）
//  - models 为空 → null；loadTextures/buildSceneMesh 抛错 → null
//  - 成功路径：4 角度渲染 + base64 收集 + 资源清理（dispose/forceContextLoss）
//  - P3 修复：空 base64（GPU 异常）不入结果集
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAppMock, specMock, loadTexturesMock, releaseTextureUrlsMock, buildSceneMeshMock, buildYsmObjectMock, buildSpecMock, coneMock, threeStub } =
  vi.hoisted(() => {
    class FakeVec {
      x = 0;
      y = 0;
      z = 0;
      constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
      }
      set(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
      }
      // [ADR-266-d1] 带 lights 的路径首次进测试：applyLights 需要 copy/add/distanceTo
      copy(v: FakeVec) {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        return this;
      }
      add(v: FakeVec) {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        return this;
      }
      distanceTo(v: FakeVec) {
        return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
      }
      toArray() {
        return [this.x, this.y, this.z];
      }
    }
    class FakeScene {
      // [锐评 P1-1 2026-10-08] 记录离屏 Scene 实例（IBL 边界锁：断言离屏 Scene 不设 environment）
      static instances: FakeScene[] = [];
      children: unknown[] = [];
      add(...objs: unknown[]) {
        this.children.push(...objs);
        return this;
      }
      traverse(fn: (o: unknown) => void) {
        const visit = (o: unknown) => {
          fn(o);
          for (const c of (o as { children?: unknown[] }).children ?? []) visit(c);
        };
        for (const c of this.children) visit(c);
      }
      updateMatrixWorld() {}
      constructor() {
        FakeScene.instances.push(this);
      }
    }
    class FakeMesh {
      isMesh = true;
      geometry = { dispose: vi.fn() };
      material = { dispose: vi.fn() };
      position = { set() {} };
      quaternion = { set() {} };
      add() {
        return this;
      }
    }
    class FakeBox3 {
      static sizeValue = [2, 2, 2];
      setFromObject() {
        return this;
      }
      getCenter(v: FakeVec) {
        return v.set(0, 0, 0);
      }
      getSize(v: FakeVec) {
        return v.set(FakeBox3.sizeValue[0], FakeBox3.sizeValue[1], FakeBox3.sizeValue[2]);
      }
    }
    class FakeLight {
      static instances: FakeLight[] = [];
      // [S1] 由 {set,copy} mock 改为真 FakeVec：copy 真实记录落位值，directional 落位断言直读
      position = new FakeVec();
      color: unknown;
      intensity: unknown;
      target: unknown = null;
      constructor(color?: unknown, intensity?: unknown) {
        this.color = color;
        this.intensity = intensity;
        FakeLight.instances.push(this);
      }
    }
    // [ADR-266-d1] 带 lights 的路径首次进测试：applyLights 需要 Object3D（共享靶点）、
    // SpotLight（位置光 + target 绑定）与 MathUtils.degToRad 才走得下去
    class FakeObject3D {
      position = new FakeVec();
      target: unknown = null;
    }
    // [S1] 记录构造实参与实例（spot/point candela 补偿与共享靶点断言用）：
    // 真实 SpotLight 构造签名 (color, intensity, distance, angle, penumbra, decay)
    class FakeSpotLight {
      static instances: FakeSpotLight[] = [];
      position = new FakeVec();
      target: unknown = null;
      color: unknown;
      intensity: unknown;
      distance: unknown;
      angle: unknown;
      penumbra: unknown;
      decay: unknown;
      constructor(
        color?: unknown, intensity?: unknown, distance?: unknown,
        angle?: unknown, penumbra?: unknown, decay?: unknown,
      ) {
        this.color = color;
        this.intensity = intensity;
        this.distance = distance;
        this.angle = angle;
        this.penumbra = penumbra;
        this.decay = decay;
        FakeSpotLight.instances.push(this);
      }
    }
    class FakePointLight {
      static instances: FakePointLight[] = [];
      position = new FakeVec();
      color: unknown;
      intensity: unknown;
      distance: unknown;
      decay: unknown;
      constructor(color?: unknown, intensity?: unknown, distance?: unknown, decay?: unknown) {
        this.color = color;
        this.intensity = intensity;
        this.distance = distance;
        this.decay = decay;
        FakePointLight.instances.push(this);
      }
    }
    class FakeWebGLRenderer {
      static toDataURLValue = "data:image/png;base64,QUFB";
      static instances: FakeWebGLRenderer[] = [];
      domElement = {
        width: 512,
        height: 512,
        toDataURL: vi.fn(() => FakeWebGLRenderer.toDataURLValue),
      };
      setClearColor = vi.fn();
      setSize = vi.fn();
      setPixelRatio = vi.fn();
      getSize = vi.fn(function (this: FakeWebGLRenderer, v: any) {
        v.width = this.domElement.width;
        v.height = this.domElement.height;
        return v;
      });
      setPreserveDrawingBuffer = vi.fn();
      getPreserveDrawingBuffer = vi.fn(() => false);
      render = vi.fn();
      dispose = vi.fn();
      forceContextLoss = vi.fn();
      outputColorSpace = 0;
      constructor() {
        FakeWebGLRenderer.instances.push(this);
      }
    }
    class FakeCamera {
      position = { set() {} };
      lookAt() {}
    }
    return {
      getAppMock: vi.fn(),
      specMock: vi.fn(),
      loadTexturesMock: vi.fn(),
      // 审核 C1：loadTextures 的配对释放器（finally 段收编后走此函数归还引用）
      releaseTextureUrlsMock: vi.fn(),
      buildSceneMeshMock: vi.fn(),
      buildYsmObjectMock: vi.fn(),
      buildSpecMock: vi.fn(),
      // [ADR-266-d1] 离屏光柱桥桩：本文件只验接线（调用/释放/输出设置），
      // 几何与落位由 screenshot-cone.test.ts 用真 three 验
      coneMock: vi.fn(),
      threeStub: {
        NoToneMapping: 0,
        WebGLRenderer: FakeWebGLRenderer,
        Scene: FakeScene,
        Object3D: FakeObject3D,
        AmbientLight: FakeLight,
        DirectionalLight: FakeLight,
        SpotLight: FakeSpotLight,
        PointLight: FakePointLight,
        MathUtils: { degToRad: (d: number) => (d * Math.PI) / 180 },
        Mesh: FakeMesh,
        Box3: FakeBox3,
        Vector3: FakeVec,
        Vector2: FakeVec,
        PerspectiveCamera: FakeCamera,
        BufferGeometry: class {
          setAttribute() {}
          setIndex() {}
          dispose() {}
        },
        Float32BufferAttribute: class {},
        MeshBasicMaterial: class {
          dispose() {}
        },
        SRGBColorSpace: 1,
        BackSide: 2,
        DoubleSide: 3,
      },
    };
  });

vi.mock("@/backend/app.ts", () => ({ getApp: getAppMock }));
vi.mock("@/preview-3d/texture/texture-loader.ts", () => ({
  loadTextures: loadTexturesMock,
  releaseTextureUrls: releaseTextureUrlsMock,
}));
// buildSceneMesh/compKey 已从 model3d.ts 迁至 mesh.ts（model3d 拆分）——mock 目标同步迁移，
// 否则 mock 失效会跑真实实现（three 被 mock 成 Fake 类，行为不符 → renderMultiAngle 返回 null）
vi.mock("@/preview-3d/mesh/mesh.ts", () => ({
  buildSceneMesh: buildSceneMeshMock,
  compKey: (mi: number, boneId: string) => `${mi}:${boneId}`,
}));
vi.mock("@/preview-3d/model/ysm-object.ts", () => ({ buildYsmObject: buildYsmObjectMock }));
vi.mock("@/preview-3d/model/spec-builder.ts", () => ({ buildSpecFromGeometryJSON: buildSpecMock }));
vi.mock("three", () => threeStub);
vi.mock("./screenshot-cone.ts", () => ({ applyVolumetricCone: coneMock }));

/** 让锥桥返回一个可断言的假锥（dispose 是 finally 释放纪律的被测点） */
function stubConeReturn(): ReturnType<typeof vi.fn> {
  const dispose = vi.fn();
  coneMock.mockReturnValue({ dispose });
  return dispose;
}

import { renderMultiAngle } from "./screenshot-render.ts";
import type { ScreenshotLights } from "./screenshot-lights.ts";
import { DEFAULT_LIGHT_PARAMS } from "@/preview-3d/caps/light-params.ts";

const validSpec = {
  models: [
    {
      meshGroups: [
        {
          boneId: "root",
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
          uvs: [0, 0, 1, 0, 0, 1],
          indices: [0, 1, 2],
          texIdx: 0,
          localPosition: [0, 0, 0],
          localRotation: [0, 0, 0, 1],
        },
      ],
    },
  ],
};

function stubSceneGraph() {
  const bg = new threeStub.Mesh();
  const rootGroup = new threeStub.Scene();
  buildSceneMeshMock.mockReturnValue({
    boneGroupMap: new Map([["0:root", bg]]),
    rootGroup,
  });
  buildYsmObjectMock.mockReturnValue({
    rootGroup,
    removeFromScene: vi.fn(),
  });
}

/** 最近一次构造的 WebGLRenderer 实例（成功路径内部 new 的） */
function lastRenderer(): {
  setSize: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  forceContextLoss: ReturnType<typeof vi.fn>;
} {
  const inst = threeStub.WebGLRenderer.instances.at(-1);
  if (!inst) throw new Error("未创建 renderer 实例");
  return inst;
}

beforeEach(() => {
  vi.clearAllMocks();
  // 缺省无锥（= 无灯光 / 无光柱路径）；需要锥的用例自行 stubConeReturn()
  coneMock.mockReturnValue(null);
  threeStub.WebGLRenderer.instances.length = 0; // 防跨测试累积
  threeStub.Scene.instances.length = 0; // [锐评 P1-1] 离屏 Scene 实例记录逐用例清零（防跨测试累积）
  threeStub.DirectionalLight.instances.length = 0; // [S1] 灯光桩实例记录逐用例清零（Ambient/Directional 同 FakeLight 类，共享静态数组）
  threeStub.SpotLight.instances.length = 0;
  threeStub.PointLight.instances.length = 0;
  getAppMock.mockResolvedValue({ GetModel3DSpec: specMock });
  specMock.mockResolvedValue(validSpec);
  loadTexturesMock.mockResolvedValue([{}]);
  stubSceneGraph();
  threeStub.WebGLRenderer.toDataURLValue = "data:image/png;base64,QUFB";
  threeStub.Box3.sizeValue = [2, 2, 2];
});

describe("renderMultiAngle — 防御路径", () => {
  it("GetModel3DSpec 抛错 → 返回 null 而非 reject", async () => {
    specMock.mockRejectedValue(new Error("wails 断开"));
    expect(await renderMultiAngle("/m/a.ysm", [])).toBeNull();
  });

  it("spec 为 null → 返回 null（无 warn，null 非异常路径）", async () => {
    specMock.mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await renderMultiAngle("/m/a.ysm", [])).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("spec.models 为空 → 返回 null（不创建渲染器）", async () => {
    specMock.mockResolvedValue({ models: [] });
    expect(await renderMultiAngle("/m/a.ysm", [])).toBeNull();
    expect(threeStub.WebGLRenderer.instances).toHaveLength(0);
  });

  it("spec.models 为空 + 注入 decodeYsm 兜底 → buildSpecFromGeometryJSON 重建 spec", async () => {
    // ADR-136：WASM 兜底由视图层经 options.decodeYsm 注入（不再直接 import views/wasm.ts）
    specMock.mockResolvedValue({ models: [] });
    buildSpecMock.mockReturnValue(JSON.stringify(validSpec));
    const decodeYsm = vi.fn().mockResolvedValue({ geometryRaw: JSON.stringify(validSpec.models[0]) });
    const shots = await renderMultiAngle("/m/a.ysm", [], { decodeYsm: decodeYsm as never });
    expect(decodeYsm).toHaveBeenCalledWith("/m/a.ysm");
    expect(buildSpecMock).toHaveBeenCalled();
    expect(shots).not.toBeNull();
  });

  it("注入 decodeYsm 返回 null（解码失败）→ 返回 null", async () => {
    specMock.mockResolvedValue({ models: [] });
    buildSpecMock.mockReturnValue(JSON.stringify(validSpec));
    const decodeYsm = vi.fn().mockResolvedValue(null);
    expect(await renderMultiAngle("/m/a.ysm", [], { decodeYsm: decodeYsm as never })).toBeNull();
  });

  it("loadTextures 抛错 → 外层 catch → console.warn + 返回 null", async () => {
    loadTexturesMock.mockRejectedValue(new Error("texture boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await renderMultiAngle("/m/a.ysm", ["t.png"])).toBeNull();
      expect(warn.mock.calls[0]?.[0]).toContain("[screenshot] 渲染失败");
    } finally {
      warn.mockRestore();
    }
  });

  it("buildYsmObject 抛错 → 返回 null（场景构建段防御）", async () => {
    buildYsmObjectMock.mockImplementation(() => {
      throw new Error("mesh boom");
    });
    expect(await renderMultiAngle("/m/a.ysm", [])).toBeNull();
  });

  it("场景包围盒尺寸为 0（无实际 mesh）→ 返回 null（防 NaN 相机脏截图）", async () => {
    threeStub.Box3.sizeValue = [0, 0, 0];
    expect(await renderMultiAngle("/m/a.ysm", [])).toBeNull();
  });
});

describe("renderMultiAngle — 成功路径", () => {
  it("酒狐回归：把每组件纹理映射传给共享 YSM 场景构建器", async () => {
    const globalTexture = { id: "global" };
    const mainTexture = { id: "main" };
    const arrowTexture = { id: "arrow" };
    loadTexturesMock
      .mockResolvedValueOnce([globalTexture])
      .mockResolvedValueOnce([mainTexture])
      .mockResolvedValueOnce([arrowTexture]);

    await renderMultiAngle("/m/fox.ysm", ["global.png"], {
      componentTextures: {
        main: ["main.png"],
        arrow: ["arrow.png"],
      },
    });

    const componentTexMap = buildYsmObjectMock.mock.calls[0]?.[2];
    expect(componentTexMap).toBeInstanceOf(Map);
    expect(componentTexMap.get("main")).toEqual([mainTexture]);
    expect(componentTexMap.get("arrow")).toEqual([arrowTexture]);
    expect(buildYsmObjectMock.mock.calls[0]?.[3]).toBe(0);
  });

  it("4 角度渲染 → 返回 front/45/side/back45 且 base64 非空", async () => {
    const shots = await renderMultiAngle("/m/a.ysm", ["t.png"]);
    expect(shots).not.toBeNull();
    expect(shots!.map((s) => s.name)).toEqual([
      "front",
      "45",
      "side",
      "back45",
    ]);
    expect(shots!.every((s) => s.base64 === "QUFB")).toBe(true);
    expect(lastRenderer().render).toHaveBeenCalledTimes(4);
    expect(buildYsmObjectMock).toHaveBeenCalledTimes(1);
  });

  it("opts.size 生效 → setSize 使用指定尺寸", async () => {
    await renderMultiAngle("/m/a.ysm", [], { size: 128 });
    expect(lastRenderer().setSize).toHaveBeenCalledWith(128, 128);
  });

  it("空 base64（GPU 异常）→ 跳过不入结果集", async () => {
    threeStub.WebGLRenderer.toDataURLValue = "";
    const shots = await renderMultiAngle("/m/a.ysm", []);
    expect(shots).toEqual([]);
  });

  it("finally 清理：renderer.dispose + forceContextLoss 被调用", async () => {
    await renderMultiAngle("/m/a.ysm", []);
    expect(lastRenderer().dispose).toHaveBeenCalledTimes(1);
    expect(lastRenderer().forceContextLoss).toHaveBeenCalledTimes(1);
  });
});

// ===== [ADR-266-d1] 体积光入截图 + 输出设置同构：本文件验「接线」，
// 几何/落位/门禁由 screenshot-cone.test.ts（真 three）与 screenshot-lights.test.ts 验 =====
describe("renderMultiAngle — 体积光锥与输出设置同构（ADR-266-d1）", () => {
  const spot = { ...DEFAULT_LIGHT_PARAMS.key, type: "spot" as const, enabled: true };

  function makeLights(over: Partial<ScreenshotLights> = {}): ScreenshotLights {
    return {
      ambient: { color: 0xffffff, intensity: 0.3 },
      radius: 8,
      key: spot,
      fill: { ...DEFAULT_LIGHT_PARAMS.fill, enabled: false },
      rim: { ...DEFAULT_LIGHT_PARAMS.rim, enabled: false },
      volumetric: {
        slot: "key",
        spot,
        params: { ...DEFAULT_LIGHT_PARAMS.volumetric, enabled: true },
      },
      output: { toneMapping: 4, exposure: 0.55, outputColorSpace: "srgb" },
      ...over,
    };
  }

  it("预览有光柱 → 离屏建锥，且 finally 释放（离屏不靠 GC 收 GPU 资源）", async () => {
    const dispose = stubConeReturn();
    const lights = makeLights();
    await renderMultiAngle("/m/a.ysm", [], { lights });
    expect(coneMock).toHaveBeenCalledTimes(1);
    // 接线口径：lights 与模型中心原样透传（锥位/朝向在桥内按预览同式算出）
    expect(coneMock.mock.calls[0]?.[1]).toBe(lights);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("预览无光柱（volumetric=null）→ 不产锥、不触发释放", async () => {
    const lights = makeLights({ volumetric: null });
    await renderMultiAngle("/m/a.ysm", [], { lights });
    expect(coneMock).toHaveBeenCalledWith(expect.anything(), lights, expect.anything());
    expect(coneMock.mock.results[0]?.value).toBeNull();
  });

  it("输出设置镜像到离屏 renderer（toneMapping + 曝光 + 色彩空间三项）", async () => {
    await renderMultiAngle("/m/a.ysm", [], {
      lights: makeLights({ output: { toneMapping: 4, exposure: 0.55, outputColorSpace: "srgb" } }),
    });
    const r = lastRenderer() as unknown as {
      toneMapping?: number;
      toneMappingExposure?: number;
      outputColorSpace?: number;
    };
    expect(r.toneMapping).toBe(4);
    expect(r.toneMappingExposure).toBeCloseTo(0.55, 6);
    // outputColorSpace 由 SUT 先写 SRGBColorSpace（桩值 1），镜像块再覆盖为镜像值
    expect(r.outputColorSpace).toBe("srgb");
  });

  it("无 output（无活跃预览 renderer）→ 不写 toneMapping/曝光（离屏保持自身默认）", async () => {
    await renderMultiAngle("/m/a.ysm", [], { lights: makeLights({ output: null }) });
    const r = lastRenderer() as unknown as {
      toneMapping?: number;
      toneMappingExposure?: number;
    };
    expect(r.toneMapping).toBeUndefined();
    expect(r.toneMappingExposure).toBeUndefined();
  });
});

// ===== [S1] 截图灯光 candela 补偿与共享靶点同构 =====
// 预览侧 applyLightParams 把 UI intensity 反推回坎德拉；截图侧 applyLights 走同一份
// spotDistanceAttenuation。主链盲区：两侧公式同源却无人断言「离屏灯强度」——以下直读桩构造实参。
describe("renderMultiAngle — 灯光对象落地（S1 照度守恒）", () => {
  function makeLights(over: Partial<ScreenshotLights> = {}): ScreenshotLights {
    return {
      ambient: { color: 0xffffff, intensity: 0.3 },
      radius: 8,
      key: { ...DEFAULT_LIGHT_PARAMS.key, type: "spot" as const, enabled: true },
      fill: { ...DEFAULT_LIGHT_PARAMS.fill, enabled: false },
      rim: { ...DEFAULT_LIGHT_PARAMS.rim, enabled: false },
      volumetric: {
        slot: "key",
        spot: { ...DEFAULT_LIGHT_PARAMS.key, type: "spot" as const, enabled: true },
        params: { ...DEFAULT_LIGHT_PARAMS.volumetric, enabled: true },
      },
      output: null,
      ...over,
    };
  }

  it("spot：candela 补偿 = p.intensity/falloff(radius)，距离/衰减/颜色透传，落位同预览公式", async () => {
    const lights = makeLights();
    await renderMultiAngle("/m/a.ysm", [], { lights });
    const { lightDirToPosition, spotDistanceAttenuation } = await import(
      "@/preview-3d/caps/light-math.ts"
    );
    const origin = new threeStub.Vector3(0, 0, 0); // 模型中心（Box3 size 2 → center 0）
    const spot = lights.key; // spot 参数
    const expectedPos = lightDirToPosition(spot, lights.radius).add(
      new threeStub.Vector3(0, 0, 0),
    );
    const d0 = expectedPos.distanceTo(origin);
    const falloff = spotDistanceAttenuation(d0, spot.distance, spot.decay);
    const s = threeStub.SpotLight.instances.at(-1)!;
    expect(s, "应创建一盏 SpotLight").toBeDefined();
    expect(s.intensity).toBeCloseTo(spot.intensity / falloff, 6); // 到达靶点照度守恒
    expect(s.distance).toBe(spot.distance);
    expect(s.decay).toBe(spot.decay);
    expect(s.color).toBe(spot.color);
    // 灯位 = 模型中心 + 方位角/仰角 × radius（与预览 lightPosition 同式）
    expect(s.position.x).toBeCloseTo(expectedPos.x, 5);
    expect(s.position.y).toBeCloseTo(expectedPos.y, 5);
    expect(s.position.z).toBeCloseTo(expectedPos.z, 5);
  });

  it("point：同吃 candela 补偿（spot/point 单一事实源），非裸强度", async () => {
    const key = { ...DEFAULT_LIGHT_PARAMS.key, type: "point" as const, enabled: true };
    const lights = makeLights({ key, volumetric: null });
    await renderMultiAngle("/m/a.ysm", [], { lights });
    const { lightDirToPosition, spotDistanceAttenuation } = await import(
      "@/preview-3d/caps/light-math.ts"
    );
    const pos = lightDirToPosition(key, lights.radius);
    const d0 = pos.distanceTo(new threeStub.Vector3(0, 0, 0));
    const falloff = spotDistanceAttenuation(d0, key.distance, key.decay);
    const p = threeStub.PointLight.instances.at(-1)!;
    expect(p.intensity).toBeCloseTo(key.intensity / falloff, 6);
    expect(p.distance).toBe(key.distance);
    expect(p.decay).toBe(key.decay);
    expect(p.color).toBe(key.color);
  });

  it("多盏 spot 共享同一靶点对象（target 同一实例，位置=模型中心）", async () => {
    const fill = { ...DEFAULT_LIGHT_PARAMS.fill, type: "spot" as const, enabled: true };
    await renderMultiAngle("/m/a.ysm", [], { lights: makeLights({ fill }) });
    const spots = threeStub.SpotLight.instances;
    expect(spots.length).toBeGreaterThanOrEqual(2);
    const t0 = spots[0]!.target;
    expect(t0).toBeDefined();
    expect(t0).not.toBeNull();
    for (const s of spots) {
      expect(s.target).toBe(t0); // 同一 Object3D 实例（防各灯各自 new 靶点、定向失效）
    }
    const target = t0 as { position: { x: number; y: number; z: number } };
    expect(target.position.x).toBe(0);
    expect(target.position.y).toBe(0);
    expect(target.position.z).toBe(0);
  });

  it("directional：落位同预览公式（position - origin ≈ lightDirToPosition），target 共享", async () => {
    const key = { ...DEFAULT_LIGHT_PARAMS.key, enabled: true };
    const lights = makeLights({ key, volumetric: null });
    await renderMultiAngle("/m/a.ysm", [], { lights });
    const { lightDirToPosition } = await import("@/preview-3d/caps/light-math.ts");
    // AmbientLight 的 target 为 null，DirectionalLight 的 target 是共享靶点（非 null）——据此区分
    const dir = threeStub.DirectionalLight.instances.find((l) => l.target !== null);
    expect(dir, "应创建一盏 DirectionalLight").toBeDefined();
    expect(dir!.target).not.toBeNull();
    const expected = lightDirToPosition(key, lights.radius).add(new threeStub.Vector3(0, 0, 0));
    expect(dir!.position.x).toBeCloseTo(expected.x, 5);
    expect(dir!.position.y).toBeCloseTo(expected.y, 5);
    expect(dir!.position.z).toBeCloseTo(expected.z, 5);
    expect(dir!.intensity).toBe(key.intensity); // directional 无 candela 补偿
    expect(dir!.color).toBe(key.color);
  });
});

// ===== [锐评 P1-1 2026-10-08] IBL 边界锁：离屏 Scene 刻意不镜像预览的 scene.environment
// （PMREM 纹理跨 WebGL context 不可共享）。双向样本：
//   ① 行为侧——离屏 Scene 实例上 environment 未被写入（未来若实现 IBL 进截图，本例须翻转断言方向）；
//   ② 声明侧——export.md「IBL 反射不参与截图」已知差异条在场（声明被删而行为未变 → 红）。
describe("renderMultiAngle — IBL 边界（锐评 P1-1 已知差异）", () => {
  it("离屏 Scene 不写 scene.environment（PBR 反射 lobe 离屏缺失 = 已声明的 WYSIWYG 缝）", async () => {
    const before = threeStub.Scene.instances.length; // stubSceneGraph 的 rootGroup（非离屏 Scene）
    const shots = await renderMultiAngle("/m/a.ysm", []);
    expect(shots, "成功路径（Scene 已构建）").not.toBeNull();
    const offscreen = threeStub.Scene.instances[before];
    expect(offscreen, "renderMultiAngle 自建离屏 Scene").toBeDefined();
    expect((offscreen as unknown as { environment?: unknown }).environment, "离屏不镜像 IBL 纹理").toBeUndefined();
  });

  it("export.md 已声明「IBL 反射不参与截图」已知差异（声明与行为互为镜像，删其一即红）", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const doc = readFileSync(fileURLToPath(new URL("../../../../docs/knowledge/export.md", import.meta.url)), "utf8");
    expect(doc, "已知差异声明条在场").toContain("IBL 反射不参与截图");
  });
});
