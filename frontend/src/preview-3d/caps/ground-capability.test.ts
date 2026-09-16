// @vitest-environment node
// ===== GroundCapability 测试（ADR-196 迁移至 envState）=====
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { GroundCapability } from "./ground-capability.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { PreviewSnapshot } from "@/preview-3d/state/preview-paths.ts";
import type { GroundCanvasStyle, GroundSurfaceMode } from "./ground-surface-spec.ts";
import {
  GROUND_MATERIAL_PRESETS,
  GROUND_MATERIAL_PRESET_IDS,
} from "./ground-surface-spec.ts";
import { GROUND_MATERIAL_PRESET_KEYS } from "./ground-capability.ts";

/** 便捷设置：材质值走 canvas 来源，none/solid/texture 直接设来源轴。
 *  ADR-252：图案不在表面模式里，图案请走 `setOverlayStyle`。 */
function setMode(cap: GroundCapability, mode: GroundSurfaceMode): void {
  if (mode === "plain" || mode === "marble" || mode === "sand" || mode === "grass") {
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

  it("setSourceKind/CanvasStyle(marble) → 可见 + 材质挂 DataTexture + repeat=80/10/1", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    setMode(cap, "marble");
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
    setMode(cap, "marble");
    const surf = scene.getObjectByName("ysm-ground-surface")!;
    expect(surf.visible).toBe(true);

    cap.setEnabled(false);
    setMode(cap, "sand");
    cap.setEnabled(true);
    expect(scene.getObjectByName("ysm-ground-surface")).toBeDefined();
    expect(surf.visible).toBe(true);
  });

  it("structural 变化重建（map 新实例）；appearance 变化原地（map 引用不变）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    setMode(cap, "sand");
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
    setMode(cap, "marble");
    cap.setMatScale(3);
    cap.saveState();
    resetEnvState();
    const cap2 = new GroundCapability({ scene });
    cap2.loadState();
    expect(cap2.getSourceKind()).toBe("canvas");
    expect(cap2.getCanvasStyle()).toBe("marble");
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

  // ADR-252 迁移契约：旧图案值必须进位叠加层，且线色/格数一并搬运（视觉等价）
  describe("ADR-252 迁移：旧几何图案进位叠加层", () => {
    afterEach(() => {
      localStorage.removeItem("ysm-scene-cap-ground");
    });

    it("ADR-249 时代存档：groundCanvasStyle=grid → plain + overlay=grid（线色/格数搬运）", () => {
      const scene = new THREE.Scene();
      localStorage.setItem(
        "ysm-scene-cap-ground",
        JSON.stringify({
          enabled: true,
          groundVisible: true,
          groundSourceKind: "canvas",
          groundCanvasStyle: "grid",
          groundMatLineColor: 0x5a4b3a,
          groundMatGridSize: 10,
          groundOverlay: "none",
        }),
      );
      const cap = new GroundCapability({ scene });
      cap.loadState();
      expect(cap.getSourceKind()).toBe("canvas");
      expect(cap.getCanvasStyle()).toBe("plain");
      expect(cap.getOverlayStyle()).toBe("grid");
      expect(cap.getOverlayColor()).toBe(0x5a4b3a);
      expect(cap.getOverlaySize()).toBe(10);
    });

    it.each(["grid", "checker", "stripes", "diamond"] as const)(
      "四种旧图案均进位叠加层：%s",
      (pattern) => {
        const scene = new THREE.Scene();
        localStorage.setItem(
          "ysm-scene-cap-ground",
          JSON.stringify({
            enabled: true,
            groundVisible: true,
            groundSourceKind: "canvas",
            groundCanvasStyle: pattern,
            groundMatLineColor: 0x123456,
            groundMatGridSize: 12,
          }),
        );
        const cap = new GroundCapability({ scene });
        cap.loadState();
        expect(cap.getCanvasStyle(), `${pattern} 底座应为 plain`).toBe("plain");
        expect(cap.getOverlayStyle(), `${pattern} 应进位叠加层`).toBe(pattern);
        expect(cap.getOverlayColor()).toBe(0x123456);
        expect(cap.getOverlaySize()).toBe(12);
      },
    );

    it("ADR-249 之前扁平枚举存档：matSource=checker → plain + overlay=checker", () => {
      const scene = new THREE.Scene();
      localStorage.setItem(
        "ysm-scene-cap-ground",
        JSON.stringify({
          enabled: true,
          visible: true,
          matSource: "checker",
          matLineColor: 0xabcdef,
          matGridSize: 16,
        }),
      );
      const cap = new GroundCapability({ scene });
      cap.loadState();
      expect(cap.getSourceKind()).toBe("canvas");
      expect(cap.getCanvasStyle()).toBe("plain");
      expect(cap.getOverlayStyle()).toBe("checker");
      expect(cap.getOverlayColor()).toBe(0xabcdef);
      expect(cap.getOverlaySize()).toBe(16);
    });

    it("材质存档不受影响：marble 原样保留，不引入叠加层", () => {
      const scene = new THREE.Scene();
      localStorage.setItem(
        "ysm-scene-cap-ground",
        JSON.stringify({
          enabled: true,
          groundVisible: true,
          groundSourceKind: "canvas",
          groundCanvasStyle: "marble",
          groundOverlay: "none",
        }),
      );
      const cap = new GroundCapability({ scene });
      cap.loadState();
      expect(cap.getCanvasStyle()).toBe("marble");
      expect(cap.getOverlayStyle()).toBe("none");
    });
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
      cap.setCanvasStyle("marble");
      expect(calls).toBe(2);
      // 同值早退：不应再 notify
      cap.setSourceKind("canvas");
      cap.setCanvasStyle("marble");
      expect(calls).toBe(2);
      // appearance 变化走 refreshSurface 单路径落地、不 notify（订阅面 = 来源/样式切换，
      // 局部刷新据此重建菜单；matColor 不触发）
      cap.setMatColor(0xff0000);
      expect(calls).toBe(2);
      // 取消订阅后不再 notify
      unsub();
      cap.setSourceKind("none");
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
    setEnvState({ groundSourceKind: "canvas", groundCanvasStyle: "marble" }, { source: 'manual' });
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
    // 用 plain（均匀填充，廉价）而非噪声材质：本用例只验 setter 钳位/回读，
    // 噪声材质每次 structural 变更都重建 512² × 3 次 valueNoise，会拖爆用例超时。
    setEnvState({ groundSourceKind: "canvas", groundCanvasStyle: "plain" }, { source: 'manual' });
    const cap = new GroundCapability({ scene });
    cap.setMatColor(0x112233);
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
    expect(envState.groundMatColor).toBe(0x112233);
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
    setEnvState({ groundSourceKind: "canvas", groundCanvasStyle: "marble" }, { source: 'manual' });
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
    // ADR-254：样式 select 的值 = **材质预设**；选它会一次性套用形状 + 配色
    const styleNode = nodes[1]!.children!.find((c) => c.id === "ground-mat-canvas-style")!;
    styleNode.control!.set!("grass");
    expect(cap.getMaterialPreset()).toBe("grass");
    expect(cap.getCanvasStyle()).toBe("grass");
    expect(styleNode.control!.get!(undefined)).toBe("grass");
  });

  it("材质参数控件 setValue/getValue 全联动（canvas 模式下可见，节点 control 闭包）", () => {
    const scene = new THREE.Scene();
    // 同前：用廉价材质，避免噪声重建拖爆超时（本用例只验控件闭包读写）
    setEnvState({ groundSourceKind: "canvas", groundCanvasStyle: "plain" }, { source: 'manual' });
    const cap = new GroundCapability({ scene });
    const folder = cap.getMenuNodes()[1]!;
    const by = (id: string) => folder.children!.find((c) => c.id === id)!;
    by("ground-mat-color").control!.set!(0xff8800);
    by("ground-mat-color2").control!.set!(0x00ff88);
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

  it("完整树 = ground-visible 平铺 toggle + 材质组 folder + 叠加层 folder", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const nodes = cap.getMenuNodes();
    expect(nodes).toHaveLength(3);
    expect(nodes[0]!.kind).toBe("toggle");
    expect(nodes[0]!.id).toBe("ground-visible");
    nodes[0]!.control!.set!(false);
    expect(cap.getVisible()).toBe(false);
    const folder = nodes[1]!;
    expect(folder.kind).toBe("folder");
    expect(folder.labelKey).toBe("preview.groundGroupMaterial");
    // ADR-249 §2.3 叠加层 folder（独立于材质组）
    const overlayFolder = nodes[2]!;
    expect(overlayFolder.kind).toBe("folder");
    expect(overlayFolder.id).toBe("cap-group-ground-overlay");
    expect(overlayFolder.labelKey).toBe("preview.groundGroupOverlay");
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
    style.control!.set!("marble");
    expect(cap.getCanvasStyle()).toBe("marble");
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
    // ADR-252：由两轴派生模式，canvas/marble 下可见
    expect(color.visibleWhen?.({ "env.groundSourceKind": "canvas", "env.groundCanvasStyle": "marble" })).toBe(true);
    expect(color.visibleWhen?.({ "env.groundSourceKind": "none" })).toBe(false);
  });
});

describe("GroundCapability — 叠加层（ADR-249 §2.3 独立格线层）", () => {
  beforeEach(() => { resetEnvState(); });

  it("默认 overlay=none：mesh 存在但不可见，无纹理", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    const overlay = scene.getObjectByName("ysm-ground-overlay") as THREE.Mesh;
    expect(overlay).toBeDefined();
    expect(overlay.visible).toBe(false);
    expect((overlay.material as THREE.MeshStandardMaterial).map).toBeNull();
  });

  it("setOverlayStyle(grid) → mesh 可见 + 透明材质 + DataTexture；层高在 surface 之上", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setOverlayStyle("grid");
    const overlay = scene.getObjectByName("ysm-ground-overlay") as THREE.Mesh;
    const surface = scene.getObjectByName("ysm-ground-surface") as THREE.Mesh;
    expect(overlay.visible).toBe(true);
    expect(overlay.position.y).toBeGreaterThan(surface.position.y);
    const mat = overlay.material as THREE.MeshStandardMaterial;
    expect(mat.map).toBeInstanceOf(THREE.DataTexture);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
  });

  it("叠加层与来源轴正交：solid 底层 + grid 叠加可共存", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setSourceKind("solid");
    cap.setOverlayStyle("grid");
    const overlay = scene.getObjectByName("ysm-ground-overlay") as THREE.Mesh;
    const surface = scene.getObjectByName("ysm-ground-surface") as THREE.Mesh;
    // 两者同时可见 —— 这正是旧互斥枚举下不可达的「纯色 + 格线」
    expect(surface.visible).toBe(true);
    expect(overlay.visible).toBe(true);
    const surfMat = surface.material as THREE.MeshStandardMaterial;
    expect(surfMat.map).toBeNull(); // solid 不产贴图
    expect((overlay.material as THREE.MeshStandardMaterial).map).toBeInstanceOf(THREE.DataTexture);
  });

  it("overlay 切回 none：纹理释放、mesh 隐藏", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setOverlayStyle("checker");
    const overlay = scene.getObjectByName("ysm-ground-overlay") as THREE.Mesh;
    const tex = (overlay.material as THREE.MeshStandardMaterial).map;
    const spy = vi.spyOn(tex!, "dispose");
    cap.setOverlayStyle("none");
    expect(overlay.visible).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it("overlayOpacity 走原地路径（材质引用不变）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setOverlayStyle("grid");
    const mat0 = (scene.getObjectByName("ysm-ground-overlay") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    cap.setOverlayOpacity(0.4);
    const mat1 = (scene.getObjectByName("ysm-ground-overlay") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat1).toBe(mat0);
    expect(mat1.opacity).toBeCloseTo(0.4);
  });

  // ADR-249 §2.4 死控件回归：初版 generateOverlayPixels 硬编码 sizePx/8，
  // 「叠加格数」滑杆拖了不改变任何像素（可拖、有重建、零视觉反馈）。
  it("overlaySize 变化 → 重建贴图且像素确实不同（死控件回归）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setOverlaySize(8);
    cap.setOverlayStyle("grid");
    const readImg = (): number[] => {
      const mat = (scene.getObjectByName("ysm-ground-overlay") as THREE.Mesh)
        .material as THREE.MeshStandardMaterial;
      return Array.from((mat.map as THREE.DataTexture).image.data as Uint8Array);
    };
    const img8 = readImg();
    cap.setOverlaySize(32);
    const img32 = readImg();
    expect(img32).not.toEqual(img8);
  });

  it("setVisible(false) 同步隐藏叠加层；恢复后重现", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setOverlayStyle("grid");
    const overlay = scene.getObjectByName("ysm-ground-overlay") as THREE.Mesh;
    cap.setVisible(false);
    expect(overlay.visible).toBe(false);
    cap.setVisible(true);
    expect(overlay.visible).toBe(true);
  });

  it("dispose 释放叠加层几何/材质/纹理且幂等", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setOverlayStyle("grid");
    const overlay = scene.getObjectByName("ysm-ground-overlay") as THREE.Mesh;
    const tex = (overlay.material as THREE.MeshStandardMaterial).map;
    const texSpy = vi.spyOn(tex!, "dispose");
    const geoSpy = vi.spyOn(overlay.geometry, "dispose");
    cap.dispose();
    expect(scene.getObjectByName("ysm-ground-overlay")).toBeUndefined();
    expect(texSpy).toHaveBeenCalled();
    expect(geoSpy).toHaveBeenCalled();
    cap.dispose();
  });

  it("saveState/loadState 往返叠加层字段", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.setOverlayStyle("checker");
    cap.setOverlayColor(0x00ff00);
    cap.setOverlaySize(16);
    cap.setOverlayOpacity(0.6);
    cap.saveState();
    resetEnvState();
    const cap2 = new GroundCapability({ scene });
    cap2.loadState();
    expect(cap2.getOverlayStyle()).toBe("checker");
    expect(cap2.getOverlayColor()).toBe(0x00ff00);
    expect(cap2.getOverlaySize()).toBe(16);
    expect(cap2.getOverlayOpacity()).toBeCloseTo(0.6);
  });

  it("叠加层控件：color/size/opacity 仅 overlay ≠ none 时可见", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const folder = cap.getMenuNodes().find((n) => n.id === "cap-group-ground-overlay")!;
    const color = folder.children!.find((c) => c.id === "ground-overlay-color")!;
    expect(color.visibleWhen?.({ "env.groundOverlay": "none" })).toBe(false);
    expect(color.visibleWhen?.({ "env.groundOverlay": "grid" })).toBe(true);
  });

  it("叠加层 select 读写闭包直连 cap", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const folder = cap.getMenuNodes().find((n) => n.id === "cap-group-ground-overlay")!;
    const style = folder.children!.find((c) => c.id === "ground-overlay")!;
    style.control!.set!("checker");
    expect(cap.getOverlayStyle()).toBe("checker");
    expect(style.control!.get!(undefined)).toBe("checker");
  });
});

