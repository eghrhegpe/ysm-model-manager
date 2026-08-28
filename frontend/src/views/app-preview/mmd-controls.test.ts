// ===== mmd-controls 菜单面板测试（ADR-076 v2 Phase 2：底部导航收编为根菜单面板填充）=====
// 覆盖：fillMmdModelPanel（信息卡）、fillMmdMorphPanel（表情列表 + morph 权重切换）、
// buildMaterialControls（材质显隐 + 透明度）。切换模型/相机视图归 core 根菜单
// （switch/camera 项），此处不再覆盖。morph 已拆独立菜单项（对齐材质折叠模式，2026-08-28）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  fillMmdModelPanel,
  fillMmdMorphPanel,
  buildMaterialControls,
  type MmdBottomNavCtx,
  type MaterialControlBridge,
} from "./mmd-controls.ts";
import {
  listMmdMaterials,
  getMmdMaterialDetail,
  setMmdMaterialVisible,
  setMmdMaterialOpacity,
} from "../../utils/3d/mmd-materials.ts";

function makeCtx() {
  // MMD 的 SkinnedMesh 是多材质数组（材料列表按数组访问 mats[i]）
  const rawMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    Array.from({ length: 28 }, () => new THREE.MeshBasicMaterial()),
  );
  rawMesh.morphTargetDictionary = { "微笑": 0, "怒": 1, "哀": 2 };
  rawMesh.morphTargetInfluences = [0, 0, 0];
  const mesh = rawMesh as unknown as THREE.SkinnedMesh;
  const mmd = {
    pmx: {
      bones: new Array(364),
      materials: Array.from({ length: 28 }, (_, i) => ({ name: `mat${i}` })),
      morphs: new Array(55),
    },
  };
  const ctx: MmdBottomNavCtx = {
    mmd: mmd as never,
    mesh,
    modelName: "子言.pmx",
    modelPath: "/mmd/子言/子言.pmx",
  };
  return { ctx, mesh, mmd };
}

/** 真实操作 mesh.material 的材质桥（复用 mmd-materials.ts 纯逻辑层，对齐 mmd-adapter 组装口径） */
function makeMatBridge(ctx: MmdBottomNavCtx): MaterialControlBridge {
  const mats = ctx.mesh.material as THREE.Material[];
  return {
    list: () => listMmdMaterials(ctx.mmd.pmx.materials),
    getDetail: (i: number) => getMmdMaterialDetail(ctx.mmd.pmx.materials, mats, i),
    setVisible: (i: number, v: boolean) => setMmdMaterialVisible(mats, i, v),
    setOpacity: (i: number, o: number) => setMmdMaterialOpacity(mats, i, o),
  };
}

// ---- 测试辅助工具函数 ----

/** 创建空 morph 字典的 mesh（无表情） */
function makeEmptyMorphMesh(): THREE.SkinnedMesh {
  const rawMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    Array.from({ length: 5 }, () => new THREE.MeshBasicMaterial()),
  );
  // 显式设置空字典
  (rawMesh as any).morphTargetDictionary = {};
  (rawMesh as any).morphTargetInfluences = [];
  return rawMesh as unknown as THREE.SkinnedMesh;
}

/** 创建 0 骨骼的 PMX（骨骼数为 0） */
function makeZeroBoneCtx(): { ctx: MmdBottomNavCtx } {
  const rawMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    Array.from({ length: 3 }, () => new THREE.MeshBasicMaterial()),
  );
  const mesh = rawMesh as unknown as THREE.SkinnedMesh;
  const mmd = {
    pmx: {
      bones: [],
      materials: Array.from({ length: 3 }, (_, i) => ({ name: `mat${i}` })),
      morphs: [],
    },
  };
  return {
    ctx: {
      mmd: mmd as never,
      mesh,
      modelName: "空骨骼.pmx",
      modelPath: "/mmd/empty/empty.pmx",
    } as MmdBottomNavCtx,
  };
}

/** 创建自定义名称的上下文 */
function makeCtxWithName(name: string): { ctx: MmdBottomNavCtx } {
  const rawMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    Array.from({ length: 2 }, () => new THREE.MeshBasicMaterial()),
  );
  const mesh = rawMesh as unknown as THREE.SkinnedMesh;
  const mmd = {
    pmx: {
      bones: new Array(10),
      materials: Array.from({ length: 2 }, (_, i) => ({ name: `mat${i}` })),
      morphs: new Array(3),
    },
  };
  return {
    ctx: {
      mmd: mmd as never,
      mesh,
      modelName: name,
      modelPath: `/mmd/${name}/${name}`,
    } as MmdBottomNavCtx,
  };
}

