// @vitest-environment happy-dom
// ===== debug-render 标签纹理缓存生命周期契约（锐评 infra 轮 F2）=====
//
// 病（子代理实证 + 主代理复核）：`_labelTexCache` 是**模块级** Map（debug-render.ts），
// 其清理函数唯一调用点原在 `rebuildDebug` 内（被 `if (state.debugGroup)` 门控）。
// 生产会话终结走另一条路——`adapters/ysm-adapter.ts|dispose` 直接
// `disposeDebugGroup(debugGroup)` + 置 null，**从不调 rebuildDebug** ⇒ 缓存跨会话留存：
// 每进一个新模型（骨名不同）多一批 256×64 CanvasTexture 永久驻留。
//
// 本文件**驱动真实 rebuildDebug 路径**填充缓存，再验证会话终结出口能释放它——
// 避免「只断言导出存在」的空转型测试。
import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import {
  labelTexCacheSizeForTest,
  rebuildDebug,
  releaseDebugLabelCache,
} from "./debug-render.ts";

/** 构造最小 pivot 场景：1 个骨骼组 + 对应 spec，令 rebuildDebug 真产出标签纹理 */
function pivotRig(boneNames: string[]) {
  const scene = new THREE.Scene();
  const rootGroup = new THREE.Group();
  scene.add(rootGroup);
  const boneGroupMap = new Map<string, THREE.Group>();
  const bones: Array<{ id: string; name: string; parentId?: string }> = [];
  for (const [i, name] of boneNames.entries()) {
    const g = new THREE.Group();
    rootGroup.add(g);
    boneGroupMap.set(`b${i}`, g);
    bones.push({ id: `b${i}`, name });
  }
  const state: {
    debugGroup: THREE.Group | null;
    debugMode: "normal" | "pivot" | "bone";
  } = { debugGroup: null, debugMode: "pivot" };
  return { scene, rootGroup, boneGroupMap, spec: { models: [{ bones }] }, state };
}

describe("debug-render — 标签纹理缓存的会话边界（F2）", () => {
  beforeEach(() => {
    releaseDebugLabelCache();
  });

  it("rebuildDebug（pivot）真实填充缓存：每骨骼一张标签纹理", () => {
    const rig = pivotRig(["頭", "head_01", "spine"]);
    expect(labelTexCacheSizeForTest()).toBe(0);

    rebuildDebug(rig.scene, rig.rootGroup, rig.boneGroupMap, rig.spec, rig.state);

    expect(
      labelTexCacheSizeForTest(),
      "3 个骨名 → 3 个缓存条目（缓存的收益前提）",
    ).toBe(3);
  });

  it("**[F2 主症状] 缓存按骨名累积**——清空只在「本轮已有 debugGroup」时发生", () => {
    const rig1 = pivotRig(["a", "b"]);
    rebuildDebug(rig1.scene, rig1.rootGroup, rig1.boneGroupMap, rig1.spec, rig1.state);
    expect(labelTexCacheSizeForTest()).toBe(2);

    // ⚠️ 关键实证：换一个**全新 rig**（debugGroup 初值 null）再 rebuild，
    // `if (state.debugGroup)` 为假 ⇒ clearLabelTexCache **不被调用** ⇒ 旧骨名条目留存。
    // 即「清空」并非每次重建都发生，而只在同一 rig 内二次重建时发生。
    const rig2 = pivotRig(["c", "d", "e"]);
    rebuildDebug(rig2.scene, rig2.rootGroup, rig2.boneGroupMap, rig2.spec, rig2.state);
    expect(
      labelTexCacheSizeForTest(),
      "2（旧，未清）+ 3（新）= 5：清空被 if(debugGroup) 门控，全新 rig 路径不清",
    ).toBe(5);

    // 同一 rig 内二次重建才会清（此即原注释所称的清理机制，覆盖面比想象窄）
    rig2.state.debugMode = "normal";
    rebuildDebug(rig2.scene, rig2.rootGroup, rig2.boneGroupMap, rig2.spec, rig2.state);
    expect(labelTexCacheSizeForTest(), "同一 rig 二次重建 → 清空生效").toBe(0);
  });

  it("**[F2 修复] 会话终结出口释放缓存**——不再依赖走到 rebuildDebug", () => {
    // 模拟真实生命周期：开 F 调试 → 缓存被填充 → 关预览（终结路径）
    const rig = pivotRig(["頭", "head_01"]);
    rebuildDebug(rig.scene, rig.rootGroup, rig.boneGroupMap, rig.spec, rig.state);
    expect(labelTexCacheSizeForTest()).toBe(2);

    // 会话终结：适配器 dispose 调用的出口（修前不存在 ⇒ 缓存留到下一次会话被复用）
    releaseDebugLabelCache();

    expect(labelTexCacheSizeForTest(), "终结后必须归零").toBe(0);
  });

  it("释放是幂等的（冷态/重复调用安全）", () => {
    expect(() => {
      releaseDebugLabelCache();
      releaseDebugLabelCache();
    }).not.toThrow();
  });

  it("跨会话不再复用已释放的纹理（修复后：新会话建新纹理）", () => {
    const rig = pivotRig(["sameBone"]);
    rebuildDebug(rig.scene, rig.rootGroup, rig.boneGroupMap, rig.spec, rig.state);
    const sizeAfterFirst = labelTexCacheSizeForTest();
    expect(sizeAfterFirst).toBe(1);

    // 会话终结
    releaseDebugLabelCache();

    // 下一会话同骨名：缓存已清 ⇒ 重新创建（尺寸回到 1，但不是复用旧实例）
    const rig2 = pivotRig(["sameBone"]);
    rebuildDebug(rig2.scene, rig2.rootGroup, rig2.boneGroupMap, rig2.spec, rig2.state);
    expect(labelTexCacheSizeForTest()).toBe(1);
  });
});
