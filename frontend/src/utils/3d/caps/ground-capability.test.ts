// @vitest-environment node
// ===== GroundCapability 测试（utils/3d/caps/ground-capability.ts）=====
// 覆盖：apply 挂入场景（GridHelper）、setVisible/getVisible 开关切换、
// 默认可见/参数覆盖、dispose 移除并释放、水面法线贴图、
// 表面材质层（spec 单源：重建/原地区分、显隐跟随、自定义贴图缓存、持久化回退）。
import { describe, it, expect } from "vitest";
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
  it("总开关无 group；水面/材质参数组各自分组", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const controls = cap.getMenuControls();
    // 总开关(1) + 水面参数组(12: enabled/mode/wetness/水色/opacity/normal/wave/clarity/height/thickness/wallColor/roundness) + 材质参数组(14)
    expect(controls.length).toBe(27);
    expect(controls[0]!.id).toBe("ground-visible");
    expect(controls[0]!.group).toBeUndefined();
    // 水面参数组
    const waterControls = controls.filter((c) => c.group === "preview.groundGroupWater");
    expect(waterControls.length).toBe(12);
    expect(waterControls.map((c) => c.id).sort()).toEqual(
      [
        "ground-water-enabled", "ground-water-mode", "ground-wetness",
        "ground-water-color", "ground-water-opacity", "ground-normal-strength",
        "ground-wave-speed", "ground-water-clarity",
        "ground-pool-height", "ground-pool-wall-thickness", "ground-pool-wall-color", "ground-pool-roundness",
      ].sort(),
    );
    // 材质参数组（来源+底色+副色+线色+格数+density+angle+2button+不透明度+缩放+旋转+粗糙度+金属度 = 14）
    const matControls = controls.filter((c) => c.group === "preview.groundGroupMaterial");
    expect(matControls.length).toBe(14);
    expect(matControls.map((c) => c.id)).toContain("ground-mat-source");
    expect(matControls.map((c) => c.id)).toContain("ground-mat-color2");
    expect(matControls.map((c) => c.id)).toContain("ground-mat-density");
  });

  it("getMenuControls 含 ground-normal-strength slider", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const controls = cap.getMenuControls();
    const normalCtrl = controls.find((c) => c.id === "ground-normal-strength");
    expect(normalCtrl).toBeDefined();
    expect(normalCtrl!.kind).toBe("slider");
    expect(normalCtrl!.group).toBe("preview.groundGroupWater");
    expect(normalCtrl!.slider).toEqual({ min: 0, max: 1, step: 0.05 });
  });

  it("setNormalStrength 影响 waterMat.normalScale", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    expect(cap.getNormalStrength()).toBe(0.08);
    cap.setNormalStrength(0.8);
    expect(cap.getNormalStrength()).toBe(0.8);
    const topMesh = (cap["water"] as THREE.Object3D).type === "Mesh"
      ? (cap["water"] as unknown as THREE.Mesh)
      : (cap["water"] as THREE.Object3D).children.find((c) => c.name === "ysm-water-top") as THREE.Mesh;
    const mat = topMesh.material as THREE.MeshStandardMaterial;
    expect(mat.normalScale.x).toBeCloseTo(0.8);
    expect(mat.normalScale.y).toBeCloseTo(0.8);
  });

  it("generateNormalMap 返回 DataTexture，尺寸 256x256", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const tex = cap["generateNormalMap"](256);
    expect(tex).toBeInstanceOf(THREE.DataTexture);
    expect(tex.width).toBe(256);
    expect(tex.height).toBe(256);
  });

  it("generateNormalMap 像素值合法：R/G 有变化，B 接近 255", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const tex = cap["generateNormalMap"](256) as THREE.DataTexture;
    expect(tex.image.data).toBeDefined();
    const data = tex.image.data as Uint8Array;
    expect(data.length).toBe(256 * 256 * 4);

    let rMin = 255, rMax = 0, gMin = 255, gMax = 0;
    let bCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b >= 240) bCount++;
    }
    // R/G 通道应有变化（不为单一值）
    expect(rMax - rMin).toBeGreaterThan(5);
    expect(gMax - gMin).toBeGreaterThan(5);
    // B 通道大部分接近 255（朝上法线）
    expect(bCount).toBeGreaterThan(data.length / 4 * 0.9);
  });

  it("saveState/loadState 持久化 normalStrength", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.setNormalStrength(0.7);
    cap.saveState();
    const cap2 = new GroundCapability({ scene });
    cap2.loadState();
    expect(cap2.getNormalStrength()).toBe(0.7);
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
    persistState("ground", { enabled: true, visible: true, wetness: 0.5, matSource: "hack" });
    cap.loadState();
    expect(cap.getMatSource()).toBe("none");
    expect(cap.getNormalStrength()).toBe(DEFAULT_GROUND_PARAMS.water.normalStrength); // 缺字段走默认
  });
});