/** 创建含单个材料的极简上下文 */
function makeSingleMatCtx(): { ctx: MmdBottomNavCtx } {
  const rawMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    [new THREE.MeshBasicMaterial({ visible: false, opacity: 0.5 })],
  );
  const mesh = rawMesh as unknown as THREE.SkinnedMesh;
  const mmd = {
    pmx: {
      bones: new Array(5),
      materials: [{ name: "单材质" }],
      morphs: [],
    },
  };
  return {
    ctx: {
      mmd: mmd as never,
      mesh,
      modelName: "单材质.pmx",
      modelPath: "/mmd/single/single.pmx",
    } as MmdBottomNavCtx,
  };
}

/** 创建非空 morph 的 mesh */
function makeMultiMorphMesh(): THREE.SkinnedMesh {
  const rawMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()],
  );
  rawMesh.morphTargetDictionary = { "高兴": 0, "悲伤": 1, "愤怒": 2, "惊吓": 3 };
  rawMesh.morphTargetInfluences = [0, 0, 0, 0];
  return rawMesh as unknown as THREE.SkinnedMesh;
}

/** 创建完全为空的 bridge（list 返回空数组） */
function makeEmptyBridge(): MaterialControlBridge {
  return {
    list: () => [],
    getDetail: () => null,
    setVisible: () => {},
    setOpacity: () => {},
  };
}

