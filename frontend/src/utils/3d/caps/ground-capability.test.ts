// @vitest-environment node
// ===== GroundCapability 测试（utils/3d/caps/ground-capability.ts）=====
// 覆盖：apply 挂入场景（GridHelper）、setVisible/getVisible 开关切换、
// 默认可见/参数覆盖、dispose 移除并释放、表面材质层（spec 单源：重建/原地区分、显隐跟随、自定义贴图缓存、持久化回退）。
// 注：水面已拆为独立 WaterCapability（见 water-capability.test.ts）。
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { GroundCapability, DEFAULT_GROUND_PARAMS } from "./ground-capability.ts";
import { persistState } from "./scene-capability.ts";

describe("GroundCapability", () => {
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

  it("参数覆盖（enabled:false 不挂入；params 定制网格尺寸）", () => {
    const scene = new THREE.Scene();
    const off = new GroundCapability({ scene, enabled: false });
    off.apply();
    expect(scene.getObjectByName("ysm-ground")).toBeUndefined(); // disabled 不挂入
    const custom = new GroundCapability({ scene, params: { size: 100, visible: false } });
    custom.apply();
    const grid = scene.getObjectByName("ysm-ground") as THREE.GridHelper;
    expect(grid).toBeDefined();
    expect(grid.visible).toBe(false); // params.visible 覆盖
    expect(DEFAULT_GROUND_PARAMS.size).toBe(80); // 默认参数基线
  });

  it("dispose 移除网格并释放几何/材质（重复 dispose 幂等）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    const grid = scene.getObjectByName("ysm-ground") as THREE.GridHelper;
    expect(grid).toBeDefined();
    cap.dispose();
    expect(scene.getObjectByName("ysm-ground")).toBeUndefined();
    cap.dispose(); // 幂等：已移除不再抛错
  });
});

describe("GroundCapability — getMenuControls 分组", () => {
  it("总开关无 group；表面材质参数组归 preview.groundGroupMaterial", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const controls = cap.getMenuControls();
    // 总开关(1，无 group) + 材质参数组(14)
    expect(controls.length).toBe(15); // 水面已拆出，此处不再含 water 组
    expect(controls[0]!.id).toBe("ground-visible");
    expect(controls[0]!.group).toBeUndefined();
    const matControls = controls.filter((c) => c.group === "preview.groundGroupMaterial");
    expect(matControls.length).toBe(14);
    expect(matControls.map((c) => c.id)).toContain("ground-mat-source");
    expect(matControls.map((c) => c.id)).toContain("ground-mat-color2");
    expect(matControls.map((c) => c.id)).toContain("ground-mat-density");
  });
});

describe("GroundCapability — 材质控件按 matSource 条件显隐", () => {
  it("默认 matSource=none：仅 source 门控可见，其余材质控件隐藏；切源后 viz 跟随", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const controls = cap.getMenuControls();
    const source = controls.find((c) => c.id === "ground-mat-source")!;
    const color = controls.find((c) => c.id === "ground-mat-color")!;
    const texBtn = controls.find((c) => c.id === "ground-mat-texture")!;
    expect(source.visible).toBeUndefined(); // 门控 select 常显
    expect(color.visible?.()).toBe(false); // none → 隐藏
    expect(texBtn.visible?.()).toBe(false); // none → 隐藏
    cap.setMatSource("checker");
    expect(color.visible?.()).toBe(true);
    expect(texBtn.visible?.()).toBe(false); // checker 仍非 texture
    cap.setMatSource("texture");
    expect(texBtn.visible?.()).toBe(true); // 仅 texture 模式显贴图按钮
  });
});

