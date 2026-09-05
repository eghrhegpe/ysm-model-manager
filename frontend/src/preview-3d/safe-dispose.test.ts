// @vitest-environment node
// ===== safeDispose / disposeObject3D 契约测试 =====
// 覆盖：safeDispose 四分支；disposeObject3D 递归释放、uuid 去重防共享实例
// double-dispose（god rays / 光锥双交叉 plane）、detach、自定义 disposeMaterial。
import * as THREE from "three";
import { describe, it, expect, vi } from "vitest";
import { disposeObject3D, safeDispose } from "./safe-dispose.ts";

describe("safeDispose", () => {
  it("null / undefined 不抛错", () => {
    expect(() => safeDispose(null)).not.toThrow();
    expect(() => safeDispose(undefined)).not.toThrow();
  });

  it("正常对象 → 调用 dispose", () => {
    const dispose = vi.fn();
    safeDispose({ dispose });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("dispose 抛错 → 被吞（不向调用方传播）", () => {
    const dispose = vi.fn(() => {
      throw new Error("boom");
    });
    expect(() => safeDispose({ dispose })).not.toThrow();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("无 dispose 方法的对象 → 不抛错", () => {
    expect(() => safeDispose({})).not.toThrow();
  });
});

describe("disposeObject3D", () => {
  it("null 不抛错；递归释放子树 geometry/material", () => {
    expect(() => disposeObject3D(null)).not.toThrow();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const geoSpy = vi.spyOn(mesh.geometry, "dispose");
    const matSpy = vi.spyOn(mesh.material, "dispose");
    disposeObject3D(mesh);
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
  });

  it("共享 geometry/material 的多 mesh 只 dispose 一次（uuid 去重）", () => {
    const group = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const geoSpy = vi.spyOn(geo, "dispose");
    const matSpy = vi.spyOn(mat, "dispose");
    group.add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo, mat));
    disposeObject3D(group);
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
  });

  it("detach=true 时先从父节点移除 root", () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    disposeObject3D(mesh, { detach: true });
    expect(mesh.parent).toBeNull();
  });

  it("disposeMaterial 自定义释放器接管材质释放（贴图槽清扫 opt-in）", () => {
    const mat = new THREE.MeshBasicMaterial();
    const custom = vi.fn();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    const matSpy = vi.spyOn(mat, "dispose");
    disposeObject3D(mesh, { disposeMaterial: custom });
    expect(custom).toHaveBeenCalledTimes(1);
    expect(matSpy).not.toHaveBeenCalled(); // 默认释放器被接管
  });
});