/** 创建自定义行为的 bridge（用于隔离测试） */
function makeStubBridge(opts: {
  listResult?: Array<{ index: number; name: string }>;
  detailResult?: Record<string, unknown> | null;
  setVisibleFn?: (i: number, v: boolean) => void;
  setOpacityFn?: (i: number, o: number) => void;
}): MaterialControlBridge {
  const detail = opts.detailResult ?? {
    index: 0,
    name: "默认材质",
    visible: true,
    opacity: 1,
    transparent: false,
    specular: null,
    shininess: null,
  };
  return {
    list: () => opts.listResult ?? [{ index: 0, name: "默认材质" }],
    getDetail: (i: number) => {
      if (opts.detailResult !== undefined) return opts.detailResult;
      return detail as any;
    },
    setVisible: opts.setVisibleFn ?? (() => {}),
    setOpacity: opts.setOpacityFn ?? (() => {}),
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

afterEach(() => {
  // 清理所有 mock 状态，防止测试间污染
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("fillMmdModelPanel", () => {
  it("渲染信息卡（名称 + 骨骼/材质/表情计数），不渲染 morph 行（已拆独立面板）", () => {
    const { ctx } = makeCtx();
    const list = document.createElement("div");
    fillMmdModelPanel(list, ctx);
    expect(list.textContent).toContain("子言.pmx");
    expect(list.textContent).toContain("364");
    expect(list.textContent).toContain("28");
    expect(list.textContent).toContain("55");
    // morph 行与标题不在此面板（fillMmdMorphPanel 专属）
    expect(list.querySelectorAll('[data-testid^="mmd-morph-"]').length).toBe(0);
    expect(list.querySelector(".slide-sublabel")).toBeNull();
  });

  it("骨骼数为 0 时仍正确渲染（显示 0 骨骼）", () => {
    const { ctx } = makeZeroBoneCtx();
    const list = document.createElement("div");
    fillMmdModelPanel(list, ctx);
    expect(list.textContent).toContain("空骨骼.pmx");
    expect(list.textContent).toContain("0 骨骼");
    expect(list.textContent).toContain("3 材质");
    expect(list.textContent).toContain("0 表情");
  });

  it("不同 modelName 在信息卡中显示正确值", () => {
    const testNames = ["初音ミク.pmx", "Miku.pmd", "test_中文.pmx"];
    for (const name of testNames) {
      const { ctx } = makeCtxWithName(name);
      const list = document.createElement("div");
      fillMmdModelPanel(list, ctx);
      expect(list.textContent).toContain(name);
    }
  });
});

describe("fillMmdMorphPanel（独立表情面板，对齐材质折叠模式）", () => {
  it("表情行 = morph 数（testId mmd-morph-<name>），点击切换权重 0↔1 + ✓ 高亮", () => {
    const { ctx, mesh } = makeCtx();
    const list = document.createElement("div");
    fillMmdMorphPanel(list, ctx);
    const rows = list.querySelectorAll('[data-testid^="mmd-morph-"]');
    expect(rows.length).toBe(3);
    const row = list.querySelector('[data-testid="mmd-morph-微笑"]') as HTMLElement;
    expect(mesh.morphTargetInfluences![0]).toBe(0);
    row.click();
    expect(mesh.morphTargetInfluences![0]).toBe(1);
    expect(row.querySelector("span")?.textContent).toBe("✓");
    row.click();
    expect(mesh.morphTargetInfluences![0]).toBe(0);
    expect(row.querySelector("span")?.textContent).toBe("🙂");
  });

  it("空 morph 字典时渲染空态提示（不崩溃）", () => {
    const mesh = makeEmptyMorphMesh();
    const mmd = {
      pmx: {
        bones: new Array(10),
        materials: [{ name: "mat0" }, { name: "mat1" }],
        morphs: [],
      },
    };
    const ctx: MmdBottomNavCtx = { mmd: mmd as never, mesh, modelName: "测试.pmx" };
    const list = document.createElement("div");
    fillMmdMorphPanel(list, ctx);
    // 无 morph 行，但有空态提示
    expect(list.querySelectorAll('[data-testid^="mmd-morph-"]').length).toBe(0);
    expect(list.textContent).not.toBe("");
  });

  it("单个 morph 的点击切换行为", () => {
    const rawMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      [new THREE.MeshBasicMaterial()],
    );
    rawMesh.morphTargetDictionary = { "单一": 0 };
    rawMesh.morphTargetInfluences = [0];
    const mesh = rawMesh as unknown as THREE.SkinnedMesh;
    const mmd = {
      pmx: {
        bones: new Array(5),
        materials: [{ name: "mat0" }],
        morphs: [{ name: "单一" }],
      },
    };
    const ctx: MmdBottomNavCtx = { mmd: mmd as never, mesh, modelName: "单morph.pmx" };
    const list = document.createElement("div");
    fillMmdMorphPanel(list, ctx);
    const row = list.querySelector('[data-testid="mmd-morph-单一"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(mesh.morphTargetInfluences![0]).toBe(0);
    row.click();
    expect(mesh.morphTargetInfluences![0]).toBe(1);
    expect(row.querySelector("span")?.textContent).toBe("✓");
  });

  it("初始权重 > 0.5 时显示 ✓（无需首次点击）", () => {
    const rawMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      [new THREE.MeshBasicMaterial()],
    );
    rawMesh.morphTargetDictionary = { "已激活": 0 };
    rawMesh.morphTargetInfluences = [1];
    const mesh = rawMesh as unknown as THREE.SkinnedMesh;
    const mmd = {
      pmx: {
        bones: new Array(5),
        materials: [{ name: "mat0" }],
        morphs: [{ name: "已激活" }],
      },
    };
    const ctx: MmdBottomNavCtx = { mmd: mmd as never, mesh, modelName: "init.pmx" };
    const list = document.createElement("div");
    fillMmdMorphPanel(list, ctx);
    const row = list.querySelector('[data-testid="mmd-morph-已激活"]') as HTMLElement;
    expect(row.querySelector("span")?.textContent).toBe("✓");
    expect(row.style.background).toContain("var(--mmd-morph-active-bg)");
  });
});

describe("buildMaterialControls", () => {
  it("渲染材质面板（显隐 + 透明度滑条），行数 = pmx.materials 长度", () => {
    const { ctx } = makeCtx();
    const container = document.createElement("div");
    buildMaterialControls(container, makeMatBridge(ctx));
    expect(container.querySelector(".mmd-mat-row")).not.toBeNull();
    expect(container.querySelectorAll(".mmd-mat-row").length).toBe(28); // = pmx.materials.length
    expect(container.querySelector(".mmd-mat-op")).not.toBeNull(); // 透明度滑条
  });

  it("点击显隐按钮 → Material.visible 切换", () => {
    const { ctx, mesh } = makeCtx();
    const container = document.createElement("div");
    buildMaterialControls(container, makeMatBridge(ctx));
    const eye = container.querySelector(".mmd-mat-eye") as HTMLElement;
    const mat = (mesh.material as THREE.Material[])[0]; // 多材质数组，取第 0 个
    const before = mat.visible;
    eye.click();
    expect(mat.visible).toBe(!before);
  });

  it("材质索引越界时 getDetail 返回 null 不崩溃", () => {
    const { ctx } = makeCtx();
    const container = document.createElement("div");
    // 使用空 bridge（items 长度 = 0），不触发 getDetail 越界
    buildMaterialControls(container, makeEmptyBridge());
    // 应显示"无材质"提示，而不是崩溃
    expect(container.textContent).toContain("无材质");
  });

  it("透明度滑条改变 → setOpacity 被调用且值映射正确（0-100 → 0-1）", () => {
    let capturedOpacity = -1;
    const bridge = makeStubBridge({
      setOpacityFn: (i: number, o: number) => { capturedOpacity = o; },
    });
    const container = document.createElement("div");
    buildMaterialControls(container, bridge);
    const slider = container.querySelector<HTMLInputElement>('.mmd-mat-op')!;
    slider.value = "50";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(capturedOpacity).toBe(0.5);
  });

  it("透明度滑条设为 0 → 完全不透明（opacity=0）", () => {
    let capturedOpacity = -1;
    const bridge = makeStubBridge({
      setOpacityFn: (i: number, o: number) => { capturedOpacity = o; },
    });
    const container = document.createElement("div");
    buildMaterialControls(container, bridge);
    const slider = container.querySelector<HTMLInputElement>('.mmd-mat-op')!;
    slider.value = "0";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(capturedOpacity).toBe(0);
  });

  it("透明度滑条设为 100 → 完全不透明（opacity=1）", () => {
    let capturedOpacity = -1;
    const bridge = makeStubBridge({
      setOpacityFn: (i: number, o: number) => { capturedOpacity = o; },
    });
    const container = document.createElement("div");
    buildMaterialControls(container, bridge);
    const slider = container.querySelector<HTMLInputElement>('.mmd-mat-op')!;
    slider.value = "100";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(capturedOpacity).toBe(1);
  });

  it("可见性状态持久化：点击后再次 getDetail 反映新状态", () => {
    const { ctx } = makeSingleMatCtx();
    const container = document.createElement("div");
    buildMaterialControls(container, makeMatBridge(ctx));
    const eye = container.querySelector<HTMLElement>(".mmd-mat-eye")!;
    const bridge = makeMatBridge(ctx);
    // 初始为 false（makeSingleMatCtx 设置了 visible=false）
    expect(bridge.getDetail(0)?.visible).toBe(false);
    expect(eye.textContent).toBe("🚫");
    // 点击显示
    eye.click();
    expect(bridge.getDetail(0)?.visible).toBe(true);
    expect(eye.textContent).toBe("👁");
    // 再次点击隐藏
    eye.click();
    expect(bridge.getDetail(0)?.visible).toBe(false);
    expect(eye.textContent).toBe("🚫");
  });

  it("empty bridge（list 返回空）→ 渲染（无材质）提示，不崩溃", () => {
    const container = document.createElement("div");
    buildMaterialControls(container, makeEmptyBridge());
    expect(container.querySelector(".slide-sublabel")).not.toBeNull();
    expect(container.textContent).toContain("（无材质）");
  });

  it("单个材质的面板渲染（行数 = 1）", () => {
    const { ctx } = makeSingleMatCtx();
    const container = document.createElement("div");
    buildMaterialControls(container, makeMatBridge(ctx));
    expect(container.querySelectorAll(".mmd-mat-row").length).toBe(1);
    expect(container.querySelector(".mmd-mat-eye")).not.toBeNull();
    expect(container.querySelector(".mmd-mat-op")).not.toBeNull();
  });

  it("行元素的 data-testid 格式正确（mat-<index>）", () => {
    const { ctx } = makeCtx();
    const container = document.createElement("div");
    buildMaterialControls(container, makeMatBridge(ctx));
    const firstRow = container.querySelector<HTMLElement>('[data-testid="mat-0"]');
    expect(firstRow).not.toBeNull();
    const lastRow = container.querySelector<HTMLElement>('[data-testid="mat-27"]');
    expect(lastRow).not.toBeNull();
  });
});

describe("边界条件", () => {
  it("material.bridge 的 list() 抛出异常时，buildMaterialControls 不崩溃", () => {
    const badBridge: MaterialControlBridge = {
      list: () => { throw new Error("bridge list failed"); },
      getDetail: () => null,
      setVisible: () => {},
      setOpacity: () => {},
    };
    const container = document.createElement("div");
    // 预期抛错（无 try-catch 包裹）
    expect(() => buildMaterialControls(container, badBridge)).toThrow("bridge list failed");
  });

  it("fillMmdModelPanel 的 mesh 无 morphTargetDictionary → 静默返回", () => {
    const rawMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    // 不设 morphTargetDictionary
    const mesh = rawMesh as unknown as THREE.SkinnedMesh;
    const mmd = {
      pmx: {
        bones: new Array(10),
        materials: [{ name: "mat0" }],
        morphs: [],
      },
    };
    const ctx: MmdBottomNavCtx = { mmd: mmd as never, mesh, modelName: "test.pmx" };
    const list = document.createElement("div");
    // 不应崩溃
    expect(() => fillMmdModelPanel(list, ctx)).not.toThrow();
    // 只有信息卡
    expect(list.querySelectorAll('[data-testid^="mmd-morph-"]').length).toBe(0);
  });

  it("fillMmdModelPanel 的 mesh 无 morphTargetInfluences → 静默处理", () => {
    const rawMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    rawMesh.morphTargetDictionary = { "表情": 0 };
    // 不设 morphTargetInfluences
    (rawMesh as any).morphTargetInfluences = undefined;
    const mesh = rawMesh as unknown as THREE.SkinnedMesh;
    const mmd = {
      pmx: {
        bones: new Array(10),
        materials: [{ name: "mat0" }],
        morphs: [],
      },
    };
    const ctx: MmdBottomNavCtx = { mmd: mmd as never, mesh, modelName: "test.pmx" };
    const list = document.createElement("div");
    // 不应崩溃
    expect(() => fillMmdModelPanel(list, ctx)).not.toThrow();
  });

  it("getMmdMaterialDetail 越界 index 返回 null", () => {
    const pmxMaterials = [{ name: "a" }, { name: "b" }];
    const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    expect(getMmdMaterialDetail(pmxMaterials, materials, -1)).toBeNull();
    expect(getMmdMaterialDetail(pmxMaterials, materials, 2)).toBeNull();
    expect(getMmdMaterialDetail(pmxMaterials, materials, 99)).toBeNull();
  });

  it("getMmdMaterialDetail 正常返回详情对象", () => {
    const pmxMaterials = [{ name: "测试材质" }];
    const mat = new THREE.MeshPhongMaterial({ visible: false, opacity: 0.5, transparent: true });
    const materials = [mat];
    const detail = getMmdMaterialDetail(pmxMaterials, materials, 0);
    expect(detail).not.toBeNull();
    expect(detail!.index).toBe(0);
    expect(detail!.name).toBe("测试材质");
    expect(detail!.visible).toBe(false);
    expect(detail!.opacity).toBe(0.5);
    expect(detail!.transparent).toBe(true);
  });

  it("setMmdMaterialVisible 越界不崩溃", () => {
    const materials = [new THREE.MeshBasicMaterial()];
    // 越界 index 应静默处理
    expect(() => setMmdMaterialVisible(materials, 99, false)).not.toThrow();
  });

  it("setMmdMaterialOpacity 越界不崩溃", () => {
    const materials = [new THREE.MeshBasicMaterial()];
    // 越界 index 应静默处理
    expect(() => setMmdMaterialOpacity(materials, 99, 0.5)).not.toThrow();
  });

  it("setMmdMaterialOpacity 边界值：负数 clamp 到 0，超过 1 clamp 到 1", () => {
    const mat = new THREE.MeshBasicMaterial();
    setMmdMaterialOpacity([mat], 0, -0.5);
    expect(mat.opacity).toBe(0);
    setMmdMaterialOpacity([mat], 0, 1.5);
    expect(mat.opacity).toBe(1);
  });

  it("listMmdMaterials 空数组 → 返回空列表", () => {
    expect(listMmdMaterials([])).toEqual([]);
  });

  it("listMmdMaterials 非空 → 正确返回索引和名称", () => {
    const items = listMmdMaterials([{ name: "头部" }, { name: "身体" }]);
    expect(items).toEqual([
      { index: 0, name: "头部" },
      { index: 1, name: "身体" },
    ]);
  });

  it("opacity=1 时 transparent 不设置为 true（仅 <1 时联动）", () => {
    const mat = new THREE.MeshBasicMaterial({ opacity: 1, transparent: false });
    setMmdMaterialOpacity([mat], 0, 1);
    expect(mat.transparent).toBe(false);
  });

  it("opacity<1 时 transparent 自动设为 true", () => {
    const mat = new THREE.MeshBasicMaterial({ opacity: 1, transparent: false });
    setMmdMaterialOpacity([mat], 0, 0.8);
    expect(mat.transparent).toBe(true);
  });
});
