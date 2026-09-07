// @vitest-environment node
// ===== RenderModeCapability 测试（preview-3d/caps/render-mode-capability.ts）=====
// 覆盖：五属性独立覆盖/还原、共享材质快照去重、无快照材质跳过还原、nullish 回退、
// sync 三分支、loadState 类型守卫、菜单控件读写、dispose 幂等。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { RenderModeCapability } from "./render-mode-capability.ts";
import { resetEnvState } from "@/preview-3d/state/env-state.ts";

const STORAGE_KEY = "ysm-scene-cap-renderMode";

function makeScene(...meshes: THREE.Mesh[]) {
  const scene = new THREE.Scene();
  for (const m of meshes) scene.add(m);
  return scene;
}

function newCap(...meshes: THREE.Mesh[]) {
  return new RenderModeCapability({ scene: makeScene(...meshes) });
}

function makeMesh(opts: { mats?: number } = {}) {
  const matCount = opts.mats ?? 1;
  const mats = Array.from({ length: matCount }, () => new THREE.MeshBasicMaterial());
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matCount === 1 ? mats[0] : mats);
}

describe("RenderModeCapability — 构造与初始状态", () => {
  beforeEach(() => { resetEnvState(); });

  it("初始无任何 override", () => {
    const cap = newCap(makeMesh());
    expect(cap.isEnabled()).toBe(false);
    expect(cap.getWireframe()).toBeNull();
    expect(cap.getBlending()).toBeNull();
    expect(cap.getDepthTest()).toBeNull();
    expect(cap.getSide()).toBeNull();
    expect(cap.getDepthWrite()).toBeNull();
  });

  it("isEnabled 反映任一 override 存在", () => {
    const cap = newCap(makeMesh());
    cap.setDepthWrite(false);
    expect(cap.isEnabled()).toBe(true);
  });

  it("setEnabled 无操作（各属性独立控制）", () => {
    const cap = newCap(makeMesh());
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(false);
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
  });
});

describe("RenderModeCapability — 单属性覆盖/还原", () => {
  beforeEach(() => { resetEnvState(); }); // ADR-196 单例化：断言不依赖前序 describe 残留
  it("setWireframe(true) 覆盖材质；setWireframe(null) 还原原始值", () => {
    const mesh = makeMesh();
    (mesh.material as THREE.MeshBasicMaterial).wireframe = true; // 原始 true
    const cap = newCap(mesh);
    cap.setWireframe(false); // 强制 false
    expect((mesh.material as THREE.MeshBasicMaterial).wireframe).toBe(false);
    cap.setWireframe(null); // 还原
    expect((mesh.material as THREE.MeshBasicMaterial).wireframe).toBe(true);
  });

  it("setBlending 覆盖/还原", () => {
    const mesh = makeMesh();
    const cap = newCap(mesh);
    cap.setBlending(THREE.AdditiveBlending);
    expect((mesh.material as THREE.MeshBasicMaterial).blending).toBe(THREE.AdditiveBlending);
    cap.setBlending(null);
    expect((mesh.material as THREE.MeshBasicMaterial).blending).toBe(THREE.NormalBlending);
  });

  it("setDepthTest(false) X 光透视；还原恢复 true", () => {
    const mesh = makeMesh();
    const cap = newCap(mesh);
    cap.setDepthTest(false);
    expect((mesh.material as THREE.MeshBasicMaterial).depthTest).toBe(false);
    cap.setDepthTest(null);
    expect((mesh.material as THREE.MeshBasicMaterial).depthTest).toBe(true);
  });

  it("setSide 覆盖/还原", () => {
    const mesh = makeMesh();
    const cap = newCap(mesh);
    cap.setSide(THREE.DoubleSide);
    expect((mesh.material as THREE.MeshBasicMaterial).side).toBe(THREE.DoubleSide);
    cap.setSide(null);
    expect((mesh.material as THREE.MeshBasicMaterial).side).toBe(THREE.FrontSide);
  });

  it("setDepthWrite(false) 覆盖/还原", () => {
    const mesh = makeMesh();
    const cap = newCap(mesh);
    cap.setDepthWrite(false);
    expect((mesh.material as THREE.MeshBasicMaterial).depthWrite).toBe(false);
    cap.setDepthWrite(null);
    expect((mesh.material as THREE.MeshBasicMaterial).depthWrite).toBe(true);
  });

  it("数组材质也逐个覆盖", () => {
    const mesh = makeMesh({ mats: 2 });
    const mats = mesh.material as THREE.MeshBasicMaterial[];
    const cap = newCap(mesh);
    cap.setWireframe(true);
    expect(mats[0].wireframe).toBe(true);
    expect(mats[1].wireframe).toBe(true);
    cap.setWireframe(null);
    expect(mats.map((m) => m.wireframe)).toEqual([false, false]);
  });

  it("多属性组合覆盖，单属性清除即时回落原始值（属性互相独立），全清整体还原", () => {
    const mesh = makeMesh();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.wireframe = false;
    mat.blending = THREE.NormalBlending;
    const cap = newCap(mesh);
    cap.setWireframe(true);
    cap.setBlending(THREE.MultiplyBlending);
    cap.setDepthTest(false);
    expect(mat.wireframe).toBe(true);
    expect(mat.blending).toBe(THREE.MultiplyBlending);
    expect(mat.depthTest).toBe(false);
    // 清除 wireframe：null = 不覆盖 → 该属性即时回落快照原始值（false）。
    // 属性互相独立（文件头语义「每个属性独立 override，null = 保持原始值」），
    // 清除单个不得让材质停在覆盖值上；其余 override 继续生效。
    cap.setWireframe(null);
    expect(mat.wireframe).toBe(false);
    expect(mat.blending).toBe(THREE.MultiplyBlending);
    expect(mat.depthTest).toBe(false);
    // 全部清空 → 整体 restoreSnapshot
    cap.setBlending(null);
    cap.setDepthTest(null);
    expect(mat.wireframe).toBe(false);
    expect(mat.blending).toBe(THREE.NormalBlending);
    expect(mat.depthTest).toBe(true);
  });
});

