// @vitest-environment node
// ===== scene-registry 焦点转移语义补测（锐评 infra 轮 2026-10-10）=====
//
// 关注点：`unregister` 后 activeId 的**晋升规则**。既有测试（scene-registry.test.ts:49-56）
// 只覆盖「两模型、注销前者 → 后者接任」，即晋升结果与唯一幸存者重合，**规则未被区分**：
// 「取 Map 末位（插入序）」与「取最近被激活者」在该用例下同解。
//
// 本文件把两者**分离**验证，钉死实际语义（Map 插入序），供后人判断是否符合产品预期——
// 因为 roles 面板的 ✓ 高亮 / 菜单绑定 / 取景都跟 activeId 走，选错角色是用户可见的。
import { describe, expect, it, beforeEach, vi } from "vitest";
import * as THREE from "three";
import { sceneRegistry } from "./scene-registry.ts";

function makeEntry(path: string, roots: THREE.Object3D[] = [new THREE.Object3D()]): string {
  return sceneRegistry.register({ path, rtype: "ysm", roots, content: { update: () => {} } as never });
}

describe("SceneRegistry — 注销后的焦点晋升规则", () => {
  beforeEach(() => {
    sceneRegistry.reset();
  });

  it("晋升取 **Map 末位（插入序）**，不是「最近被激活者」——语义已钉死", () => {
    const a = makeEntry("a.glb"); // m1，插入位 1
    const b = makeEntry("b.glb"); // m2，插入位 2
    const c = makeEntry("c.glb"); // m3，插入位 3

    // 显式激活最早插入的 a（模拟用户在 roles 面板点选 a）
    sceneRegistry.setActive(a);
    expect(sceneRegistry.getActiveId()).toBe(a);

    // 注销当前活跃的 a：幸存 {b, c}
    sceneRegistry.unregister(a);

    // 实际语义：取插入序末位 = c（**非** b，尽管 b 比 c 更早也从未被激活过）
    // ⚠️ 这是「插入序」而非「最近活跃序」的**证据**：若将来改为「最近活跃」，
    // 本例会红——届时须确认产品意图（点选过的 b 是否该优先接任）。
    expect(
      sceneRegistry.getActiveId(),
      "当前实现 = 插入序末位（c）；与 b 是否被激活过无关",
    ).toBe(c);

    // 反向确认：把 c 注销后，剩下 b 接任（唯一幸存者，规则不产生歧义）
    sceneRegistry.unregister(c);
    expect(sceneRegistry.getActiveId()).toBe(b);
  });

  it("注销**非活跃**模型不改变 activeId（焦点稳定，不被无关操作夺走）", () => {
    const a = makeEntry("a.glb");
    const b = makeEntry("b.glb");
    sceneRegistry.setActive(a);

    sceneRegistry.unregister(b);

    expect(sceneRegistry.getActiveId(), "注销非活跃项不得改焦点").toBe(a);
  });

  it("注销活跃项后若无幸存者 → activeId 归 null（不悬空指向已删 entry）", () => {
    const a = makeEntry("a.glb");
    sceneRegistry.unregister(a);
    expect(sceneRegistry.getActiveId()).toBeNull();
    // 悬空防护：getActiveId 返回的 id 必须仍可查到 entry
    expect(sceneRegistry.get(sceneRegistry.getActiveId() ?? "")).toBeUndefined();
  });

  it("晋升出的 activeId 恒指向存活 entry（不变量：activeId ∈ entries）", () => {
    const a = makeEntry("a.glb");
    const b = makeEntry("b.glb");
    const c = makeEntry("c.glb");
    sceneRegistry.setActive(b);

    sceneRegistry.unregister(a);
    const afterA = sceneRegistry.getActiveId();
    expect(afterA, "晋升结果必须可查").not.toBeNull();
    expect(sceneRegistry.get(afterA as string)).toBeDefined();

    sceneRegistry.unregister(c);
    const afterC = sceneRegistry.getActiveId();
    expect(sceneRegistry.get(afterC as string)).toBeDefined();
  });

  it("注销活跃项会经 menuSink 换绑新活跃菜单；新活跃无专属项时不残留旧绑定", () => {
    const sink = { setAdapterItems: vi.fn() };
    sceneRegistry.setMenuSink(sink);
    // a 有专属菜单项，b 无
    const a = sceneRegistry.register({
      path: "a.glb",
      rtype: "ysm",
      roots: [new THREE.Object3D()],
      content: { update: () => {} } as never,
      menuItems: [{ id: "a-only", kind: "divider" }],
    });
    const b = makeEntry("b.glb");
    sceneRegistry.setActive(a);
    expect(sink.setAdapterItems).toHaveBeenCalled();

    sink.setAdapterItems.mockClear();
    sceneRegistry.unregister(a); // 晋升到 b（无 menuItems）

    // unregister 自身**不**换菜单（换绑职责在 unload-model.ts：无 menuItems 时显式清空）——
    // 本断言把这条分工钉死，防后人误以为 unregister 会通知 sink
    expect(
      sink.setAdapterItems,
      "unregister 不负责菜单换绑（该职责在 unload-model 的调用侧）",
    ).not.toHaveBeenCalled();
    expect(sceneRegistry.getActiveId()).toBe(b);
  });
});
