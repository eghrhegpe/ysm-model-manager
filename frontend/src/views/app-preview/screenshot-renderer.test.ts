// ===== 多角度截图渲染器测试 =====
// 覆盖 renderMultiAngle 全部路径：
//  - spec 获取/解析失败 → null（P2 修复：不 reject 防 unhandled rejection）
//  - models 为空 → null；loadTextures/buildSceneMesh 抛错 → null
//  - 成功路径：4 角度渲染 + base64 收集 + 资源清理（dispose/forceContextLoss）
//  - P3 修复：空 base64（GPU 异常）不入结果集
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAppMock, specMock, loadTexturesMock, buildSceneMeshMock, threeStub } =
  vi.hoisted(() => {
    class FakeVec {
      x = 0;
      y = 0;
      z = 0;
      set(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
      }
      toArray() {
        return [this.x, this.y, this.z];
      }
    }
    class FakeScene {
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
      setFromObject() {
        return this;
      }
      getCenter(v: FakeVec) {
        return v.set(0, 0, 0);
      }
      getSize(v: FakeVec) {
        return v.set(2, 2, 2);
      }
    }
    class FakeLight {
      position = { set() {} };
    }
    class FakeWebGLRenderer {
      static toDataURLValue = "data:image/png;base64,QUFB";
      static instances: FakeWebGLRenderer[] = [];
      domElement = {
        toDataURL: vi.fn(() => FakeWebGLRenderer.toDataURLValue),
      };
      setClearColor = vi.fn();
      setSize = vi.fn();
      setPixelRatio = vi.fn();
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
      buildSceneMeshMock: vi.fn(),
      threeStub: {
        WebGLRenderer: FakeWebGLRenderer,
        Scene: FakeScene,
        AmbientLight: FakeLight,
        DirectionalLight: FakeLight,
        Mesh: FakeMesh,
        Box3: FakeBox3,
        Vector3: FakeVec,
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

vi.mock("../../wails/app.ts", () => ({ getApp: getAppMock }));
vi.mock("./model3d-loader.ts", () => ({ loadTextures: loadTexturesMock }));
vi.mock("../../utils/3d/model3d.ts", () => ({
  buildSceneMesh: buildSceneMeshMock,
  compKey: (mi: number, boneId: string) => `${mi}:${boneId}`,
}));
vi.mock("three", () => threeStub);

import { renderMultiAngle } from "./screenshot-renderer.ts";

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
  threeStub.WebGLRenderer.instances.length = 0; // 防跨测试累积
  getAppMock.mockResolvedValue({ GetModel3DSpec: specMock });
  specMock.mockResolvedValue(JSON.stringify(validSpec));
  loadTexturesMock.mockResolvedValue([{}]);
  stubSceneGraph();
  threeStub.WebGLRenderer.toDataURLValue = "data:image/png;base64,QUFB";
});

describe("renderMultiAngle — 防御路径", () => {
  it("GetModel3DSpec 抛错 → 返回 null 而非 reject", async () => {
    specMock.mockRejectedValue(new Error("wails 断开"));
    expect(await renderMultiAngle("/m/a.ysm", [])).toBeNull();
  });

  it("spec 非法 JSON → console.warn + 返回 null", async () => {
    specMock.mockResolvedValue("not-json{{{");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await renderMultiAngle("/m/a.ysm", [])).toBeNull();
      expect(warn.mock.calls[0]?.[0]).toContain("[screenshot] spec 获取失败");
    } finally {
      warn.mockRestore();
    }
  });

  it("spec.models 为空 → 返回 null（不创建渲染器）", async () => {
    specMock.mockResolvedValue(JSON.stringify({ models: [] }));
    expect(await renderMultiAngle("/m/a.ysm", [])).toBeNull();
    expect(threeStub.WebGLRenderer.instances).toHaveLength(0);
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

  it("buildSceneMesh 抛错 → 返回 null（场景构建段防御）", async () => {
    buildSceneMeshMock.mockImplementation(() => {
      throw new Error("mesh boom");
    });
    expect(await renderMultiAngle("/m/a.ysm", [])).toBeNull();
  });
});

describe("renderMultiAngle — 成功路径", () => {
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