describe("RenderModeCapability — 快照细节", () => {
  beforeEach(() => { resetEnvState(); }); // ADR-196 单例化：断言不依赖前序 describe 残留
  it("共享同一材质只快照一次（uuid 去重）", () => {
    const mat = new THREE.MeshBasicMaterial();
    const m1 = new THREE.Mesh(new THREE.BoxGeometry(), mat);
    const m2 = new THREE.Mesh(new THREE.BoxGeometry(), mat);
    const cap = newCap(m1, m2);
    cap.setWireframe(true);
    expect(mat.wireframe).toBe(true);
    cap.setWireframe(null);
    expect(mat.wireframe).toBe(false); // 还原不重复应用
  });

  it("非 Mesh 对象与无材质对象不炸", () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Group()); // 非 mesh
    const cap = newCap();
    scene.add(new THREE.Group());
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    cap.setWireframe(true);
    expect(cap.isEnabled()).toBe(true);
  });

  it("材质缺属性时 nullish 回退默认值", () => {
    // 模拟自定义材质对象缺 wireframe/blending 等字段（源码 ?? 回退分支）
    const fake = { uuid: "fake-mat-1" } as unknown as THREE.MeshBasicMaterial;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), fake);
    const cap = newCap(mesh);
    cap.setWireframe(null); // 触发 collectSnapshot
    cap.setWireframe(true); // 覆盖
    expect(fake.wireframe).toBe(true);
    cap.setWireframe(null); // 还原为快照回退值 false
    expect(fake.wireframe).toBe(false);
  });

  it("还原时场景中新增的无快照材质被跳过", () => {
    const mesh = makeMesh();
    const scene = makeScene(mesh);
    const cap = new RenderModeCapability({ scene });
    cap.setWireframe(true);
    // apply 之后新加进来的材质没有快照
    const late = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    late.material = new THREE.MeshBasicMaterial({ wireframe: true }); // 外部已设 true
    scene.add(late);
    cap.setWireframe(null);
    // 无快照材质：还原逻辑跳过，保留外部设置的 true
    expect((late.material as THREE.MeshBasicMaterial).wireframe).toBe(true);
  });

  it("重复 sync 不重拍快照；单 override 清除后该属性回落首拍原值（不保留中途外部改写）", () => {
    const mesh = makeMesh();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const cap = newCap(mesh);
    cap.setWireframe(true);
    mat.wireframe = true; // 模拟中途外部改材质
    cap.setDepthTest(false); // 再次 sync：快照已存在不重收
    cap.setWireframe(null);
    // 仍有 depthTest override → 不触发整体 restoreSnapshot，但被清除的 wireframe
    // 须回落首拍快照原值（false）。「null = 保持原始值」中的「原始值」指快照捕获的
    // 原值而非中途外部改写的现值——否则一次外部改写会永久污染该属性（撤销不回去）。
    expect(mat.wireframe).toBe(false);
    // 全清后整体还原为首拍原值 false
    cap.setDepthTest(null);
    expect(mat.wireframe).toBe(false);
  });
});

