// @vitest-environment node
// ===== GroundCapability 测试（ADR-196 迁移至 envState）=====
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { GroundCapability } from "./ground-capability.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { PreviewSnapshot } from "@/preview-3d/state/preview-paths.ts";
import type { GroundCanvasStyle, GroundSurfaceMode } from "./ground-surface-spec.ts";

/** 旧单枚举 → 两轴便捷设置（测试沿用旧模式名，内部拆轴） */
function setMode(cap: GroundCapability, mode: GroundSurfaceMode): void {
  const canvasModes: GroundSurfaceMode[] = ["plain", "grid", "checker", "stripes", "diamond", "marble"];
  if (canvasModes.includes(mode)) {
    cap.setSourceKind("canvas");
    cap.setCanvasStyle(mode as GroundCanvasStyle);
  } else {
    // none / solid / texture 直接是合法 sourceKind
    cap.setSourceKind(mode as "none" | "solid" | "texture");
  }
}

describe("GroundCapability", () => {
  beforeEach(() => { resetEnvState(); });

  it("apply 挂入场景（GridHelper + 名称 ysm-ground），默认可见", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    expect(cap.getVisible()).toBe(true);
    cap.apply();
    const grid = scene.getObjectByName("ysm-ground") as THREE.GridHelper | undefined;
    expect(grid).toBeDefined();
    expect(grid).toBeInstanceOf(THREE.GridHelper);
    expect(grid!.visible).toBe(true);
  });

  it("setVisible 切换 + getVisible 同步", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setVisible(false);
    expect(cap.getVisible()).toBe(false);
    expect((scene.getObjectByName("ysm-ground") as THREE.Object3D).visible).toBe(false);
    cap.setVisible(true);
    expect(cap.getVisible()).toBe(true);
  });

  it("setEnvState 覆盖生效", () => {
    setEnvState({ groundSize: 100, groundVisible: false }, { source: 'manual' });
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    const grid = scene.getObjectByName("ysm-ground") as THREE.GridHelper;
    expect(grid).toBeDefined();
    expect(grid.visible).toBe(false);
    expect(envState.groundSize).toBe(100);
  });

  it("dispose 移除网格并释放几何/材质（重复 dispose 幂等）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    const grid = scene.getObjectByName("ysm-ground") as THREE.GridHelper;
    expect(grid).toBeDefined();
    cap.dispose();
    expect(scene.getObjectByName("ysm-ground")).toBeUndefined();
    cap.dispose();
  });
});

