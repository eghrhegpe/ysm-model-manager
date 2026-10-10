// @vitest-environment happy-dom
// ===== unload-model × frustum-cull 三集合一致性契约（锐评 infra 轮 F1/F3/F6）=====
//
// 背景：`unloadModel` 同时维护**三个平行集合**：
//   ① `sceneRegistry.entries`（:50 unregister）
//   ② `ctx.allContent`（:41-42 splice）
//   ③ `frustum-cull.modelRoots`（**本文件关注点**——原 13 例测试对它零断言，F6）
//
// ① ② 有断言、③ 没有，正是「三个集合里有一个没人看」的形态。本文件把 ③ 补上，
// 并把「注销是否真的发生」从**推断**变成**实证**：
//   - 适配器的 dispose() 内部会 unregisterModelRoot（如 ysm-adapter.ts:579）——
//     故「正常 dispose」应使 modelRoots 归零；
//   - 但若 dispose 在**到达注销语句之前**抛错，根就永久残留（F3），
//     `unloadModel` 对此完全静默（F1 的实际机制）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { PreviewScene } from "@/preview-3d/adapters/mount-preview-core.ts";
import type { PreviewMenuHandle } from "@/preview-3d/menu/engine/core.ts";
import {
  clearModelRoots,
  getModelRootCount,
  registerModelRoot,
  unregisterModelRoot,
} from "./frustum-cull.ts";
import { sceneRegistry } from "./scene-registry.ts";
import { unloadModel, type UnloadCtx } from "./unload-model.ts";

function makeMenu(): PreviewMenuHandle {
  return {
    setAdapterItems: vi.fn(),
    refreshDock: vi.fn(),
  } as unknown as PreviewMenuHandle;
}

function makeCtx(over: Partial<UnloadCtx> = {}): UnloadCtx {
  return {
    allContent: [],
    scene: undefined,
    controls: undefined,
    camera: undefined,
    menuHandle: makeMenu(),
    getContent: () => null,
    setPerFrame: vi.fn(),
    removePerFrame: vi.fn(),
    ...over,
  };
}

/** 注册一个「adapter 形状」的模型：rootGroup 既进 registry.roots 又 registerModelRoot
 *  （与真实适配器同形：ysm-adapter.ts:244 register / :579 unregister 都在 dispose 内） */
function registerAdapterShaped(path: string, opts: { disposeThrows?: boolean } = {}) {
  const rootGroup = new THREE.Object3D();
  registerModelRoot(rootGroup);
  const content = {
    dispose: vi.fn(() => {
      if (opts.disposeThrows) {
        // 模拟「注销语句之前」抛错（如 rayCleanup/bonePanelRef 抛）——
        // 对齐 mmd-build-result.ts:182-196 / ysm-adapter.ts:576-580 的语句顺序
        throw new Error("panel cleanup failed");
      }
      unregisterModelRoot(rootGroup); // 正常路径：适配器自己注销
    }),
  } as unknown as PreviewScene;
  const id = sceneRegistry.register({
    path,
    rtype: "ysm",
    roots: [rootGroup],
    content,
  });
  return { id, rootGroup, content };
}

describe("unloadModel × modelRoots 三集合一致性", () => {
  beforeEach(() => {
    sceneRegistry.reset();
    clearModelRoots();
  });

  afterEach(() => {
    sceneRegistry.reset();
    clearModelRoots();
  });

  it("正常路径：适配器 dispose 内注销 → modelRoots 归零（三集合同步收敛）", () => {
    const { id } = registerAdapterShaped("a.glb");
    expect(getModelRootCount()).toBe(1);

    unloadModel(makeCtx(), id);

    expect(sceneRegistry.count(), "① 注册表").toBe(0);
    expect(getModelRootCount(), "③ modelRoots 也必须归零").toBe(0);
  });

  it("**[F1/F3 修复] dispose 抛错时 modelRoots 仍归零**——注销不再依赖适配器语句顺序", () => {
    const { id, rootGroup } = registerAdapterShaped("b.glb", { disposeThrows: true });

    unloadModel(makeCtx(), id);

    expect(sceneRegistry.count(), "① 注册表已清").toBe(0);
    expect(
      getModelRootCount(),
      "③ modelRoots 也必须归零（修前残留 1：注销被抛错跳过，根被模块级数组钉住）",
    ).toBe(0);
    expect(rootGroup.parent, "该根已脱离场景").toBeNull();
  });

  it("[F1 分支回归] 残留根不再使 length 虚高（单根豁免分支不被绕过）", () => {
    const dead = registerAdapterShaped("dead.glb", { disposeThrows: true });
    const live = registerAdapterShaped("live.glb", {});
    expect(getModelRootCount()).toBe(2);

    unloadModel(makeCtx(), dead.id);

    // 卸载后用户眼中只剩 1 个模型，modelRoots 也应为 1 ⇒ 正确走 length===1 豁免分支
    expect(sceneRegistry.count()).toBe(1);
    expect(
      getModelRootCount(),
      "幽灵根已消除：计数与真实存活模型一致（修前为 2，致多根剔除路径被误入）",
    ).toBe(1);
    expect(live.rootGroup.parent ?? null).toBeNull();
  });

  it("重复注销安全：适配器 dispose 内再调一次 unregisterModelRoot 不炸（no-op）", () => {
    // 修法把注销收口到 unloadModel，但适配器 dispose 内保留同款调用 ⇒ 必然重复。
    // 本断言锁死「重复调用安全」，否则收口会引入二次注销崩溃。
    const { id } = registerAdapterShaped("c.glb", {});
    expect(getModelRootCount()).toBe(1);

    unloadModel(makeCtx(), id); // 内部先注销；随后 safeDispose → 适配器再注销一次

    expect(getModelRootCount(), "两次注销后仍为 0（幂等）").toBe(0);
  });
});
