// ===== register-built-scene 单元测试（mount 初载 / switchTo 注册链收编后的契约锁定）=====
// 锐评 P1-2：mount 与 switch 各自复刻「差量捕获 → 统计合并 → sceneRegistry.register」，
// 收编为单一实现后，本测试锁定两侧共用的字段映射与降级语义。

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { registerBuiltScene } from "./register-built-scene.ts";
import { sceneRegistry } from "./scene-registry.ts";
import { STATS_PANEL_ID } from "@/preview-3d/menu/panels/stats.ts";
import type { PreviewScene } from "@/preview-3d/adapters/mount-preview-core.ts";

beforeEach(() => {
  sceneRegistry.reset();
});

function makeContent(menuItems: PreviewScene["menuItems"] = []): PreviewScene {
  return {
    dispose: () => {},
    menuItems,
    boneMaps: null,
  };
}

describe("registerBuiltScene", () => {
  it("差量捕获：roots 只含 build 后新增的子节点，注册即置活跃", () => {
    const scene = new THREE.Scene();
    const preExisting = new THREE.Group();
    scene.add(preExisting);
    const diffSet = new Set(scene.children);
    const addedRoot = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    scene.add(addedRoot);

    const content = makeContent();
    const menuItems = registerBuiltScene({
      path: "a/ysm",
      rtype: "ysm",
      content,
      scene,
      diffSet,
    });

    const entry = sceneRegistry.get(sceneRegistry.getActiveId()!);
    expect(entry?.path).toBe("a/ysm");
    expect(entry?.roots).toEqual([addedRoot]);
    expect(sceneRegistry.getActiveId()).toBeTruthy();
    // 空菜单 + 有 mesh → 返回仅含统计面板（ADR-131 P1「能渲染就能出统计」）
    expect(menuItems.map((n) => n.id)).toEqual([STATS_PANEL_ID]);
  });

  it("scene 或 diffSet 缺失 → roots 落空数组，仍完成注册", () => {
    const content = makeContent();
    const menuItems = registerBuiltScene({
      path: "b/vrm",
      rtype: "vrm",
      content,
      scene: undefined,
      diffSet: null,
    });
    const entry = sceneRegistry.get(sceneRegistry.getActiveId()!);
    expect(entry?.roots).toEqual([]);
    // 空差量 → 统计全 0 → hasSceneStats 拦截，不注入统计面板
    expect(menuItems).toEqual([]);
  });

  it("全空场景（无 mesh/bone）→ 不注入统计面板，返回适配器原 menuItems", () => {
    const menuItems = registerBuiltScene({
      path: "c/litematic",
      rtype: "litematic",
      content: makeContent(),
      scene: new THREE.Scene(),
      diffSet: new Set(),
    });
    expect(menuItems).toEqual([]);
  });

  it("boneMaps/onBonePick/displayName/components 透传进注册 entry", () => {
    const onBonePick = () => {};
    const boneMaps = { byName: new Map() } as never;
    const content = makeContent();
    content.boneMaps = boneMaps;
    content.onBonePick = onBonePick;
    registerBuiltScene({
      path: "d/pack",
      rtype: "resourcepack",
      content,
      scene: null,
      diffSet: null,
      displayName: "资源包 X",
      components: ["d/pack", "d/pack2"],
    });
    const entry = sceneRegistry.get(sceneRegistry.getActiveId()!);
    expect(entry?.boneMaps).toBe(boneMaps);
    expect(entry?.onBonePick).toBe(onBonePick);
    expect(entry?.displayName).toBe("资源包 X");
    expect(entry?.components).toEqual(["d/pack", "d/pack2"]);
  });
});