describe("GroundCapability — 表面材质层（spec 单源）", () => {
  beforeEach(() => { resetEnvState(); });

  it("默认 sourceKind=none：apply 后 surface 存在但不可见", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    const surf = scene.getObjectByName("ysm-ground-surface");
    expect(surf).toBeDefined();
    expect(surf!.visible).toBe(false);
  });

  it("setSourceKind/CanvasStyle(checker) → 可见 + 材质挂 DataTexture + repeat=80/10/1", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    setMode(cap, "checker");
    const surf = scene.getObjectByName("ysm-ground-surface") as THREE.Mesh;
    expect(surf.visible).toBe(true);
    const mat = surf.material as THREE.MeshStandardMaterial;
    expect(mat.map).toBeInstanceOf(THREE.DataTexture);
    expect(mat.map!.repeat.x).toBeCloseTo(8);
  });

  it("setEnabled 变更须重算 surface.visible 门控（与 setVisible 路径对称）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    setMode(cap, "checker");
    const surf = scene.getObjectByName("ysm-ground-surface")!;
    expect(surf.visible).toBe(true);

    cap.setEnabled(false);
    setMode(cap, "grid");
    cap.setEnabled(true);
    expect(scene.getObjectByName("ysm-ground-surface")).toBeDefined();
    expect(surf.visible).toBe(true);
  });

  it("structural 变化重建（map 新实例）；appearance 变化原地（map 引用不变）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    setMode(cap, "grid");
    const surf = scene.getObjectByName("ysm-ground-surface") as THREE.Mesh;
    const mat0 = surf.material as THREE.MeshStandardMaterial;
    const map0 = mat0.map;
    cap.setMatScale(2.5);
    const mat1 = (scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat1.map).toBe(map0);
    expect(mat1.map!.repeat.x).toBeCloseTo(3.2);
    expect(mat1.opacity).toBe(1);
    cap.setMatColor(0xff0000);
    const mat2 = (scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat2.map).not.toBe(map0);
  });

  it("不透明度走原地路径且驱动 transparent/depthWrite", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    setMode(cap, "plain");
    cap.setMatOpacity(0.4);
    const mat = (scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.opacity).toBeCloseTo(0.4);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    cap.setMatOpacity(1);
    expect(mat.transparent).toBe(false);
    expect(mat.depthWrite).toBe(true);
  });

  it("显隐跟随：setVisible(false) 隐藏三层，恢复后 surface 跟随", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    setMode(cap, "solid");
    cap.setVisible(false);
    expect((scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).visible).toBe(false);
    cap.setVisible(true);
    expect((scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).visible).toBe(true);
  });

  it("acceptLoadedTexture：进 texture 模式、缓存独立于材质、hint 返回文件名", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    const tex = new THREE.DataTexture(new Uint8Array(4 * 4), 2, 2);
    cap.acceptLoadedTexture(tex, "wood.png");
    const surf = scene.getObjectByName("ysm-ground-surface") as THREE.Mesh;
    const mat = surf.material as THREE.MeshStandardMaterial;
    expect(surf.visible).toBe(true);
    expect(mat.map).toBe(tex);
    const btnNode = cap.getMenuNodes()[1]!.children!.find((c) => c.id === "cap-group-ground-texture-buttons")!;
    const btn = (typeof btnNode.controls === "function" ? btnNode.controls() : btnNode.controls)![0]!;
    expect(btn!.button!.getHint!()).toContain("wood.png");
  });

  it("clearCustomTexture：释放缓存并回退 canvas/plain（ADR-249 不再改写为语义无关模式）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    const tex = new THREE.DataTexture(new Uint8Array(4 * 4), 2, 2);
    cap.acceptLoadedTexture(tex, "wood.png");
    cap.clearCustomTexture();
    expect(cap.getSourceKind()).toBe("canvas");
    expect(cap.getCanvasStyle()).toBe("plain");
    const mat = (scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.map).not.toBe(tex);
  });

  it("texture 模式无缓存时占位回退（纯色像素），加载后自动换真图", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setSourceKind("texture");
    const mat = (scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.map).toBeDefined();
    const tex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    cap.acceptLoadedTexture(tex, "a.png");
    expect(((scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).material as THREE.MeshStandardMaterial).map).toBe(tex);
  });

  it("dispose 移除 surface 并幂等；customTex 一并释放", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.acceptLoadedTexture(new THREE.DataTexture(new Uint8Array(4 * 4), 2, 2), "x.png");
    cap.dispose();
    expect(scene.getObjectByName("ysm-ground-surface")).toBeUndefined();
    cap.dispose();
  });

  it("saveState/loadState 往返 mat 字段；texture 来源不再被静默降级（ADR-249 §2.5）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    setMode(cap, "checker");
    cap.setMatScale(3);
    cap.saveState();
    resetEnvState();
    const cap2 = new GroundCapability({ scene });
    cap2.loadState();
    expect(cap2.getSourceKind()).toBe("canvas");
    expect(cap2.getCanvasStyle()).toBe("checker");
    expect(cap2.getMatScale()).toBe(3);

    // ADR-249 §2.5 第 2 条：旧行为把 texture 改写成 plain——新契约保留来源。
    const cap3 = new GroundCapability({ scene });
    cap3.acceptLoadedTexture(new THREE.DataTexture(new Uint8Array(16), 2, 2), "t.png");
    cap3.saveState();
    resetEnvState();
    const cap4 = new GroundCapability({ scene });
    cap4.loadState();
    expect(cap4.getSourceKind()).toBe("texture");
  });

  it("loadState 非法 canvasStyle/legacy 脏数据回退安全默认", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    localStorage.setItem("ysm-scene-cap-ground", JSON.stringify({ enabled: true, visible: true, matSource: "hack" }));
    cap.loadState();
    expect(cap.getSourceKind()).toBe("none");
    localStorage.removeItem("ysm-scene-cap-ground");
  });

  describe("subscribe（局部刷新通知）", () => {
    it("setSourceKind/setCanvasStyle 各触发 1 次订阅者（拆轴后独立 setter），同值早退不 notify，unsub 后停止", () => {
      const scene = new THREE.Scene();
      const cap = new GroundCapability({ scene });
      let calls = 0;
      const unsub = cap.subscribe!(() => { calls++; });
      // 从默认 none → canvas/grid：两轴各触发一次（拆轴后两个独立 envState 字段，
      // 各 1 次；旧单枚举时代合并为 1 次）
      cap.setSourceKind("canvas");
      cap.setCanvasStyle("grid");
      expect(calls).toBe(2);
      // 同值早退：不应再 notify
      cap.setSourceKind("canvas");
      cap.setCanvasStyle("grid");
      expect(calls).toBe(2);
      // appearance 变化走 refreshSurface 单路径落地、不 notify（订阅面 = 来源/样式切换，
      // 局部刷新据此重建菜单；matColor 不触发）
      cap.setMatColor(0xff0000);
      expect(calls).toBe(2);
      // 取消订阅后不再 notify
      unsub();
      cap.setSourceKind("none");
      expect(calls).toBe(2);
    });
  });
});

