// ===== mmd-controls 菜单面板测试（ADR-076 v2 Phase 2：底部导航收编为根菜单面板填充）=====
// 覆盖：fillMmdModelPanel（信息卡）、fillMmdMorphPanel（表情列表 + morph 权重切换）、
// buildMaterialControls（材质显隐 + 透明度）。切换模型/相机视图归 core 根菜单
// （switch/camera 项），此处不再覆盖。morph 已拆独立菜单项（对齐材质折叠模式，2026-08-28）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  fillMmdModelPanel,
  mmdModelInfoNodes,
  mmdShotNodes,
  playNodes,
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

// ---- 测试辅助工具函数 ----

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

describe("mmdModelInfoNodes（P4-B-1 声明式节点）", () => {
  it("产出 2 行 field：名称 + 骨骼/材质/表情计数，纯数据零 DOM", () => {
    const { ctx } = makeCtx();
    const nodes = mmdModelInfoNodes(ctx);
    expect(nodes.length).toBe(2);
    expect(nodes[0]).toMatchObject({ id: "mmd-model-name", kind: "field", value: "子言.pmx" });
    expect(nodes[1]).toMatchObject({ id: "mmd-model-overview", kind: "field" });
    expect(nodes[1].value).toContain("364"); // 骨骼
    expect(nodes[1].value).toContain("28");  // 材质
    expect(nodes[1].value).toContain("55");  // 表情
    // 纯数据：不碰 DOM（与原 fillMmdModelPanel 的命令式渲染形成对照）
    expect(document.body.innerHTML).toBe("");
  });

  it("不同 modelName 正确透出到 value", () => {
    const names = ["初音ミク.pmx", "Miku.pmd"];
    for (const name of names) {
      const { ctx } = makeCtxWithName(name);
      expect(mmdModelInfoNodes(ctx)[0].value).toBe(name);
    }
  });

  it("[doc:adr-127] zip 多候选：model 面板前置 select（列出全部 pmx），选中 → switchTo 虚拟路径", () => {
    const { ctx } = makeCtx();
    const switchTo = vi.fn();
    const nodes = mmdModelInfoNodes({
      ...ctx,
      zipModelCandidates: ["/repo/multi.zip!/miku.pmx", "/repo/multi.zip!/zuko.pmx"],
      switchTo,
    });
    // 首节点 = select（多候选时）
    const sel = nodes[0];
    expect(sel.id).toBe("mmd-model-select");
    expect(sel.kind).toBe("select");
    expect(sel.control?.options?.map((o) => o.value)).toEqual([
      "/repo/multi.zip!/miku.pmx",
      "/repo/multi.zip!/zuko.pmx",
    ]);
    // 选中切换 → switchTo(候选虚拟路径)
    sel.control?.set?.("/repo/multi.zip!/zuko.pmx");
    expect(switchTo).toHaveBeenCalledWith("/repo/multi.zip!/zuko.pmx");
  });

  it("[doc:adr-127] 非 zip（无候选）→ 无 select，保持 2 行 field", () => {
    const { ctx } = makeCtx();
    const nodes = mmdModelInfoNodes(ctx);
    expect(nodes.some((n) => n.kind === "select")).toBe(false);
    expect(nodes.length).toBe(2);
  });
});

describe("mmdShotNodes（P4-B-1 声明式节点）", () => {
  it("6 个 button 节点，id 稳定 + legacyTestId 兼容，action 触发截图", () => {
    const { ctx } = makeCtx();
    const screenshotFn = vi.fn(() => Promise.resolve("b64"));
    const nodes = mmdShotNodes(ctx, screenshotFn);
    expect(nodes.length).toBe(6);
    expect(nodes.map((n) => n.id)).toEqual([
      "mmd-shot-current", "mmd-shot-front", "mmd-shot-45", "mmd-shot-side", "mmd-shot-back45", "mmd-shot-all",
    ]);
    expect(nodes.every((n) => n.kind === "button")).toBe(true);
    // legacyTestId 兼容旧 e2e 选择器（shot-<key>）
    expect(nodes[0].legacyTestId).toBe("shot-current");
    expect(nodes[0].icon).toBe("📷");
  });

  it("screenshotFn 为 null → 返回空数组（面板不渲染，与 fillMmdShotPanel 一致）", () => {
    const { ctx } = makeCtx();
    expect(mmdShotNodes(ctx, null)).toEqual([]);
  });
});

describe("playNodes（[doc:adr-126-p5-收尾] 播放面板声明式节点）", () => {
  function makeBridge(overrides: Partial<import("./mmd-controls.ts").MmdPlayBridge> = {}) {
    const clips = [{ label: "a" }, { label: "b" }];
    let playing = false;
    let idx = 0;
    return {
      clips,
      isPlaying: () => playing,
      toggle: () => { playing = !playing; },
      currentIndex: () => idx,
      select: (i: number) => { idx = i; },
      animDir: null,
      requestReload: vi.fn(),
      ...overrides,
    } as unknown as import("./mmd-controls.ts").MmdPlayBridge;
  }

  it("多动作：toggle（播放/暂停）+ select（动作），闭包读写 bridge", () => {
    const bridge = makeBridge();
    const nodes = playNodes(bridge);
    expect(nodes.map((n) => n.id)).toEqual(["play-toggle", "play-select"]);
    const toggle = nodes.find((n) => n.id === "play-toggle")!;
    const sel = nodes.find((n) => n.id === "play-select")!;
    // toggle 初始 off → set(true) 播放 → get true
    expect(toggle.control?.get?.(undefined)).toBe(false);
    toggle.control?.set?.(true);
    expect(toggle.control?.get?.(undefined)).toBe(true);
    // select 初始 0 → set("1") → bridge.select(1)
    expect(sel.control?.get?.(undefined)).toBe("0");
    sel.control?.set?.("1");
    expect(bridge.currentIndex()).toBe(1);
    expect(sel.control?.get?.(undefined)).toBe("1");
  });

  it("单动作：仅 toggle，无 select", () => {
    const bridge = makeBridge({ clips: [{ label: "only" }] });
    const nodes = playNodes(bridge);
    expect(nodes.map((n) => n.id)).toEqual(["play-toggle"]);
  });

  it("无动作：空态 field + 重新扫描 button（requestReload 触发）", () => {
    const bridge = makeBridge({ clips: [] });
    const nodes = playNodes(bridge);
    expect(nodes[0]).toMatchObject({ id: "play-empty", kind: "field" });
    expect(nodes[1]).toMatchObject({ id: "play-reload", kind: "button" });
    nodes[1].action!({ toast: vi.fn(), closeAllOverlays: vi.fn() });
    expect(bridge.requestReload).toHaveBeenCalled();
  });

  it("animDir 配置：追加路径提示 field", () => {
    const bridge = makeBridge({ animDir: "/custom/anim" });
    const nodes = playNodes(bridge);
    expect(nodes.some((n) => n.id === "play-dir")).toBe(true);
  });
});

describe("边界条件", () => {
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