describe("GroundCapability — Water 2026-08 拓展（独立开关 / 嵌套参数 / 水池几何）", () => {
  it("水面支持独立开关：关地面后仍可开水面（与 visible 脱钩）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setVisible(false);
    cap.setWaterEnabled(true);
    expect(cap.getVisible()).toBe(false);
    expect(cap.getWaterEnabled()).toBe(true);
    const water = scene.getObjectByName("ysm-ground-water");
    expect(water?.visible).toBe(true);
  });

  it("初始 film 模式 water 是单 Mesh；setWaterMode('pool') 后 ysm-ground-water 下 mesh≥5（底+四壁+顶）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    // film 模式：直接是单个 mesh
    expect(scene.getObjectByName("ysm-ground-water")).toBeInstanceOf(THREE.Mesh);
    cap.setWaterMode("pool");
    cap.setPoolHeight(0.8);
    const root = scene.getObjectByName("ysm-ground-water");
    expect(root).toBeDefined();
    const meshes: THREE.Mesh[] = [];
    root!.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    // 顶 + 底 + 四壁 = 6；加上池壁内外侧合并（内侧/外侧不同材质但几何仍 1 份），至少 5 个
    expect(meshes.length).toBeGreaterThanOrEqual(5);
  });

  it("池体顶 mesh y 位置等于 poolHeight（水面高度生效）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    cap.setPoolHeight(1.2);
    const root = scene.getObjectByName("ysm-ground-water")!;
    // 找到 name 含 "top" 的子 mesh 或遍历出位于最高 y 的平面 mesh（顶水面）
    let topY = -Infinity;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) topY = Math.max(topY, m.getWorldPosition(new THREE.Vector3()).y);
    });
    expect(topY).toBeCloseTo(1.2, 1); // ±0.1 容差
  });

  it("setPoolHeight / setPoolWallColor getter/setter 一致", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.setPoolHeight(1.2);
    expect(cap.getPoolHeight()).toBe(1.2);
    cap.setPoolWallColor(0x2244aa);
    expect(cap.getPoolWallColor()).toBe(0x2244aa);
    cap.setPoolRoundness(0.3);
    expect(cap.getPoolRoundness()).toBeCloseTo(0.3);
  });

  it("旧存档迁移：顶层 wetness/waterColor/waterOpacity/normalStrength → 打包进 water 对象", () => {
    // 模拟 legacy 存档：2026-08 前的格式（water 四字段在顶层，无 water 嵌套对象）
    persistState("ground", {
      enabled: true,
      visible: true,
      wetness: 0.6,
      waterColor: 0x4488aa,
      waterOpacity: 0.5,
      normalStrength: 0.4,
      matSource: "checker",
    });
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.loadState();
    expect(cap.getWetness()).toBeCloseTo(0.6);
    expect(cap.getWaterColor()).toBe(0x4488aa);
    expect(cap.getWaterOpacity()).toBeCloseTo(0.5);
    expect(cap.getNormalStrength()).toBeCloseTo(0.4);
    // 迁移后默认 enabled=true / mode=film
    expect(cap.getWaterEnabled()).toBe(true);
    expect(cap.getWaterMode()).toBe("film");
  });

  it("水池切换到 film 模式：dispose 所有子 mesh geometry/material，不泄漏（再切 pool 仍可工作）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setWaterMode("pool");
    cap.setPoolHeight(0.8);
    const before = scene.getObjectByName("ysm-ground-water");
    expect(before).toBeDefined();
    cap.setWaterMode("film"); // 回切薄水膜
    const after = scene.getObjectByName("ysm-ground-water");
    expect(after).toBeInstanceOf(THREE.Mesh);
    expect(after!.name).toBe("ysm-ground-water");
    // 再切 pool 不崩
    cap.setWaterMode("pool");
    const root = scene.getObjectByName("ysm-ground-water")!;
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeGreaterThanOrEqual(5);
  });
});