describe("GroundCapability — 启用切换", () => {
  beforeEach(() => { resetEnvState(); });

  it("setEnabled(false) 把 grid/surface 从场景移除；再启用重新挂入", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    expect(scene.getObjectByName("ysm-ground")).toBeDefined();
    cap.setEnabled(false);
    expect(scene.getObjectByName("ysm-ground")).toBeUndefined();
    expect(scene.getObjectByName("ysm-ground-surface")).toBeUndefined();
    cap.setEnabled(true);
    expect(scene.getObjectByName("ysm-ground")).toBeDefined();
    expect(scene.getObjectByName("ysm-ground-surface")).toBeDefined();
  });

  it("disabled 时移除挂载并同步 surface.visible 门控", () => {
    const scene = new THREE.Scene();
    setEnvState({ groundSourceKind: "canvas", groundCanvasStyle: "checker" }, { source: 'manual' });
    const cap = new GroundCapability({ scene });
    cap.apply();
    const surface = (cap as unknown as { surface: THREE.Mesh }).surface;
    expect(surface.visible).toBe(true);
    cap.setEnabled(false);
    expect(surface.parent).toBeNull();
    expect(surface.visible).toBe(false);
    cap.setEnabled(true);
    expect(surface.parent).toBe(scene);
    expect(surface.visible).toBe(true);
  });
});

describe("GroundCapability — 材质参数 setter 批量", () => {
  beforeEach(() => { resetEnvState(); });

  it("全部 setter 落地 envState（含 clamp/取模）且 getter 回读一致", () => {
    const scene = new THREE.Scene();
    setEnvState({ groundSourceKind: "canvas", groundCanvasStyle: "checker" }, { source: 'manual' });
    const cap = new GroundCapability({ scene });
    cap.setMatLineColor(0x112233);
    cap.setMatGridSize(16.7);
    cap.setMatGridSize(1);
    cap.setMatOpacity(2);
    cap.setMatOpacity(-1);
    cap.setMatScale(100);
    cap.setMatScale(0.1);
    cap.setMatRotation(450);
    cap.setMatRotation(-90);
    cap.setMatRoughness(5);
    cap.setMatMetalness(-2);
    cap.setMatColor2(0xaabbcc);
    cap.setMatDensity(20);
    cap.setMatAngle(400);

    expect(cap.getMatOpacity()).toBe(0);
    expect(cap.getMatScale()).toBe(0.25);
    expect(cap.getMatRotation()).toBe(270);
    expect(cap.getMatRoughness()).toBe(1);
    expect(cap.getMatMetalness()).toBe(0);
    expect(cap.getMatColor2()).toBe(0xaabbcc);
    expect(cap.getMatDensity()).toBe(8);
    expect(cap.getMatAngle()).toBe(40);
    expect(envState.groundMatLineColor).toBe(0x112233);
    expect(envState.groundMatGridSize).toBe(2);
  });

  it("acceptLoadedTexture 两次：旧缓存被释放，材质/hint 换新图", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    const tex1 = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    const tex2 = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    const disposeSpy = vi.spyOn(tex1, "dispose");
    cap.acceptLoadedTexture(tex1, "a.png");
    cap.acceptLoadedTexture(tex2, "b.png");
    expect(disposeSpy).toHaveBeenCalled();
    const mat = (scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.map).toBe(tex2);
    const hintNode = cap.getMenuNodes()[1]!.children!.find((c) => c.id === "cap-group-ground-texture-buttons")!;
    const hint = (typeof hintNode.controls === "function" ? hintNode.controls() : hintNode.controls)![0]!.button!.getHint!();
    expect(hint).toContain("b.png");
  });

  it("dispose 时释放程序化表面纹理（非 custom 缓存归属）", () => {
    const scene = new THREE.Scene();
    setEnvState({ groundSourceKind: "canvas", groundCanvasStyle: "checker" }, { source: 'manual' });
    const cap = new GroundCapability({ scene });
    cap.apply();
    const surfaceTex = (cap as unknown as { surfaceTex: THREE.Texture }).surfaceTex;
    expect(surfaceTex).not.toBeNull();
    const disposeSpy = vi.spyOn(surfaceTex!, "dispose");
    cap.dispose();
    expect(disposeSpy).toHaveBeenCalled();
  });
});

