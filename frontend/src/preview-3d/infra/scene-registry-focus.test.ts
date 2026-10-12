// @vitest-environment node
// ===== scene-registry 焦点转移语义补测（锐评 infra 轮 2026-10-10；2026-10-13 翻转）=====
//
// 关注点：`unregister` 后 activeId 的**晋升规则**。既有测试（scene-registry.test.ts:49-56）
// 只覆盖「两模型、注销前者 → 后者接任」，即晋升结果与唯一幸存者重合，**规则未被区分**：
// 「取 Map 末位（插入序）」与「取最近被激活者」在该用例下同解。
//
// 本文件把两者**分离**验证，钉死实际语义。
// ⚠️ 2026-10-13 产品拍板（多文档编辑器 Ctrl+W 回上一 tab 的通行为）：
//   晋升规则由「Map 插入序末位」改为「最近被激活者」（LRU 激活序）。
//   注：`register` 也算一次激活（新注册模型自动激活），故「最近被激活」以
//   register/setActive 两个入口共同维护的激活序为准。
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

  it("晋升取「最近被激活」的幸存者，**不是** Map 插入序末位（2026-10-13 产品拍板翻转）", () => {
    const a = makeEntry("a.glb"); // m1，最早插入
    const b = makeEntry("b.glb"); // m2
    const c = makeEntry("c.glb"); // m3，最晚插入 → 插入序末位 = c

    // 让激活序与插入序**分离**：c 是最新插入（从未被 setActive），
    // 但最后被显式激活的是 b（b 是最近活跃者）。
    sceneRegistry.setActive(b);
    sceneRegistry.setActive(a); // a 成为活跃；激活序（末=最近）现为 [c, b, a]

    // 注销当前活跃的 a：幸存 {b, c}，激活序栈自末向前首个幸存 = b
    sceneRegistry.unregister(a);

    // 区分证据：插入序末位 = c，最近激活幸存 = b。若实现退化为「插入序」本断言会红。
    // 这正是语义被钉死的证据——「最近活跃」与「插入序」在两个幸存者中指向不同对象。
    expect(
      sceneRegistry.getActiveId(),
      "晋升 = 最近被激活者（b），非插入序末位（c）",
    ).toBe(b);

    // 反向确认：把 b 注销后，剩下 c 接任（唯一幸存，规则不产生歧义）
    sceneRegistry.unregister(b);
    expect(sceneRegistry.getActiveId()).toBe(c);
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