describe("GroundCapability — 表面材质层（spec 单源）", () => {
  it("默认 matSource=none：apply 后 surface 存在但不可见", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    const surf = scene.getObjectByName("ysm-ground-surface");
    expect(surf).toBeDefined();
    expect(surf!.visible).toBe(false);
  });

  it("setMatSource(checker) → 可见 + 材质挂 DataTexture + repeat=80/10/1", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setMatSource("checker");
    const surf = scene.getObjectByName("ysm-ground-surface") as THREE.Mesh;
    expect(surf.visible).toBe(true);
    const mat = surf.material as THREE.MeshStandardMaterial;
    expect(mat.map).toBeInstanceOf(THREE.DataTexture);
    expect(mat.map!.repeat.x).toBeCloseTo(8); // textureRepeat(80,1)=8
  });

  it("structural 变化重建（map 新实例）；appearance 变化原地（map 引用不变）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setMatSource("grid");
    const surf = scene.getObjectByName("ysm-ground-surface") as THREE.Mesh;
    const mat0 = surf.material as THREE.MeshStandardMaterial;
    const map0 = mat0.map;
    // 外观：原地
    cap.setMatScale(2.5);
    const mat1 = (scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat1.map).toBe(map0); // 同一纹理实例
    expect(mat1.map!.repeat.x).toBeCloseTo(3.2); // textureRepeat(80,2.5)=80/10/2.5=3.2
    expect(mat1.opacity).toBe(1);
    // 结构：换底色触发重建
    cap.setMatColor(0xff0000);
    const mat2 = (scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat2.map).not.toBe(map0); // 新纹理实例
  });

  it("不透明度走原地路径且驱动 transparent/depthWrite", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setMatSource("plain");
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
    cap.setMatSource("solid");
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
    expect(mat.map).toBe(tex); // 直接用缓存贴图
    const btn = cap.getMenuControls().find((c) => c.id === "ground-mat-texture");
    expect(btn!.button!.getHint!()).toContain("wood.png");
  });

  it("clearCustomTexture：释放缓存并回退 plain", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    const tex = new THREE.DataTexture(new Uint8Array(4 * 4), 2, 2);
    cap.acceptLoadedTexture(tex, "wood.png");
    cap.clearCustomTexture();
    expect(cap.getMatSource()).toBe("plain");
    const mat = (scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.map).not.toBe(tex); // 已换回程序化纹理
  });

  it("texture 模式无缓存时占位回退（纯色像素），加载后自动换真图", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setMatSource("texture"); // 尚无自定义贴图
    const mat = (scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.map).toBeDefined(); // 占位纹理而非裸色块
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
    cap.dispose(); // 幂等
  });

  it("saveState/loadState 往返 mat 字段；texture 模式持久化后回退 plain", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.setMatSource("checker");
    cap.setMatScale(3);
    cap.saveState();
    const cap2 = new GroundCapability({ scene });
    cap2.loadState();
    expect(cap2.getMatSource()).toBe("checker");
    expect(cap2.getMatScale()).toBe(3);

    const cap3 = new GroundCapability({ scene });
    cap3.acceptLoadedTexture(new THREE.DataTexture(new Uint8Array(16), 2, 2), "t.png");
    cap3.saveState(); // texture 模式入库
    const cap4 = new GroundCapability({ scene });
    cap4.loadState();
    expect(cap4.getMatSource()).toBe("plain"); // 二进制未持久化 → 回退
  });

  it("loadState 非法 matSource 回退 none（缺字段不崩）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    persistState("ground", { enabled: true, visible: true, matSource: "hack" });
    cap.loadState();
    expect(cap.getMatSource()).toBe("none");
  });

  describe("subscribe（局部刷新通知）", () => {
    it("setMatSource 触发订阅者，同值早退不 notify，unsub 后停止", () => {
      const scene = new THREE.Scene();
      const cap = new GroundCapability({ scene });
      let calls = 0;
      const unsub = cap.subscribe!(() => { calls++; });
      cap.setMatSource("grid");
      expect(calls).toBe(1);
      cap.setMatSource("grid"); // 同值早退
      expect(calls).toBe(1);
      cap.setMatColor(0xff0000); // 仅改值
      expect(calls).toBe(1);
      cap.setMatSource("none");
      expect(calls).toBe(2);
      unsub();
      cap.setMatSource("plain");
      expect(calls).toBe(2);
    });
  });
});

// ============ 启用切换：enabled × 显隐/挂载门控 ============
describe("GroundCapability — 启用切换", () => {
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

  it("disabled 时仅移除挂载，surface.visible 标志不被改写（门控只走 refreshSurface/setVisible）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene, params: { matSource: "checker" } });
    cap.apply();
    const surface = (cap as unknown as { surface: THREE.Mesh }).surface;
    expect(surface.visible).toBe(true);
    cap.setEnabled(false);
    expect(surface.parent).toBeNull(); // 移除挂载
    expect(surface.visible).toBe(true); // visible 标志保持（setEnabled 不调 updateSurfaceVisible）
    cap.setEnabled(true);
    expect(surface.parent).toBe(scene);
    expect(surface.visible).toBe(true);
  });
});

// ============ 材质参数 setter 批量（全部经 refreshSurface 单路径）============
describe("GroundCapability — 材质参数 setter 批量", () => {
  it("全部 setter 落地 params（含 clamp/取模）且 getter 回读一致", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene, params: { matSource: "checker" } });
    cap.setMatLineColor(0x112233);
    cap.setMatGridSize(16.7); // round → 17
    cap.setMatGridSize(1); // clamp min 2
    cap.setMatOpacity(2); // clamp 1
    cap.setMatOpacity(-1); // clamp 0
    cap.setMatScale(100); // clamp 8
    cap.setMatScale(0.1); // clamp 0.25
    cap.setMatRotation(450); // %360 → 90
    cap.setMatRotation(-90); // → 270
    cap.setMatRoughness(5); // clamp 1
    cap.setMatMetalness(-2); // clamp 0
    cap.setMatColor2(0xaabbcc);
    cap.setMatDensity(20); // clamp 8
    cap.setMatAngle(400); // → 40

    expect(cap.getMatOpacity()).toBe(0);
    expect(cap.getMatScale()).toBe(0.25);
    expect(cap.getMatRotation()).toBe(270);
    expect(cap.getMatRoughness()).toBe(1);
    expect(cap.getMatMetalness()).toBe(0);
    expect(cap.getMatColor2()).toBe(0xaabbcc);
    expect(cap.getMatDensity()).toBe(8);
    expect(cap.getMatAngle()).toBe(40);
    const p = (cap as unknown as { params: Record<string, number> }).params;
    expect(p.matLineColor).toBe(0x112233);
    expect(p.matGridSize).toBe(2);
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
    expect(disposeSpy).toHaveBeenCalled(); // 旧缓存释放
    const mat = (scene.getObjectByName("ysm-ground-surface") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.map).toBe(tex2);
    const hint = cap.getMenuControls().find((c) => c.id === "ground-mat-texture")!.button!.getHint!();
    expect(hint).toContain("b.png");
  });

  it("dispose 时释放程序化表面纹理（非 custom 缓存归属）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene, params: { matSource: "checker" } });
    cap.apply();
    const surfaceTex = (cap as unknown as { surfaceTex: THREE.Texture }).surfaceTex;
    expect(surfaceTex).not.toBeNull();
    const disposeSpy = vi.spyOn(surfaceTex!, "dispose");
    cap.dispose();
    expect(disposeSpy).toHaveBeenCalled();
  });
});

