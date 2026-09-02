// ===== SceneRegistry 单测（ADR-093 T2）=====
// 覆盖：register/unregister/reset 生命周期、count/active 语义、
// visibleRoots/setVisible 可见性联动、setActive 菜单换项、pickModelByObject 父链反查。
// 纯 THREE.Object3D 隔离，无渲染依赖。

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { sceneRegistry, MAX_MODELS } from "./scene-registry.ts";
import type { PreviewMenuNode } from "../menu/node-types.ts";

function makeEntry(
  path: string,
  roots: THREE.Object3D[],
  opts?: {
    visible?: boolean;
    menuItems?: PreviewMenuNode[] | null;
    boneMaps?: unknown;
    onBonePick?: ((boneId: string) => void) | null;
  },
): string {
  return sceneRegistry.register({
    path,
    rtype: "test",
    roots,
    content: { dispose: vi.fn() } as any,
    boneMaps: (opts?.boneMaps ?? null) as any,
    menuItems: opts?.menuItems ?? null,
    onBonePick: opts?.onBonePick ?? null,
  });
}

describe("SceneRegistry 生命周期", () => {
  beforeEach(() => {
    sceneRegistry.reset();
  });

  it("register 返回唯一递增 id、置为 active、count 同步", () => {
    const a = makeEntry("a.glb", [new THREE.Object3D()]);
    expect(a).toBe("m1");
    expect(sceneRegistry.count()).toBe(1);
    expect(sceneRegistry.getActiveId()).toBe("m1");

    const b = makeEntry("b.glb", [new THREE.Object3D()]);
    expect(b).toBe("m2");
    expect(sceneRegistry.count()).toBe(2);
    expect(sceneRegistry.getActiveId()).toBe("m2");
  });

  it("unregister 删除 entry，activeId 回落到剩余最后一项", () => {
    const a = makeEntry("a.glb", [new THREE.Object3D()]); // m1
    const b = makeEntry("b.glb", [new THREE.Object3D()]); // m2
    sceneRegistry.unregister(a);
    expect(sceneRegistry.count()).toBe(1);
    expect(sceneRegistry.get(a)).toBeUndefined();
    expect(sceneRegistry.getActiveId()).toBe(b);
  });

  it("unregister 清空后 activeId 为 null", () => {
    const a = makeEntry("a.glb", [new THREE.Object3D()]);
    sceneRegistry.unregister(a);
    expect(sceneRegistry.count()).toBe(0);
    expect(sceneRegistry.getActiveId()).toBeNull();
  });

  it("reset 清空全部状态（entries/active/menuSink）", () => {
    makeEntry("a.glb", [new THREE.Object3D()]);
    makeEntry("b.glb", [new THREE.Object3D()]);
    const sink = { setAdapterItems: vi.fn() };
    sceneRegistry.setMenuSink(sink);
    sceneRegistry.reset();
    expect(sceneRegistry.count()).toBe(0);
    expect(sceneRegistry.getActiveId()).toBeNull();
    // reset 后 menuSink 清空：setActive 不应触发旧 sink
    const c = makeEntry("c.glb", [new THREE.Object3D()], { menuItems: [] });
    sceneRegistry.setActive(c);
    expect(sink.setAdapterItems).not.toHaveBeenCalled();
  });
});

describe("SceneRegistry 可见性 & 相机取景", () => {
  beforeEach(() => {
    sceneRegistry.reset();
  });

  it("setVisible 联动 entry + 每个 root.visible，visibleRoots 仅含可见", () => {
    const rootA = new THREE.Object3D();
    const rootB = new THREE.Object3D();
    const a = makeEntry("a.glb", [rootA]);
    const b = makeEntry("b.glb", [rootB]);

    sceneRegistry.setVisible(b, false);

    expect(rootB.visible).toBe(false);
    expect(rootA.visible).toBe(true);
    const visRoots = sceneRegistry.visibleRoots();
    expect(visRoots).toContain(rootA);
    expect(visRoots).not.toContain(rootB);
  });

  it("getVisible 排除不可见模型", () => {
    const a = makeEntry("a.glb", [new THREE.Object3D()]);
    const b = makeEntry("b.glb", [new THREE.Object3D()]);
    sceneRegistry.setVisible(b, false);
    const visible = sceneRegistry.getVisible();
    expect(visible.map((e) => e.id)).toContain(a);
    expect(visible.map((e) => e.id)).not.toContain(b);
  });
});

describe("SceneRegistry dispatch 换菜单", () => {
  beforeEach(() => {
    sceneRegistry.reset();
  });

  it("setActive 切换 activeId，存在 menuItems 时调用 menuSink.setAdapterItems", () => {
    const sink = { setAdapterItems: vi.fn() };
    sceneRegistry.setMenuSink(sink);
    const itemsA: PreviewMenuNode[] = [{ id: "ax" }] as any;
    const a = makeEntry("a.glb", [new THREE.Object3D()], { menuItems: itemsA });
    const b = makeEntry("b.glb", [new THREE.Object3D()], { menuItems: [{ id: "by" }] as any });

    sceneRegistry.setActive(a);
    expect(sceneRegistry.getActiveId()).toBe(a);
    expect(sink.setAdapterItems).toHaveBeenCalledWith(itemsA);
    expect(sink.setAdapterItems).toHaveBeenCalledTimes(1);
  });

  it("setActive 时 menuItems 为 null 不调用 sink", () => {
    const sink = { setAdapterItems: vi.fn() };
    sceneRegistry.setMenuSink(sink);
    const a = makeEntry("a.glb", [new THREE.Object3D()], { menuItems: null });
    sceneRegistry.setActive(a);
    expect(sink.setAdapterItems).not.toHaveBeenCalled();
  });
});

describe("SceneRegistry pickModelByObject 父链反查", () => {
  beforeEach(() => {
    sceneRegistry.reset();
  });

  it("命中 root 自身 / 子节点 均归属正确模型", () => {
    const rootA = new THREE.Object3D();
    const child = new THREE.Object3D();
    rootA.add(child);
    const rootB = new THREE.Object3D();
    const a = makeEntry("a.glb", [rootA]);
    const b = makeEntry("b.glb", [rootB]);

    expect(sceneRegistry.pickModelByObject(child)?.id).toBe(a);
    expect(sceneRegistry.pickModelByObject(rootA)?.id).toBe(a);
    expect(sceneRegistry.pickModelByObject(rootB)?.id).toBe(b);
  });

  it("命中无关对象 / null 返回 undefined（不误归基线或共享父）", () => {
    const rootA = new THREE.Object3D();
    makeEntry("a.glb", [rootA]);
    const unrelated = new THREE.Object3D(); // 不在任何已注册 root 树内
    expect(sceneRegistry.pickModelByObject(unrelated)).toBeUndefined();
    expect(sceneRegistry.pickModelByObject(null)).toBeUndefined();
  });
});

describe("MAX_MODELS 常量", () => {
  it("同场景最大模型数为 8", () => {
    expect(MAX_MODELS).toBe(8);
  });
});