describe("GroundCapability — 材质预设（ADR-254 材质名兑现配色）", () => {
  beforeEach(() => { resetEnvState(); });

  it("选「草地」→ 真绿：配色落到绿系且形状为 grass（名实相符）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setMaterialPreset("grass");
    const def = GROUND_MATERIAL_PRESETS.grass;
    expect(cap.getMaterialPreset()).toBe("grass");
    expect(cap.getCanvasStyle()).toBe("grass");
    expect(cap.getMatColor()).toBe(def.matColor);
    expect(cap.getMatColor2()).toBe(def.matColor2);
    // 绿主导：G 通道 > R 且 > B（裸色值断言，防“名字绿了但色值没绿”）
    const g = (def.matColor >> 8) & 0xff;
    expect(g, "草地底色应为绿主导").toBeGreaterThan((def.matColor >> 16) & 0xff);
    expect(g).toBeGreaterThan(def.matColor & 0xff);
  });

  it("四个预设各有独立配色 + 大理石/沙不绿（防调色板复制粘贴错位）", () => {
    const seen = new Set<number>();
    for (const id of GROUND_MATERIAL_PRESET_IDS) {
      seen.add(GROUND_MATERIAL_PRESETS[id].matColor);
    }
    expect(seen.size, "四个预设底色不得重复").toBe(4);
    const marble = GROUND_MATERIAL_PRESETS.marble.matColor;
    const mg = (marble >> 8) & 0xff;
    expect(mg, "大理石不应是绿系").toBeLessThanOrEqual(Math.max((marble >> 16) & 0xff, marble & 0xff));
  });

  it("手改预设关心的字段 → 状态变 custom（显式脱离），形状保留", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.setMaterialPreset("grass");
    cap.setMatColor(0x123456);
    expect(cap.getMaterialPreset()).toBe("custom");
    expect(cap.getCanvasStyle(), "custom 态保留上一次形状").toBe("grass");
  });

  it("改预设不管的字段 → 不清预设（白名单精确性，非前缀匹配）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.setMaterialPreset("grass");
    cap.setMatOpacity(0.5);
    cap.setVisible(false);
    cap.setOverlayStyle("grid");
    expect(cap.getMaterialPreset(), "预设不管的字段不应误清预设").toBe("grass");
  });

  it("白名单与预设表写入字段一一对应（防两处漂移断言）", () => {
    const fromSpec = [
      "groundCanvasStyle",
      "groundMatColor",
      "groundMatColor2",
      "groundMatDensity",
      "groundMatGridSize",
      "groundMatAngleDeg",
    ];
    expect([...GROUND_MATERIAL_PRESET_KEYS].sort()).toEqual(fromSpec.sort());
  });

  it("同一事务：预设写入后无中间态（形状与配色同时到位）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    // 材质轴仅当 sourceKind=canvas 时生效（菜单也仅在该来源下显示本轴）
    cap.setSourceKind("canvas");
    cap.setMaterialPreset("sand");
    const mat = (scene.getObjectByName("ysm-ground-surface") as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    // 形状为 sand → 产贴图（非 plain/solid 的 tex=null 路径）
    expect(mat.map).toBeInstanceOf(THREE.DataTexture);
    expect(cap.getCanvasStyle()).toBe("sand");
    expect(cap.getMaterialPreset()).toBe("sand");
  });

  it("手选「自定义」为无操作（形状与配色保留）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.setMaterialPreset("grass");
    const c = cap.getMatColor();
    cap.setMaterialPreset("custom");
    expect(cap.getMaterialPreset()).toBe("grass");
    expect(cap.getMatColor()).toBe(c);
  });

  it("存档往返：预设状态持久化且 loadState 不误判 custom（审核回归）", () => {
    const scene = new THREE.Scene();
    localStorage.removeItem("ysm-scene-cap-ground");
    const cap = new GroundCapability({ scene });
    cap.setMaterialPreset("grass");
    cap.saveState();
    resetEnvState();
    const cap2 = new GroundCapability({ scene });
    cap2.loadState();
    localStorage.removeItem("ysm-scene-cap-ground");
    // 审查器 P2 实锤案例：loadState 逐字段恢复曾触发中间件 → 恒 custom，
    // 用户选的「草地」重启显示「自定义（已手改）」——名实不符
    expect(cap2.getMaterialPreset(), "恢复路径不得触发手改标记").toBe("grass");
    expect(cap2.getCanvasStyle()).toBe("grass");
    expect(cap2.getMatColor()).toBe(GROUND_MATERIAL_PRESETS.grass.matColor);
  });

  it("旧存档缺 groundMaterialPreset 字段 → 回退 plain（保守兜底）", () => {
    const scene = new THREE.Scene();
    localStorage.removeItem("ysm-scene-cap-ground");
    localStorage.setItem(
      "ysm-scene-cap-ground",
      JSON.stringify({ enabled: true, visible: true, groundCanvasStyle: "marble" }),
    );
    const cap = new GroundCapability({ scene });
    cap.loadState();
    localStorage.removeItem("ysm-scene-cap-ground");
    expect(cap.getMaterialPreset()).toBe("plain");
    expect(cap.getCanvasStyle()).toBe("marble");
  });
});
