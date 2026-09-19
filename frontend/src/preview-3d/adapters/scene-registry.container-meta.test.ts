// ===== SceneRegistry 容器元数据 + visible 持久化测试（ADR-159 + 2026 锐评 P1）=====
// 覆盖：displayName/components 透传、去重更新、setMenuSink(null) 语义、
// getAll 排序确定性、visible 持久化（safeGet 恢复 / safeSet 落盘 / 去重重载恢复）。
// storage 经 vi.mock 隔离——用例间无 localStorage 串扰。

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { sceneRegistry } from "@/preview-3d/infra/scene-registry.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";

const storage = vi.hoisted(() => ({
  get: vi.fn((_key: string) => null as string | null),
  set: vi.fn((_key: string, _val: string) => undefined),
}));

vi.mock("@/utils/base/primitives/storage.ts", () => ({
  safeGet: (key: string) => storage.get(key),
  safeSet: (key: string, val: string) => storage.set(key, val),
  safeRemove: vi.fn(),
  safeGetJSON: vi.fn((_k: string, fb: unknown) => fb),
}));

function reg(path: string, roots: THREE.Object3D[], extra: Record<string, unknown> = {}) {
  return sceneRegistry.register({
    path,
    rtype: "test",
    roots,
    content: { dispose: vi.fn() } as any,
    ...extra,
  });
}

const ITEM: PreviewMenuNode = { id: "x" } as any;

beforeEach(() => {
  sceneRegistry.reset();
  storage.get.mockClear();
  storage.get.mockImplementation(() => null);
  storage.set.mockClear();
});

describe("SceneRegistry 容器元数据（ADR-159）", () => {
  it("register displayName/components 透传，get 可读", () => {
    const id = reg("pack.zip", [new THREE.Object3D()], {
      displayName: "MyPack",
      components: ["a.glb", "b.glb"],
    });
    const e = sceneRegistry.get(id);
    expect(e?.displayName).toBe("MyPack");
    expect(e?.components).toEqual(["a.glb", "b.glb"]);
  });

  it("去重重载：displayName 传入则刷新、缺省则保留旧值", () => {
    const id = reg("a.glb", [new THREE.Object3D()], { displayName: "x" });
    // 刷新
    sceneRegistry.register({
      path: "a.glb",
      rtype: "test",
      roots: [new THREE.Object3D()],
      content: { dispose: vi.fn() } as any,
      displayName: "y",
    });
    expect(sceneRegistry.get(id)?.displayName).toBe("y");
    // 缺省 displayName → 保留 "y"
    sceneRegistry.register({
      path: "a.glb",
      rtype: "test",
      roots: [new THREE.Object3D()],
      content: { dispose: vi.fn() } as any,
    });
    expect(sceneRegistry.get(id)?.displayName).toBe("y");
  });

  it("setMenuSink(null) 后 setActive 不再触发旧 sink", () => {
    const sink = { setAdapterItems: vi.fn() };
    sceneRegistry.setMenuSink(sink);
    const id = reg("a.glb", [new THREE.Object3D()], { menuItems: [ITEM] });
    sceneRegistry.setActive(id);
    expect(sink.setAdapterItems).toHaveBeenCalledTimes(1);

    sceneRegistry.setMenuSink(null);
    sceneRegistry.setActive(id);
    expect(sink.setAdapterItems).toHaveBeenCalledTimes(1); // 不再增加
  });

  it("getAll 按注册顺序返回（排序确定性）", () => {
    reg("a.glb", [new THREE.Object3D()]);
    reg("b.glb", [new THREE.Object3D()]);
    reg("c.glb", [new THREE.Object3D()]);
    expect(sceneRegistry.getAll().map((e) => e.path)).toEqual(["a.glb", "b.glb", "c.glb"]);
  });
});

describe("SceneRegistry visible 持久化（2026 锐评 P1）", () => {
  it("register 时 safeGet='0' → 恢复隐藏（entry + root.visible 联动）", () => {
    storage.get.mockImplementation((k) => (k === "ysm:model-visible:a.glb" ? "0" : null));
    const root = new THREE.Object3D();
    const id = reg("a.glb", [root]);
    expect(sceneRegistry.get(id)?.visible).toBe(false);
    expect(root.visible).toBe(false);
  });

  it("safeGet 缺省（null）→ 默认可见", () => {
    const root = new THREE.Object3D();
    const id = reg("a.glb", [root]);
    expect(sceneRegistry.get(id)?.visible).toBe(true);
    expect(root.visible).toBe(true);
  });

  it("setVisible(false) 落盘 '0'、(true) 落盘 '1'（键 = 模型 path）", () => {
    const id = reg("a.glb", [new THREE.Object3D()]);
    sceneRegistry.setVisible(id, false);
    expect(storage.set).toHaveBeenLastCalledWith("ysm:model-visible:a.glb", "0");
    sceneRegistry.setVisible(id, true);
    expect(storage.set).toHaveBeenLastCalledWith("ysm:model-visible:a.glb", "1");
  });

  it("去重重载恢复持久化隐藏（新 roots 继承 visible=false）", () => {
    storage.get.mockImplementation((k) => (k === "ysm:model-visible:a.glb" ? "0" : null));
    const rootNew = new THREE.Object3D();
    const id = reg("a.glb", [rootNew]);
    expect(sceneRegistry.get(id)?.visible).toBe(false);
    expect(rootNew.visible).toBe(false);
  });
});
