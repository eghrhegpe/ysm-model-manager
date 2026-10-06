// @vitest-environment happy-dom
// ===== infra/unload-model —— 卸载路径的成对释放与归属转移不变量 =====
// 覆盖（mount-preview-core.test.ts 的集成用例未断言的部分）：
//  ① 释放成对性：dispose 无条件执行（entry.content 不在 allContent 时也不漏——cooperate
//     跨 session 注册）、perFrame 按引用注销、setPerFrame(null) 只在卸载当前会话源时发生
//     （否则停掉别的会话 rAF）；
//  ② 容器一致性：allContent 按引用精确移除（不误删同形状的别的条目）；roots 逐根出场景；
//  ③ 早退契约：未知 id 零副作用（不 dispose、不 touch 菜单）；
//  ④ 归属转移：新活跃有专属项 → setActive；无专属项/无活跃 → 显式清空适配器项；
//  ⑤ 取景重算只在有可见根时执行；safeDispose 语义（dispose 抛错不阻断后续注销）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PreviewScene } from "@/preview-3d/adapters/mount-preview-core.ts";
import type { PreviewMenuHandle } from "@/preview-3d/menu/engine/core.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";
import { sceneRegistry } from "./scene-registry.ts";
import { unloadModel, type UnloadCtx } from "./unload-model.ts";

/** 仅占位：注册表只判 menuItems 的真值，不消费元素形状 */
const MENU_ITEMS = [{}] as unknown as PreviewMenuNode[];

function makeContent(over: Partial<PreviewScene> = {}): PreviewScene {
  return { dispose: vi.fn(), ...over } as unknown as PreviewScene;
}

interface RegisterOpts {
  content: PreviewScene;
  roots?: THREE.Object3D[];
  menuItems?: PreviewMenuNode[] | null;
}

function register(path: string, opts: RegisterOpts): string {
  return sceneRegistry.register({
    path,
    rtype: "ysm",
    roots: opts.roots ?? [],
    content: opts.content,
    menuItems: opts.menuItems ?? null,
  });
}

interface Rig {
  ctx: UnloadCtx;
  allContent: PreviewScene[];
  setAdapterItems: ReturnType<typeof vi.fn>;
  refreshDock: ReturnType<typeof vi.fn>;
  removePerFrame: ReturnType<typeof vi.fn>;
  setPerFrame: ReturnType<typeof vi.fn>;
}

function makeRig(over: Partial<UnloadCtx> = {}): Rig {
  const setAdapterItems = vi.fn();
  const refreshDock = vi.fn();
  const removePerFrame = vi.fn();
  const setPerFrame = vi.fn();
  const allContent: PreviewScene[] = [];
  const ctx: UnloadCtx = {
    allContent,
    scene: undefined,
    controls: undefined,
    camera: undefined,
    menuHandle: { setAdapterItems, refreshDock } as unknown as PreviewMenuHandle,
    getContent: () => null,
    setPerFrame,
    removePerFrame,
    ...over,
  };
  return { ctx, allContent, setAdapterItems, refreshDock, removePerFrame, setPerFrame };
}

beforeEach(() => {
  localStorage.clear();
  sceneRegistry.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  sceneRegistry.reset();
  localStorage.clear();
});

describe("unloadModel —— 早退与释放成对性", () => {
  it("未知 id → 零副作用：不 dispose、不注销 perFrame、不碰菜单", () => {
    const rig = makeRig();
    const content = makeContent();
    register("/a.ysm", { content });

    unloadModel(rig.ctx, "m-not-exist");

    expect(content.dispose).not.toHaveBeenCalled();
    expect(rig.removePerFrame).not.toHaveBeenCalled();
    expect(rig.setPerFrame).not.toHaveBeenCalled();
    expect(rig.setAdapterItems).not.toHaveBeenCalled();
    expect(rig.refreshDock).not.toHaveBeenCalled();
    expect(sceneRegistry.count()).toBe(1);
  });

  it("内容层不在 allContent（跨 session 注册）→ 仍无条件 dispose，且不误删他人条目", () => {
    const other = makeContent();
    const victim = makeContent();
    const rig = makeRig();
    rig.allContent.push(other); // victim 刻意不在其中
    const id = register("/victim.ysm", { content: victim });

    unloadModel(rig.ctx, id);

    expect(victim.dispose).toHaveBeenCalledTimes(1);
    expect(rig.allContent).toEqual([other]); // 长度与内容都不变（不越界 splice）
  });

  it("内容层在 allContent → 按引用精确移除该条，其余保持原序", () => {
    const a = makeContent();
    const b = makeContent();
    const c = makeContent();
    const rig = makeRig();
    rig.allContent.push(a, b, c);
    const id = register("/b.ysm", { content: b });

    unloadModel(rig.ctx, id);

    expect(rig.allContent).toEqual([a, c]);
  });

  it("roots 逐根出场景（每根一次，按 roots 数组引用）；scene 缺失时不抛", () => {
    const remove = vi.fn();
    const r1 = new THREE.Object3D();
    const r2 = new THREE.Object3D();
    const rig = makeRig({ scene: { remove } as unknown as THREE.Scene });
    const id = register("/r.ysm", { roots: [r1, r2], content: makeContent() });

    unloadModel(rig.ctx, id);
    expect(remove.mock.calls.map((call) => call[0])).toEqual([r1, r2]);

    // scene 未建（挂载失败态）→ 不得抛
    const bare = makeRig();
    const id2 = register("/r2.ysm", { roots: [new THREE.Object3D()], content: makeContent() });
    expect(() => unloadModel(bare.ctx, id2)).not.toThrow();
  });

  it("perFrame 按引用注销：removePerFrame 收到 content.update；update 缺失时不调用且不抛", () => {
    const update = vi.fn();
    const rig = makeRig();
    const id = register("/u.ysm", { content: makeContent({ update }) });

    unloadModel(rig.ctx, id);
    expect(rig.removePerFrame).toHaveBeenCalledTimes(1);
    expect(rig.removePerFrame).toHaveBeenCalledWith(update);

    const rig2 = makeRig();
    const id2 = register("/nou.ysm", { content: makeContent() }); // 无 update（静态模型）
    expect(() => unloadModel(rig2.ctx, id2)).not.toThrow();
    expect(rig2.removePerFrame).not.toHaveBeenCalled();
  });

  it("setPerFrame(null) 仅在卸载当前会话内容源时发生（否则会停掉别的会话的 rAF）", () => {
    const victim = makeContent({ update: vi.fn() });
    const current = makeRig({ getContent: () => victim });
    const id = register("/cur.ysm", { content: victim });
    unloadModel(current.ctx, id);
    expect(current.setPerFrame).toHaveBeenCalledTimes(1);
    expect(current.setPerFrame).toHaveBeenCalledWith(null);

    const otherSource = makeContent();
    const bystander = makeRig({ getContent: () => otherSource });
    const victim2 = makeContent({ update: vi.fn() });
    const id2 = register("/other.ysm", { content: victim2 });
    unloadModel(bystander.ctx, id2);
    expect(victim2.dispose).toHaveBeenCalledTimes(1);
    expect(bystander.setPerFrame).not.toHaveBeenCalled(); // 当前源另有其人 → 不清
  });

  it("内容层 dispose 抛错不阻断注销与菜单复位（safeDispose 语义）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rig = makeRig();
    const content = makeContent({
      dispose: vi.fn(() => {
        throw new Error("boom");
      }),
    });
    const id = register("/throw.ysm", { content });

    expect(() => unloadModel(rig.ctx, id)).not.toThrow();
    expect(sceneRegistry.get(id)).toBeUndefined();
    expect(rig.refreshDock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled(); // 不静默
    warn.mockRestore();
  });
});