describe("GroundCapability — 菜单控件联动", () => {
  beforeEach(() => { resetEnvState(); });

  it("visible toggle 与 来源/样式 select 联动（节点 control 闭包）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const nodes = cap.getMenuNodes();
    const visibleNode = nodes[0]!;
    visibleNode.control!.set!(false);
    expect(cap.getVisible()).toBe(false);
    expect(visibleNode.control!.get!(undefined)).toBe(false);
    const sourceNode = nodes[1]!.children!.find((c) => c.id === "ground-mat-source")!;
    sourceNode.control!.set!("canvas");
    expect(cap.getSourceKind()).toBe("canvas");
    expect(sourceNode.control!.get!(undefined)).toBe("canvas");
    const styleNode = nodes[1]!.children!.find((c) => c.id === "ground-mat-canvas-style")!;
    styleNode.control!.set!("stripes");
    expect(cap.getCanvasStyle()).toBe("stripes");
    expect(styleNode.control!.get!(undefined)).toBe("stripes");
  });

  it("材质参数控件 setValue/getValue 全联动（canvas 模式下可见，节点 control 闭包）", () => {
    const scene = new THREE.Scene();
    setEnvState({ groundSourceKind: "canvas", groundCanvasStyle: "checker" }, { source: 'manual' });
    const cap = new GroundCapability({ scene });
    const folder = cap.getMenuNodes()[1]!;
    const by = (id: string) => folder.children!.find((c) => c.id === id)!;
    by("ground-mat-color").control!.set!(0xff8800);
    by("ground-mat-color2").control!.set!(0x00ff88);
    by("ground-mat-line-color").control!.set!(0x445566);
    by("ground-mat-grid-size").control!.set!(12);
    by("ground-mat-density").control!.set!(4);
    by("ground-mat-angle").control!.set!(45);
    by("ground-mat-opacity").control!.set!(0.5);
    by("ground-mat-scale").control!.set!(2);
    by("ground-mat-rotation").control!.set!(30);
    by("ground-mat-roughness").control!.set!(0.8);
    by("ground-mat-metalness").control!.set!(0.2);
    expect(by("ground-mat-color").control!.get!(undefined)).toBe(0xff8800);
    expect(by("ground-mat-color2").control!.get!(undefined)).toBe(0x00ff88);
    expect(by("ground-mat-line-color").control!.get!(undefined)).toBe(0x445566);
    expect(by("ground-mat-grid-size").control!.get!(undefined)).toBe(12);
    expect(by("ground-mat-density").control!.get!(undefined)).toBe(4);
    expect(by("ground-mat-angle").control!.get!(undefined)).toBe(45);
    expect(by("ground-mat-opacity").control!.get!(undefined)).toBe(0.5);
    expect(by("ground-mat-scale").control!.get!(undefined)).toBe(2);
    expect(by("ground-mat-rotation").control!.get!(undefined)).toBe(30);
    expect(by("ground-mat-roughness").control!.get!(undefined)).toBe(0.8);
    expect(by("ground-mat-metalness").control!.get!(undefined)).toBe(0.2);
  });

  it("button 控件：getValue null、setValue no-op、visibleWhen 随来源切换（controls 通道节点）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const btnNode = cap.getMenuNodes()[1]!.children!.find((c) => c.id === "cap-group-ground-texture-buttons")!;
    const btnControls = (typeof btnNode.controls === "function" ? btnNode.controls() : btnNode.controls)!;
    const pick = btnControls[0]!;
    const clear = btnControls[1]!;
    const snap = (src: string) => ({ "env.groundSourceKind": src } as Partial<PreviewSnapshot>);
    expect(pick.visibleWhen?.(snap("none"))).toBe(false);
    expect(clear.visibleWhen?.(snap("none"))).toBe(false);
    expect(pick.getValue()).toBeNull();
    expect(() => pick.setValue("x")).not.toThrow();
    expect(() => clear.setValue("x")).not.toThrow();
    expect(pick.visibleWhen?.(snap("texture"))).toBe(true);
    expect(clear.visibleWhen?.(snap("texture"))).toBe(true);
    cap.setSourceKind("texture");
    clear.button!.action!();
    expect(cap.getSourceKind()).toBe("canvas");
    expect(cap.getCanvasStyle()).toBe("plain");
  });

  it("选择贴图按钮 action 触发文件选择器（mock input，node 环境，controls 通道节点）", () => {
    const fakeInput = {
      type: "",
      accept: "",
      onchange: null as unknown,
      click(): void {},
    };
    const stub = vi.stubGlobal("document", {
      createElement: (tag: string) => (tag === "input" ? fakeInput : null),
    });
    try {
      const scene = new THREE.Scene();
      setEnvState({ groundSourceKind: "texture" }, { source: 'manual' });
      const cap = new GroundCapability({ scene });
      const btnNode = cap.getMenuNodes()[1]!.children!.find((c) => c.id === "cap-group-ground-texture-buttons")!;
      const pick = (typeof btnNode.controls === "function" ? btnNode.controls() : btnNode.controls)![0]!;
      expect(() => pick.button!.action!()).not.toThrow();
      expect(fakeInput.type).toBe("file");
      expect(fakeInput.accept).toBe("image/*");
    } finally {
      stub.unstubAllGlobals();
    }
  });
});