describe("RenderModeCapability — apply 与 sync 分支", () => {
  beforeEach(() => { resetEnvState(); }); // ADR-196 单例化：断言不依赖前序 describe 残留
  it("apply() 空场景不炸", () => {
    const cap = newCap();
    cap.apply();
    expect(cap.isEnabled()).toBe(false);
  });

  it("全 null overrides 时 apply 不触发还原（无快照）", () => {
    const mesh = makeMesh();
    const cap = newCap(mesh);
    cap.apply(); // hasAnyOverride=false 且 snapshot 空 → 无操作
    expect((mesh.material as THREE.MeshBasicMaterial).wireframe).toBe(false);
  });
});

describe("RenderModeCapability — getMenuNodes 读写全覆盖", () => {
  beforeEach(() => { resetEnvState(); }); // ADR-196 单例化：断言不依赖前序 describe 残留
  it("X 光 toggle：开 → depthTest=false，关 → 清 override", () => {
    const mesh = makeMesh();
    const cap = newCap(mesh);
    const node = cap.getMenuNodes().find((n) => n.id === "rm-depth-test")!;
    expect(node.control!.get!(undefined)).toBe(false);
    node.control!.set!(true);
    expect(cap.getDepthTest()).toBe(false);
    expect(node.control!.get!(undefined)).toBe(true);
    node.control!.set!(false);
    expect(cap.getDepthTest()).toBeNull();
  });

  it("面剔除 select：选择写 override", () => {
    const cap = newCap(makeMesh());
    const node = cap.getMenuNodes().find((n) => n.id === "rm-side")!;
    expect(node.control!.get!(undefined)).toBe(String(THREE.FrontSide));
    node.control!.set!(String(THREE.DoubleSide));
    expect(cap.getSide()).toBe(String(THREE.DoubleSide));
  });

  it("深度写入 toggle：默认开；关 → depthWrite=false，开 → 清 override", () => {
    const cap = newCap(makeMesh());
    const node = cap.getMenuNodes().find((n) => n.id === "rm-depth-write")!;
    expect(node.control!.get!(undefined)).toBe(true);
    node.control!.set!(false);
    expect(cap.getDepthWrite()).toBe(false);
    expect(node.control!.get!(undefined)).toBe(false);
    node.control!.set!(true);
    expect(cap.getDepthWrite()).toBeNull();
  });
});

describe("RenderModeCapability — getMenuNodes（ADR-195 刀2 cap 直产节点）", () => {
  beforeEach(() => { resetEnvState(); }); // ADR-196 单例化：断言不依赖前序 describe 残留
  it("返回 5 平铺节点，id/kind 齐全，settingsOrder 透传", () => {
    const cap = newCap(makeMesh());
    const nodes = cap.getMenuNodes();
    expect(nodes.map((n) => n.id)).toEqual([
      "rm-wireframe",
      "rm-blending",
      "rm-depth-test",
      "rm-side",
      "rm-depth-write",
    ]);
    expect(nodes.map((n) => n.kind)).toEqual(["toggle", "select", "toggle", "select", "toggle"]);
    // settingsOrder 透传（settings 聚合据此收编进 ⚙️ 设置面板）
    expect(nodes.map((n) => n.settingsOrder)).toEqual([30, 31, 32, 33, 34]);
  });

  it("toggle 节点读写闭包直连 cap（线框）", () => {
    const mesh = makeMesh();
    const cap = newCap(mesh);
    const wire = cap.getMenuNodes()[0]!;
    expect(wire.control!.get!(undefined)).toBe(false);
    wire.control!.set!(true);
    expect(cap.getWireframe()).toBe(true);
    expect((mesh.material as THREE.MeshBasicMaterial).wireframe).toBe(true);
    wire.control!.set!(false);
    expect(cap.getWireframe()).toBeNull();
  });

  it("select 节点 options/读写直连 cap（混合模式）", () => {
    const cap = newCap(makeMesh());
    const blending = cap.getMenuNodes()[1]!;
    expect(blending.control!.options!.length).toBe(4);
    blending.control!.set!(String(THREE.AdditiveBlending));
    expect(cap.getBlending()).toBe(String(THREE.AdditiveBlending));
  });
});