describe("unloadModel —— 归属转移与取景重算", () => {
  it("新活跃有专属菜单项 → setActive(next)，不留残缺绑定", () => {
    const spy = vi.spyOn(sceneRegistry, "setActive");
    const rig = makeRig();
    const survivor = register("/survivor.ysm", { content: makeContent(), menuItems: MENU_ITEMS });
    const victim = register("/victim.ysm", { content: makeContent() });

    unloadModel(rig.ctx, victim);

    expect(sceneRegistry.getActiveId()).toBe(survivor);
    expect(spy).toHaveBeenCalledWith(survivor);
    expect(rig.refreshDock).toHaveBeenCalledTimes(1);
  });

  it("新活跃无专属项 → 显式清空适配器项（不残留已卸载模型的菜单绑定）", () => {
    const spy = vi.spyOn(sceneRegistry, "setActive");
    const rig = makeRig();
    const survivor = register("/plain.ysm", { content: makeContent(), menuItems: null });
    const victim = register("/victim.ysm", { content: makeContent() });

    unloadModel(rig.ctx, victim);

    expect(sceneRegistry.getActiveId()).toBe(survivor);
    expect(spy).not.toHaveBeenCalled();
    expect(rig.setAdapterItems).toHaveBeenCalledWith([]);
  });

  it("卸载最后一个 → 无活跃也清空适配器项；refreshDock 仍刷新一次", () => {
    const rig = makeRig();
    const id = register("/only.ysm", { content: makeContent() });

    unloadModel(rig.ctx, id);

    expect(sceneRegistry.getActiveId()).toBeNull();
    expect(rig.setAdapterItems).toHaveBeenCalledWith([]);
    expect(rig.refreshDock).toHaveBeenCalledTimes(1);
  });

  it("存在可见根 → 卸载后按剩余可见根重新取景", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 5000);
    const controls = new OrbitControls(camera, document.createElement("canvas"));
    controls.enableDamping = false;
    camera.position.set(999, 999, 999);

    const survivorRoot = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const survivor = register("/keep.ysm", { roots: [survivorRoot], content: makeContent() });
    const victim = register("/drop.ysm", {
      roots: [new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))],
      content: makeContent(),
    });
    const rig = makeRig({ camera, controls });

    unloadModel(rig.ctx, victim);
    expect(sceneRegistry.get(survivor)).toBeDefined();
    expect(camera.position.x).not.toBe(999); // 被重取景
  });

  it("无可见根 → 相机保持原视角（不把空场景拉回默认取景）", () => {
    const camera2 = new THREE.PerspectiveCamera(50, 1, 0.05, 5000);
    const controls2 = new OrbitControls(camera2, document.createElement("canvas"));
    controls2.enableDamping = false;
    camera2.position.set(999, 999, 999);
    const rig2 = makeRig({ camera: camera2, controls: controls2 });
    const last = register("/last.ysm", {
      roots: [new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))],
      content: makeContent(),
    });

    unloadModel(rig2.ctx, last);
    expect(sceneRegistry.visibleRoots()).toEqual([]);
    expect(camera2.position.toArray()).toEqual([999, 999, 999]);
  });

  it("重复卸载同一 id：第二次早退（dispose / refreshDock 不叠加）", () => {
    const rig = makeRig();
    const content = makeContent({ update: vi.fn() });
    const id = register("/dup.ysm", { content });

    unloadModel(rig.ctx, id);
    unloadModel(rig.ctx, id);

    expect(content.dispose).toHaveBeenCalledTimes(1);
    expect(rig.refreshDock).toHaveBeenCalledTimes(1);
    expect(rig.removePerFrame).toHaveBeenCalledTimes(1);
  });
});
