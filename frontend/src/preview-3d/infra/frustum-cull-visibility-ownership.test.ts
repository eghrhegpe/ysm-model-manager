// ===== 回归：剔除/兜底不得抹掉「按模型隐藏」意图 =====
// 背景（2026-09 修复前）：restoreModelGroupsVisible() 无条件 root.visible = true，
// 而 sceneRegistry.setVisible(id,false) 写的是同一批引用（roots == modelRoots：
// register-built-scene 用 scene.children 差量捕获，捕获到的正是 adapter 里
// scene.add + registerModelRoot 的同一个 rootGroup）→ 剔除默认关时 render-host
// 每帧调兜底函数，用户点「隐藏」下一帧即复活。
// 现按抑制态归属判定：只还原本模块压下的根。
import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearModelRoots,
  cullModelGroups,
  registerModelRoot,
  restoreModelGroupsVisible,
  unregisterModelRoot,
} from "./frustum-cull.ts";
import { sceneRegistry } from "./scene-registry.ts";

function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  return cam;
}

/** 模拟 adapter：rootGroup 既 scene.add + registerModelRoot，又被差量捕获进 registry.roots */
function mountModel(path: string, scene: THREE.Scene, rootGroup: THREE.Group): string {
  scene.add(rootGroup);
  registerModelRoot(rootGroup);
  return sceneRegistry.register({
    path,
    rtype: "ysm",
    roots: [rootGroup],
    content: { dispose: () => {} } as never,
  });
}

describe("回归：隐藏意图 vs 剔除兜底", () => {
  beforeEach(() => {
    clearModelRoots();
    sceneRegistry.reset();
    // setVisible 会经 safeSet 落盘 "ysm:model-visible:<path>"（路径同名会跨用例串扰），
    // 故每例清空本地存储——否则上一例的隐藏态被 persistedVisible 恢复。
    localStorage.clear();
  });

  it("剔除关闭（默认）时，兜底不复活用户隐藏的模型", () => {
    const scene = new THREE.Scene();
    const rootGroup = new THREE.Group();
    const id = mountModel("/m/a.ysm", scene, rootGroup);

    sceneRegistry.setVisible(id, false);
    expect(rootGroup.visible).toBe(false);

    // 下一帧：render-host 剔除关闭分支
    restoreModelGroupsVisible();

    expect(rootGroup.visible).toBe(false); // 隐藏意图守住（修复前为 true）
  });

  it("多模型：隐藏其一，其余不受牵连", () => {
    const scene = new THREE.Scene();
    const a = new THREE.Group();
    const b = new THREE.Group();
    const idA = mountModel("/m/a.ysm", scene, a);
    mountModel("/m/b.ysm", scene, b);

    sceneRegistry.setVisible(idA, false);
    restoreModelGroupsVisible();

    expect(a.visible).toBe(false);
    expect(b.visible).toBe(true);
  });

  it("剔除压下的根仍会被兜底恢复（保住原兜底职责）", () => {
    const scene = new THREE.Scene();
    const near = new THREE.Group();
    const far = new THREE.Group();
    far.position.set(10000, 10000, 10000);
    mountModel("/m/near.ysm", scene, near);
    mountModel("/m/far.ysm", scene, far);

    cullModelGroups(makeCamera());
    expect(far.visible).toBe(false); // 极远组被剔除

    restoreModelGroupsVisible();
    expect(far.visible).toBe(true); // 我们压下的 → 我们还原
    expect(near.visible).toBe(true);
  });

  it("剔除压下的根 + 用户另隐藏的根：兜底只恢复前者", () => {
    const scene = new THREE.Scene();
    const near = new THREE.Group();
    const far = new THREE.Group();
    const hidden = new THREE.Group();
    far.position.set(10000, 10000, 10000);
    mountModel("/m/near.ysm", scene, near);
    mountModel("/m/far.ysm", scene, far);
    const idHidden = mountModel("/m/hidden.ysm", scene, hidden);

    sceneRegistry.setVisible(idHidden, false);
    cullModelGroups(makeCamera());
    restoreModelGroupsVisible();

    expect(far.visible).toBe(true); // 剔除态被还原
    expect(hidden.visible).toBe(false); // 用户意图不被越权覆盖
  });

  it("常驻可见的注册根：兜底零写入（不触发无谓 dirty）", () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    // 非空根：单根分支判据 v = isMesh || children.length>0 恒 true，与现状一致不写
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    mountModel("/m/a.ysm", scene, root);

    // 没有任何剔除发生 → _culled 为空 → 兜底不做写入
    restoreModelGroupsVisible();
    expect(root.visible).toBe(true);
  });

  it("注销后不再被兜底触碰（抑制态随注销摘除）", () => {
    const scene = new THREE.Scene();
    const near = new THREE.Group();
    const far = new THREE.Group();
    far.position.set(10000, 10000, 10000);
    mountModel("/m/near.ysm", scene, near);
    mountModel("/m/far.ysm", scene, far);

    cullModelGroups(makeCamera());
    expect(far.visible).toBe(false); // far 被剔除并登记抑制态

    unregisterModelRoot(far); // adapter dispose
    restoreModelGroupsVisible();

    // 已注销的根不再由我们负责还原（引用可能已被释放/复用）
    expect(far.visible).toBe(false);
  });
});