describe("RenderModeCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); resetEnvState(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    const cap = newCap(makeMesh());
    cap.setWireframe(true);
    cap.setBlending(THREE.AdditiveBlending);
    cap.setDepthTest(false);
    cap.setSide(THREE.DoubleSide);
    cap.setDepthWrite(false);
    cap.saveState();

    const cap2 = newCap(makeMesh());
    cap2.loadState();
    expect(cap2.getWireframe()).toBe(true);
    expect(cap2.getBlending()).toBe(THREE.AdditiveBlending);
    expect(cap2.getDepthTest()).toBe(false);
    expect(cap2.getSide()).toBe(THREE.DoubleSide);
    expect(cap2.getDepthWrite()).toBe(false);
    expect(cap2.isEnabled()).toBe(true);
  });

  it("loadState 空存储时早退", () => {
    const cap = newCap(makeMesh());
    cap.loadState();
    expect(cap.isEnabled()).toBe(false);
  });

  it("loadState null 值视为合法 override（清空该属性）", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ wireframe: null, depthWrite: null }));
    const cap = newCap(makeMesh());
    cap.setWireframe(true);
    cap.loadState();
    expect(cap.getWireframe()).toBeNull();
    expect(cap.getDepthWrite()).toBeNull();
  });

  it("loadState 类型不匹配的字段全部跳过", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      wireframe: "yes", blending: "add", depthTest: 1, side: "front", depthWrite: "x",
    }));
    const cap = newCap(makeMesh());
    cap.loadState();
    expect(cap.isEnabled()).toBe(false); // 一个都没恢复
  });

  it("loadState 部分类型匹配：匹配的恢复，不匹配的跳过", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      wireframe: true, blending: "not-a-number", side: 2, depthTest: "oops",
    }));
    const cap = newCap(makeMesh());
    cap.loadState();
    expect(cap.getWireframe()).toBe(true);
    expect(cap.getBlending()).toBeNull(); // 跳过
    expect(cap.getSide()).toBe(2);
    expect(cap.getDepthTest()).toBeNull(); // 跳过
  });

  it("loadState 后 sync 生效到材质", () => {
    const mesh = makeMesh();
    const cap = newCap(mesh);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ wireframe: true }));
    cap.loadState();
    expect((mesh.material as THREE.MeshBasicMaterial).wireframe).toBe(true);
  });
});

describe("RenderModeCapability — dispose", () => {
  beforeEach(() => { resetEnvState(); }); // ADR-196 单例化：断言不依赖前序 describe 残留
  it("dispose 还原已覆盖材质并清空 override", () => {
    const mesh = makeMesh();
    const cap = newCap(mesh);
    cap.setWireframe(true);
    cap.setDepthTest(false);
    cap.dispose();
    expect((mesh.material as THREE.MeshBasicMaterial).wireframe).toBe(false);
    expect((mesh.material as THREE.MeshBasicMaterial).depthTest).toBe(true);
    expect(cap.isEnabled()).toBe(false);
  });

  it("dispose 无快照时幂等不炸", () => {
    const cap = newCap(makeMesh());
    cap.dispose();
    cap.dispose();
    expect(cap.isEnabled()).toBe(false);
  });

  it("dispose 后再 apply 不复活覆盖", () => {
    const mesh = makeMesh();
    const cap = newCap(mesh);
    cap.setWireframe(true);
    cap.dispose();
    cap.apply();
    expect((mesh.material as THREE.MeshBasicMaterial).wireframe).toBe(false);
  });
});