// ============ 菜单控件联动 ============
describe("GroundCapability — 菜单控件联动", () => {
  it("visible toggle 与 mat-source select 联动", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const controls = cap.getMenuControls();
    const visibleCtrl = controls.find((c) => c.id === "ground-visible")!;
    visibleCtrl.setValue(false);
    expect(cap.getVisible()).toBe(false);
    expect(visibleCtrl.getValue()).toBe(false);
    const sourceCtrl = controls.find((c) => c.id === "ground-mat-source")!;
    sourceCtrl.setValue("stripes");
    expect(cap.getMatSource()).toBe("stripes");
    expect(sourceCtrl.getValue()).toBe("stripes");
  });

  it("材质参数控件 setValue/getValue 全联动（texture 模式下可见）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene, params: { matSource: "checker" } });
    const controls = cap.getMenuControls();
    const by = (id: string): MenuControlDefOf => controls.find((c) => c.id === id)!;
    by("ground-mat-color").setValue(0xff8800);
    by("ground-mat-color2").setValue(0x00ff88);
    by("ground-mat-line-color").setValue(0x445566);
    by("ground-mat-grid-size").setValue(12);
    by("ground-mat-density").setValue(4);
    by("ground-mat-angle").setValue(45);
    by("ground-mat-opacity").setValue(0.5);
    by("ground-mat-scale").setValue(2);
    by("ground-mat-rotation").setValue(30);
    by("ground-mat-roughness").setValue(0.8);
    by("ground-mat-metalness").setValue(0.2);
    expect(by("ground-mat-color").getValue()).toBe(0xff8800);
    expect(by("ground-mat-color2").getValue()).toBe(0x00ff88);
    expect(by("ground-mat-line-color").getValue()).toBe(0x445566);
    expect(by("ground-mat-grid-size").getValue()).toBe(12);
    expect(by("ground-mat-density").getValue()).toBe(4);
    expect(by("ground-mat-angle").getValue()).toBe(45);
    expect(by("ground-mat-opacity").getValue()).toBe(0.5);
    expect(by("ground-mat-scale").getValue()).toBe(2);
    expect(by("ground-mat-rotation").getValue()).toBe(30);
    expect(by("ground-mat-roughness").getValue()).toBe(0.8);
    expect(by("ground-mat-metalness").getValue()).toBe(0.2);
  });

  it("button 控件：getValue null、setValue no-op、visible 随模式切换", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const pick = cap.getMenuControls().find((c) => c.id === "ground-mat-texture")!;
    const clear = cap.getMenuControls().find((c) => c.id === "ground-mat-clear")!;
    // none 模式隐藏
    expect(pick.visible?.()).toBe(false);
    expect(clear.visible?.()).toBe(false);
    expect(pick.getValue()).toBeNull();
    expect(() => pick.setValue("x")).not.toThrow();
    expect(() => clear.setValue("x")).not.toThrow();
    // texture 模式显示
    cap.setMatSource("texture");
    expect(pick.visible?.()).toBe(true);
    expect(clear.visible?.()).toBe(true);
    // 清除按钮 action → clearCustomTexture 回 plain
    clear.button!.action!();
    expect(cap.getMatSource()).toBe("plain");
  });

  it("选择贴图按钮 action 触发文件选择器（mock input，node 环境）", () => {
    const fakeInput = {
      type: "",
      accept: "",
      onchange: null as unknown,
      click(): void { /* node 下不做真实选择 */ },
    };
    const stub = vi.stubGlobal("document", {
      createElement: (tag: string) => (tag === "input" ? fakeInput : null),
    });
    try {
      const scene = new THREE.Scene();
      const cap = new GroundCapability({ scene, params: { matSource: "texture" } });
      const pick = cap.getMenuControls().find((c) => c.id === "ground-mat-texture")!;
      expect(() => pick.button!.action!()).not.toThrow();
      expect(fakeInput.type).toBe("file");
      expect(fakeInput.accept).toBe("image/*");
    } finally {
      stub.unstubAllGlobals();
    }
  });
});

type MenuControlDefOf = ReturnType<GroundCapability["getMenuControls"]>[number];