describe("GroundCapability — getMenuNodes（ADR-195 刀2 cap 直产节点）", () => {
  beforeEach(() => { resetEnvState(); });

  it("完整树 = ground-visible 平铺 toggle + 材质组 folder", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.kind).toBe("toggle");
    expect(nodes[0]!.id).toBe("ground-visible");
    nodes[0]!.control!.set!(false);
    expect(cap.getVisible()).toBe(false);
    const folder = nodes[1]!;
    expect(folder.kind).toBe("folder");
    expect(folder.labelKey).toBe("preview.groundGroupMaterial");
  });

  it("材质 folder 混排原生节点 + controls 通道（texture/clear button）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const folder = cap.getMenuNodes()[1]!;
    const source = folder.children!.find((c) => c.id === "ground-mat-source")!;
    expect(source.kind).toBe("select");
    source.control!.set!("canvas");
    expect(cap.getSourceKind()).toBe("canvas");
    const style = folder.children!.find((c) => c.id === "ground-mat-canvas-style")!;
    style.control!.set!("checker");
    expect(cap.getCanvasStyle()).toBe("checker");
    const btnNode = folder.children!.find((c) => c.id === "cap-group-ground-texture-buttons")!;
    expect(btnNode.kind).toBe("controls");
    const btnControls = typeof btnNode.controls === "function" ? btnNode.controls() : btnNode.controls;
    expect(btnControls!.map((c) => c.id)).toEqual(["ground-mat-texture", "ground-mat-clear"]);
    expect(btnControls![0]!.visibleWhen?.({ "env.groundSourceKind": "texture" })).toBe(true);
    expect(btnControls![0]!.visibleWhen?.({ "env.groundSourceKind": "none" })).toBe(false);
  });

  it("原生 color/slider 节点读写闭包直连 cap", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const folder = cap.getMenuNodes()[1]!;
    const color = folder.children!.find((c) => c.id === "ground-mat-color")!;
    expect(color.kind).toBe("color");
    color.control!.set!(0xff8800);
    expect(cap.getMatColor()).toBe(0xff8800);
    const density = folder.children!.find((c) => c.id === "ground-mat-density")!;
    density.control!.set!(4);
    expect(cap.getMatDensity()).toBe(4);
  });

  it("visibleWhen 谓词挂原生节点（canvas 模式下材质控件可见；none 隐藏）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const folder = cap.getMenuNodes()[1]!;
    const color = folder.children!.find((c) => c.id === "ground-mat-color")!;
    // ADR-249 §2.1：由两轴派生模式，canvas/checker 下可见
    expect(color.visibleWhen?.({ "env.groundSourceKind": "canvas", "env.groundCanvasStyle": "grid" })).toBe(true);
    expect(color.visibleWhen?.({ "env.groundSourceKind": "none" })).toBe(false);
  });
});
