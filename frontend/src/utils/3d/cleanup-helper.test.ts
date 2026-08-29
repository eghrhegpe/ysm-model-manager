// @vitest-environment node
// ===== cleanup-helper.ts 契约测试 =====
// 覆盖：disposeDebugGroup 按 Mesh/Line/Sprite 分支释放 geometry/material/纹理
// （含数组材质、null 材质、null 组防御），disposeSceneMeshes 默认/关纹理两模式。
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { disposeDebugGroup, disposeSceneMeshes } from "./cleanup-helper.ts";

describe("disposeDebugGroup", () => {
  it("null → no-op 不抛", () => {
    expect(() => disposeDebugGroup(null)).not.toThrow();
  });

  it("Mesh：geometry / material / map 纹理全部释放", () => {
    const geo = new THREE.BufferGeometry();
    const geoSpy = vi.spyOn(geo, "dispose");
    const map = new THREE.Texture();
    const mapSpy = vi.spyOn(map, "dispose");
    const mat = new THREE.MeshBasicMaterial({ map });
    const matSpy = vi.spyOn(mat, "dispose");

    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, mat));
    disposeDebugGroup(group);

    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
    expect(mapSpy).toHaveBeenCalledTimes(1); // disposeMaterial 显式释放贴图
  });

  it("Mesh 数组材质 → 每个材质都释放", () => {
    const mats = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    const spies = mats.map((m) => vi.spyOn(m, "dispose"));
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BufferGeometry(), mats));
    disposeDebugGroup(group);
    spies.forEach((s) => expect(s).toHaveBeenCalledTimes(1));
  });

  it("Line：geometry / material 释放（直连 dispose）；material null 不抛", () => {
    const geo = new THREE.BufferGeometry();
    const geoSpy = vi.spyOn(geo, "dispose");
    const mat = new THREE.LineBasicMaterial();
    const matSpy = vi.spyOn(mat, "dispose");
    const group = new THREE.Group();
    group.add(new THREE.Line(geo, mat));
    // null 材质：源码 lm?.dispose() 防御路径（three 构造签名不含 null，断言注入）
    group.add(new THREE.Line(new THREE.BufferGeometry(), null as unknown as THREE.Material));
    expect(() => disposeDebugGroup(group)).not.toThrow();
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
  });

  it("Sprite：material 经 disposeMaterial 释放（含 map 纹理）", () => {
    const map = new THREE.Texture();
    const mapSpy = vi.spyOn(map, "dispose");
    const mat = new THREE.SpriteMaterial({ map });
    const matSpy = vi.spyOn(mat, "dispose");
    const group = new THREE.Group();
    group.add(new THREE.Sprite(mat));
    disposeDebugGroup(group);
    expect(matSpy).toHaveBeenCalledTimes(1);
    expect(mapSpy).toHaveBeenCalledTimes(1);
  });

  it("纯 Group 嵌套 + 无标志 Object3D → 不抛、无 dispose 调用", () => {
    const plain = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(new THREE.Object3D());
    plain.add(inner);
    expect(() => disposeDebugGroup(plain)).not.toThrow();
  });
});

describe("disposeSceneMeshes", () => {
  it("默认：场景内 Mesh 的 geometry / material / map 纹理全部释放", () => {
    const scene = new THREE.Scene();
    const geo = new THREE.BufferGeometry();
    const geoSpy = vi.spyOn(geo, "dispose");
    const map = new THREE.Texture();
    const mapSpy = vi.spyOn(map, "dispose");
    const mat = new THREE.MeshBasicMaterial({ map });
    const matSpy = vi.spyOn(mat, "dispose");
    scene.add(new THREE.Mesh(geo, mat));

    disposeSceneMeshes(scene);
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
    expect(mapSpy).toHaveBeenCalledTimes(1);
  });

  it("disposeTextures:false → 材质释放、map 纹理保留", () => {
    const scene = new THREE.Scene();
    const map = new THREE.Texture();
    const mapSpy = vi.spyOn(map, "dispose");
    const mat = new THREE.MeshBasicMaterial({ map });
    const matSpy = vi.spyOn(mat, "dispose");
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), mat));

    disposeSceneMeshes(scene, { disposeTextures: false });
    expect(matSpy).toHaveBeenCalledTimes(1);
    expect(mapSpy).not.toHaveBeenCalled();
  });

  it("Mesh 数组材质 → 每个都释放；非 Mesh 节点跳过；空场景不抛", () => {
    const scene = new THREE.Scene();
    const mats = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    const spies = mats.map((m) => vi.spyOn(m, "dispose"));
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), mats));
    scene.add(new THREE.Group()); // 无 isMesh 标志 → 跳过

    expect(() => disposeSceneMeshes(scene)).not.toThrow();
    spies.forEach((s) => expect(s).toHaveBeenCalledTimes(1));

    expect(() => disposeSceneMeshes(new THREE.Scene())).not.toThrow();
  });
});
