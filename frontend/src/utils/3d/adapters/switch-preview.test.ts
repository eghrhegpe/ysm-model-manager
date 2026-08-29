// ===== switchToSession 陈旧字段修复测试 =====
// 验证：ctx 中经 getter 访问的字段（built / sceneBaseline）
// 在 ctx 构造后被修改时，switchToSession 能读到最新值——
// 而非构造时快照的旧值（修复前的 bug）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { SwitchContext } from "./switch-preview.ts";
import { switchToSession, syncLightTargetFromContent } from "./switch-preview.ts";
import type { PreviewBuildCtx, PreviewScene, PreviewHandle } from "./mount-preview-core.ts";
import { collectSceneStats } from "../scene-stats.ts";
import { mergeStatsMenuItems } from "./preview-menu/stats.ts";
import { sceneRegistry, MAX_MODELS } from "./scene-registry.ts";
import { bus } from "../../../bus.ts";

beforeEach(() => {
  sceneRegistry.reset();
});

afterEach(() => {
  // 恢复 spyOn 的 console.error 等（新增错误路径用例依赖 spy，防跨用例串扰）
  vi.restoreAllMocks();
});

/** 构造最小可用的 mock 测试上下文 */
function makeMockCtx(): {
  ctx: SwitchContext;
  state: {
    built: PreviewScene | null;
    sceneBaseline: Set<THREE.Object3D> | null;
    perFrame: ((dt: number) => void) | null;
    currentPath: string;
    _handle: PreviewHandle | null;
  };
  mockScene: THREE.Scene;
  mockAdapter: { build: ReturnType<typeof vi.fn> };
} {
  const state = {
    built: null as PreviewScene | null,
    sceneBaseline: null as Set<THREE.Object3D> | null,
    perFrame: null as ((dt: number) => void) | null,
    currentPath: "initial.glb",
    _handle: null as PreviewHandle | null,
  };

  const mockScene = new THREE.Scene();
  const loadingEl = document.createElement("div");
  const viewContainer = document.createElement("div");
  const overlay = document.createElement("div");
  const allBuilt: PreviewScene[] = [];

  const mockAdapter = {
    build: vi.fn().mockResolvedValue({
      dispose: vi.fn(),
    }),
  };

  const ctx: SwitchContext = {
    scene: mockScene,
    getSceneBaseline: () => state.sceneBaseline,
    getBuilt: () => state.built,
    setBuilt: (s) => { state.built = s; },
    allBuilt,
    loadingEl,
    viewContainer,
    overlay,
    menuHandle: { dispose: vi.fn(), setAdapterItems: vi.fn(), openPanel: vi.fn(), refreshDock: vi.fn() } as any,
    adapter: mockAdapter,
    camBridge: undefined,
    selfMode: false,
    renderer: undefined,
    controls: undefined,
    orbitTarget: undefined,
    camera: undefined,
    lightCap: null,
    shadowCap: null,
    environmentCap: null,
    getCurrentPath: () => state.currentPath,
    setCurrentPath: (p) => { state.currentPath = p; },
    getCurrentRtype: () => state.currentPath,
    getPerFrame: () => state.perFrame,
    setPerFrame: (f) => { state.perFrame = f; },
    getHandle: () => state._handle,
    aborted: { v: false },
    inFlight: false,
    isDisposed: { v: false },
    myGen: 1,
    getGen: () => 1,
  };

  return { ctx, state, mockScene, mockAdapter };
}

describe("switchToSession 陈旧字段修复", () => {
  it("built 字段在 ctx 构造后被 setBuilt 更新，switchTo 能读到最新值（旧模型 dispose）", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    const oldDispose = vi.fn();
    // 模拟首次 build 后的状态
    state.built = { dispose: oldDispose } as PreviewScene;

    await switchToSession(ctx, "new.glb");

    // 关键断言：旧模型的 dispose 必须被调用（修复前因 ctx.built 快照为 null 而永不触发）
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(mockAdapter.build).toHaveBeenCalledWith(
      expect.objectContaining({}),
      "new.glb",
    );
  });

  it("sceneBaseline 字段在 ctx 构造后被赋值，switchTo 能读到最新值", async () => {
    const { ctx, state, mockScene, mockAdapter } = makeMockCtx();
    const childA = new THREE.Mesh();
    mockScene.add(childA);
    // 模拟首次 build 后设置 sceneBaseline
    state.sceneBaseline = new Set(mockScene.children);

    await switchToSession(ctx, "new.glb");

    // 关键断言：stale filter 必须使用最新 snapshot
    // childA 在 baseline 中，不应被移除；mockScene 的子节点数不变
    expect(mockScene.children.length).toBe(1);
    expect(mockAdapter.build).toHaveBeenCalledTimes(1);
  });

  it("currentPath 字段在 ctx 构造后更新，第二次 switchTo 使用最新路径", async () => {
    const { ctx, state } = makeMockCtx();

    await switchToSession(ctx, "first.glb");
    expect(state.currentPath).toBe("first.glb");

    await switchToSession(ctx, "second.glb");
    expect(state.currentPath).toBe("second.glb");
  });

  it("perFrame 字段在 ctx 构造后更新，switchTo 后 perFrame 为新模型的 update", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    const nextUpdate = vi.fn();
    mockAdapter.build.mockResolvedValue({
      dispose: vi.fn(),
      update: nextUpdate,
    } as unknown as PreviewScene);

    await switchToSession(ctx, "new.glb");
    expect(state.perFrame).toBe(nextUpdate);
  });

  it("r12 P1：并发切换抑制——inFlight 期间第二次 switchTo 直接丢弃，build 只调用一次", async () => {
    const { ctx, mockAdapter } = makeMockCtx();
    // 让首次 build 永不 resolve，保持 inFlight=true
    mockAdapter.build.mockReturnValue(new Promise<PreviewScene>(() => {}));

    const p1 = switchToSession(ctx, "first.glb");
    const p2 = switchToSession(ctx, "second.glb"); // 应被 inFlight 拦截

    expect(ctx.inFlight).toBe(true);
    expect(mockAdapter.build).toHaveBeenCalledTimes(1);
    expect(mockAdapter.build).toHaveBeenCalledWith(expect.anything(), "first.glb");

    p1.catch(() => {});
    p2.catch(() => {});
  });

  it("r12 P2：aborted 引用对象——closeOverlay 后 switchToSession 入口守卫生效（不再值捕获失效）", async () => {
    const { ctx } = makeMockCtx();
    // 模拟 closeOverlay 设置 aborted.v = true（引用对象，switchToSession 能读到）
    ctx.aborted.v = true;
    // 入口守卫应在读 ctx.aborted.v 时 return，不触发 build
    // 注意：inFlight=false 已复位（上次正常出口），此处验证 aborted 通道
    const mockAdapter2 = (ctx.adapter as unknown as { build: ReturnType<typeof vi.fn> }).build;
    await switchToSession(ctx, "new.glb");
    expect(mockAdapter2).not.toHaveBeenCalled();
  });
});

describe("syncLightTargetFromContent 陈旧字段修复", () => {
  it("sceneBaseline 为 null 时跳过（首次 build 前）", () => {
    const setTargetSpy = vi.fn();
    const mockLightCap = { setTarget: setTargetSpy, setTargetHeight: vi.fn() } as any;
    const scene = new THREE.Scene();

    syncLightTargetFromContent(scene, null, mockLightCap);
    expect(setTargetSpy).not.toHaveBeenCalled();
  });

  it("sceneBaseline 非空时正确更新 lightCap target", () => {
    const setTargetSpy = vi.fn();
    const setTargetHeightSpy = vi.fn();
    const mockLightCap = { setTarget: setTargetSpy, setTargetHeight: setTargetHeightSpy } as any;
    const scene = new THREE.Scene();
    const baseline = new Set<THREE.Object3D>();
    const content = new THREE.Mesh();
    scene.add(content);
    baseline.add(content); // content 是基线的一部分，不算增量

    syncLightTargetFromContent(scene, baseline, mockLightCap);
    expect(setTargetSpy).not.toHaveBeenCalled(); // 无增量内容
  });

  it("sceneBaseline 中存在增量内容时更新 lightCap target", () => {
    const setTargetSpy = vi.fn();
    const setTargetHeightSpy = vi.fn();
    const mockLightCap = { setTarget: setTargetSpy, setTargetHeight: setTargetHeightSpy } as any;
    const scene = new THREE.Scene();
    const baseline = new Set<THREE.Object3D>();
    const content = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    content.position.set(1, 2, 3);
    scene.add(content);
    // 不加入 baseline = 增量内容

    syncLightTargetFromContent(scene, baseline, mockLightCap);
    expect(setTargetSpy).toHaveBeenCalledTimes(1);
    expect(setTargetHeightSpy).toHaveBeenCalledTimes(1);
  });
});

describe("switchToSession dock 菜单刷新（ADR-131 C1 修复）", () => {
  it("切换后 dock 菜单按新模型 menuItems 刷新（含统计面板，不再残留首模型菜单）", async () => {
    const { ctx, state, mockScene, mockAdapter } = makeMockCtx();
    // 首模型已由 mount3D 注册进注册表（含统计面板）——模拟 dock 停在首模型菜单
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    state.sceneBaseline = new Set([mesh]);
    mockScene.add(mesh);
    const firstMenuItems = [{ id: "model-a", kind: "panel" as const, icon: "x", labelKey: "", fallback: "A" }];
    sceneRegistry.reset();
    sceneRegistry.register({
      path: "initial.glb",
      rtype: "vrm",
      roots: [mesh],
      built: { dispose: vi.fn() } as unknown as PreviewScene,
      menuItems: mergeStatsMenuItems(firstMenuItems, collectSceneStats(mesh)),
    });

    // 新模型 build：往 scene 挂新 mesh + 返回自己的 menuItems（无统计面板）
    const newMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mockAdapter.build.mockImplementation(async (_ctx: PreviewBuildCtx) => {
      mockScene.add(newMesh);
      return {
        dispose: vi.fn(),
        menuItems: [{ id: "model-b", kind: "panel", icon: "y", labelKey: "", fallback: "B" }],
      } as unknown as PreviewScene;
    });

    await switchToSession(ctx, "new.glb");

    // dock 被按新模型菜单刷新：适配器项 B + 新模型统计面板（不再残留 A）
    const setAdapterItemsMock = (ctx.menuHandle as unknown as { setAdapterItems: ReturnType<typeof vi.fn> }).setAdapterItems;
    expect(setAdapterItemsMock).toHaveBeenCalled();
    const lastCall = setAdapterItemsMock.mock.calls.at(-1)![0] as Array<{ id: string }>;
    const ids = lastCall.map((n) => n.id);
    expect(ids).toContain("model-b");
    expect(ids).toContain("stats-panel");
    expect(ids).not.toContain("model-a");
  });

  it("新模型无 menuItems 且无统计 → dock 清空适配器项（不残留旧菜单）", async () => {
    const { ctx, state, mockScene, mockAdapter } = makeMockCtx();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    state.sceneBaseline = new Set([mesh]);
    mockScene.add(mesh);
    sceneRegistry.reset();
    sceneRegistry.register({
      path: "initial.glb",
      rtype: "vrm",
      roots: [mesh],
      built: { dispose: vi.fn() } as unknown as PreviewScene,
      menuItems: [{ id: "model-a", kind: "panel", icon: "x", labelKey: "", fallback: "A" }],
    });

    // 新模型 build 返回空 menuItems、不挂 mesh（无统计）
    mockAdapter.build.mockResolvedValue({ dispose: vi.fn() } as unknown as PreviewScene);

    await switchToSession(ctx, "empty.glb");

    const setAdapterItemsMock = (ctx.menuHandle as unknown as { setAdapterItems: ReturnType<typeof vi.fn> }).setAdapterItems;
    expect(setAdapterItemsMock).toHaveBeenCalledWith([]);
  });
});

// ===== [审核修复] buildSwitchContent 注入的 switchTo 延迟闭包跨重建存活（ADR-132 pack select 连续切换） =====
describe("switch 重建后 switchTo 延迟闭包（pack 多模型 select 连续切换回归）", () => {
  it("重建后的 buildCtx.switchTo 非 undefined，且转发到当前会话 handle.switchTo（第二次切换不失效）", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    const handleSwitch = vi.fn(() => Promise.resolve());
    state._handle = { cleanup: vi.fn(), switchTo: handleSwitch } as PreviewHandle;

    // 第一次切换（会话内重建）：build 收到延迟闭包而非 undefined
    await switchToSession(ctx, "a.json");
    const firstCtx = mockAdapter.build.mock.calls[0][0] as PreviewBuildCtx;
    expect(typeof firstCtx.switchTo).toBe("function");
    await firstCtx.switchTo?.("b.json");
    // 闭包透传 options 参数（undefined 时仍显式传，与 mount3D 初次注入闭包同构）
    expect(handleSwitch).toHaveBeenCalledWith("b.json", undefined);

    // 第二次切换：重建后的新 buildCtx.switchTo 仍是活闭包 → 连续切换不失效
    // （修复前 buildSwitchContent 传 undefined，重建后 select onSelect 短路静默 no-op）
    await switchToSession(ctx, "b.json");
    const secondCtx = mockAdapter.build.mock.calls[1][0] as PreviewBuildCtx;
    expect(typeof secondCtx.switchTo).toBe("function");
    await secondCtx.switchTo?.("c.json");
    expect(handleSwitch).toHaveBeenCalledWith("c.json", undefined);
  });

  it("无活跃会话 handle 时 switchTo 闭包 no-op 不抛（与 switchPreview 同口径）", async () => {
    const { ctx, mockAdapter } = makeMockCtx(); // state._handle 保持 null
    await switchToSession(ctx, "a.json");
    const buildCtx = mockAdapter.build.mock.calls[0][0] as PreviewBuildCtx;
    await expect(buildCtx.switchTo?.("x.json")).resolves.toBeUndefined();
  });
});

// ===== 守卫 / 恢复 / 同步分支补测（覆盖率攻坚：错误路径 + keep 多模型 + caps 同步）=====
describe("switchToSession 守卫分支", () => {
  it("ADR-093 T6：keep 同台追加且注册表已满 → toast 拦截，不触发 build（inFlight 不卡死）", async () => {
    const { ctx, mockAdapter } = makeMockCtx();
    sceneRegistry.reset();
    // 填满注册表：MAX_MODELS 条最小记录
    for (let i = 0; i < MAX_MODELS; i++) {
      sceneRegistry.register({
        path: `m${i}.glb`,
        rtype: "vrm",
        roots: [],
        built: { dispose: vi.fn() } as unknown as PreviewScene,
      });
    }
    const toasts: unknown[] = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    try {
      await switchToSession(ctx, "extra.glb", { keepInScene: true });
      expect(toasts).toHaveLength(1);
      expect(String((toasts[0] as { msg: string }).msg)).toContain("已达上限");
      expect(mockAdapter.build).not.toHaveBeenCalled();
      // ADR-093 T6 code review P1：上限拦截在 inFlight 置位前判 → 复位不卡死
      expect(ctx.inFlight).toBe(false);
    } finally {
      off();
    }
  });

  it("P3-2：空/空白路径守卫 → 不触发 build", async () => {
    const { ctx, mockAdapter } = makeMockCtx();
    await switchToSession(ctx, "   ");
    expect(mockAdapter.build).not.toHaveBeenCalled();
  });
});

describe("switchToSession build 失败恢复（recoverSwitchFailure）", () => {
  it("build 抛错 → 恢复链：旧 perFrame 置空 + allBuilt 清空 + loadingEl 归位 + inFlight 复位", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // 预置：旧 built 已在 allBuilt 内（首次 mount 后形态）
    const oldBuilt = { dispose: vi.fn() } as unknown as PreviewScene;
    state.built = oldBuilt;
    state.perFrame = () => {};
    ctx.allBuilt.push(oldBuilt);
    sceneRegistry.reset();
    sceneRegistry.register({
      path: "initial.glb",
      rtype: "vrm",
      roots: [],
      built: oldBuilt,
    });
    mockAdapter.build.mockRejectedValue(new Error("boom"));

    await switchToSession(ctx, "bad.glb");

    expect(errSpy).toHaveBeenCalled();
    expect(state.perFrame).toBeNull();
    // 旧内容层 dispose（清除段）+ 失败恢复不重复 push
    expect(state.built).toBeNull();
    expect(ctx.allBuilt).toHaveLength(0);
    // loadingEl 无父节点时归位 viewContainer（showLoadFailure 前置）
    expect(ctx.loadingEl.parentNode).toBe(ctx.viewContainer);
    // 注册表残留旧 entry 已注销
    expect(sceneRegistry.getActiveId()).toBeNull();
    expect(sceneRegistry.count()).toBe(0);
    // inFlight 复位（r12 P1 死锁防护）
    expect(ctx.inFlight).toBe(false);
  });

  it("keep=true build 失败 → 补释放旧 built（清除段跳过 dispose 的兜底）", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const oldDispose = vi.fn();
    state.built = { dispose: oldDispose } as unknown as PreviewScene;
    mockAdapter.build.mockRejectedValue(new Error("boom"));

    await switchToSession(ctx, "bad.glb", { keepInScene: true });

    // keep 模式清除段不 dispose，恢复段补释放
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(ctx.inFlight).toBe(false);
  });

  it("aborted 迟到失败 → 静默复位 inFlight，不弹错不清理", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.built = { dispose: vi.fn() } as unknown as PreviewScene;
    state.perFrame = () => {};
    // 延迟 reject：beginSwitch 放行后、build 悬置期间翻转 aborted（P2 迟到失败场景）
    let rejectBuild!: (e: unknown) => void;
    mockAdapter.build.mockReturnValue(
      new Promise<PreviewScene>((_, rej) => { rejectBuild = rej; }),
    );
    const p = switchToSession(ctx, "bad.glb");
    ctx.aborted.v = true; // 用户已关闭预览后 build 才失败
    rejectBuild(new Error("late boom"));
    await p;

    // P2 守卫：不 console.error、不清 perFrame/allBuilt，仅复位 inFlight
    expect(errSpy).not.toHaveBeenCalled();
    expect(state.perFrame).not.toBeNull();
    expect(state.built).not.toBeNull();
    expect(ctx.inFlight).toBe(false);
  });
});

describe("switchToSession 代际/中止守卫丢弃新内容层", () => {
  it("build 成功后 aborted → guardSwitchAborted 丢弃新内容层（dispose + 不兑现切换）", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    const nextDispose = vi.fn();
    // 延迟 resolve：在 await 期间翻转 aborted
    let resolveBuild!: (v: PreviewScene) => void;
    mockAdapter.build.mockReturnValue(
      new Promise<PreviewScene>((res) => { resolveBuild = res; }),
    );
    const p = switchToSession(ctx, "new.glb");
    ctx.aborted.v = true;
    resolveBuild({ dispose: nextDispose } as unknown as PreviewScene);
    await p;

    // 新内容层被 safeDispose，切换未兑现（built 不变、路径不变、菜单不刷新）
    expect(nextDispose).toHaveBeenCalledTimes(1);
    expect(state.built).toBeNull();
    expect(state.currentPath).toBe("initial.glb");
    expect(ctx.menuHandle.setAdapterItems).not.toHaveBeenCalled();
    expect(ctx.inFlight).toBe(false);
  });

  it("build 成功后代际过期（invalidate）→ 同样丢弃新内容层", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    const nextDispose = vi.fn();
    let resolveBuild!: (v: PreviewScene) => void;
    mockAdapter.build.mockReturnValue(
      new Promise<PreviewScene>((res) => { resolveBuild = res; }),
    );
    const p = switchToSession(ctx, "new.glb");
    ctx.myGen = 2; // 模拟 _gen 已前进
    resolveBuild({ dispose: nextDispose } as unknown as PreviewScene);
    await p;

    expect(nextDispose).toHaveBeenCalledTimes(1);
    expect(state.built).toBeNull();
  });
});

describe("switchToSession 内容层历史与基线维护", () => {
  it("非 keep 切换：allBuilt 中非 active 的孤儿条目被 safeDispose（GPU 孤儿泄漏防护）", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    const orphanDispose = vi.fn();
    const activeDispose = vi.fn();
    const orphan = { dispose: orphanDispose } as unknown as PreviewScene;
    const active = { dispose: activeDispose } as unknown as PreviewScene;
    ctx.allBuilt.push(orphan, active);
    state.built = active; // active 不在历史清理段重复释放（清除段 dispose）

    await switchToSession(ctx, "new.glb");

    expect(orphanDispose).toHaveBeenCalledTimes(1);
    // 切换后 allBuilt 只含新 built
    expect(ctx.allBuilt).toHaveLength(1);
    expect(state.built).not.toBe(orphan);
  });

  it("keep=true 追加：allBuilt 保留历史并 push 新 built", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    const oldDispose = vi.fn();
    state.built = { dispose: oldDispose } as unknown as PreviewScene;
    ctx.allBuilt.push(state.built);

    await switchToSession(ctx, "extra.glb", { keepInScene: true });

    // 同台模式旧 built 不释放（仍在场景中）
    expect(oldDispose).not.toHaveBeenCalled();
    expect(ctx.allBuilt).toHaveLength(2);
  });

  it("updateSwitchBaseline：切换后基线排除本次新增量（幽灵网格累积防护）", async () => {
    const { ctx, state, mockScene, mockAdapter } = makeMockCtx();
    const mesh = new THREE.Mesh();
    mockScene.add(mesh);
    state.sceneBaseline = new Set([mesh]); // 基线：mesh 是装饰
    const baselines: Array<Set<THREE.Object3D>> = [];
    ctx.setSceneBaseline = (s) => {
      state.sceneBaseline = s;
      baselines.push(s);
    };

    await switchToSession(ctx, "new.glb");

    // mockAdapter 默认 build 不往 scene 挂新对象 → added 为空 → 基线 = 全量 scene.children
    expect(baselines).toHaveLength(1);
    expect(baselines[0].has(mesh)).toBe(true);
  });

  it("旧内容层 dispose 抛错 → console.error 记录但不阻断切换", async () => {
    const { ctx, state, mockAdapter } = makeMockCtx();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.built = {
      dispose: () => { throw new Error("dispose fail"); },
    } as unknown as PreviewScene;

    await switchToSession(ctx, "new.glb");

    expect(errSpy).toHaveBeenCalled();
    expect(mockAdapter.build).toHaveBeenCalledTimes(1);
    expect(ctx.inFlight).toBe(false);
  });
});

describe("switchToSession 场景注册与视图同步（scene=null 退化 + caps 接线）", () => {
  it("scene 缺失（self 模式）→ beforeBuild 为 null：注册空 roots 项 + dock 清空适配器项", async () => {
    const { ctx, mockAdapter } = makeMockCtx();
    ctx.scene = undefined; // self 模式：核心不提供共享 scene
    mockAdapter.build.mockResolvedValue({ dispose: vi.fn() } as unknown as PreviewScene);

    await switchToSession(ctx, "new.glb");

    // registerSwitchScene 无 beforeBuild 分支：注册 rtype=""、roots=[]
    const entry = sceneRegistry.getAll().find((e) => e.path === "new.glb");
    expect(entry).toBeDefined();
    expect(entry!.roots).toHaveLength(0);
    expect(entry!.rtype).toBe("");
    // 菜单刷新走「空数组」分支
    expect(ctx.menuHandle.setAdapterItems).toHaveBeenCalledWith([]);
    expect(ctx.inFlight).toBe(false);
  });

  it("renderer/orbitTarget/controls/camera 齐备 → orbitTarget 同步；shadowCap/environmentCap 消费新增量", async () => {
    const { ctx, state, mockScene, mockAdapter } = makeMockCtx();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mockScene.add(mesh);
    state.sceneBaseline = new Set([mesh]); // mesh 是基线装饰
    const newMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mockAdapter.build.mockImplementation(async () => {
      mockScene.add(newMesh); // 本次切换新增量
      return { dispose: vi.fn() } as unknown as PreviewScene;
    });
    ctx.renderer = {} as THREE.WebGLRenderer;
    ctx.controls = { target: new THREE.Vector3(1, 2, 3) } as unknown as SwitchContext["controls"];
    ctx.orbitTarget = new THREE.Vector3();
    ctx.camera = new THREE.PerspectiveCamera();
    const applyMeshCasts = vi.fn();
    ctx.shadowCap = { applyMeshCasts } as never;
    const syncMeshIntensity = vi.fn();
    ctx.environmentCap = { syncMeshIntensity } as never;

    await switchToSession(ctx, "new.glb");

    expect(ctx.orbitTarget.x).toBe(1);
    expect(applyMeshCasts).toHaveBeenCalledWith([newMesh]);
    expect(syncMeshIntensity).toHaveBeenCalledWith([newMesh]);
  });

  it("keep=true 多模型同框 → arrangeModelsInRow 排开 + fitCameraToRoots 重取景", async () => {
    const { ctx, mockScene, mockAdapter } = makeMockCtx();
    // 预注册两个可见模型（roots 有几何 → 包围盒宽度可算）
    sceneRegistry.reset();
    const rootA = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    const rootB = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    mockScene.add(rootA, rootB);
    sceneRegistry.register({ path: "a.glb", rtype: "vrm", roots: [rootA], built: { dispose: vi.fn() } as unknown as PreviewScene });
    sceneRegistry.register({ path: "b.glb", rtype: "vrm", roots: [rootB], built: { dispose: vi.fn() } as unknown as PreviewScene });

    mockAdapter.build.mockResolvedValue({ dispose: vi.fn() } as unknown as PreviewScene);
    ctx.camera = new THREE.PerspectiveCamera();
    ctx.controls = { target: new THREE.Vector3(), update: vi.fn() } as unknown as SwitchContext["controls"];

    await switchToSession(ctx, "c.glb", { keepInScene: true });

    // 两个已注册模型被 X 轴排开（位置不再重叠于原点）
    expect(rootA.position.x).not.toBe(0);
    expect(rootB.position.x).not.toBe(0);
    expect(rootA.position.x).not.toBe(rootB.position.x);
  });
});


describe("switchToSession 清理与排开边界", () => {
  it("非 keep 切换：不在基线内的旧内容层对象被移出 scene（快照 delta 清理）", async () => {
    const { ctx, state, mockScene, mockAdapter } = makeMockCtx();
    const baselineMesh = new THREE.Mesh(); // 装饰基线
    const staleMesh = new THREE.Mesh();     // 上次切换的内容层残留
    mockScene.add(baselineMesh, staleMesh);
    state.sceneBaseline = new Set([baselineMesh]);

    await switchToSession(ctx, "new.glb");

    expect(mockScene.children).toContain(baselineMesh);
    expect(mockScene.children).not.toContain(staleMesh);
  });

  it("keep=true 但注册表仅 0/1 个模型 → arrangeModelsInRow 早退不排开", async () => {
    const { ctx, mockAdapter } = makeMockCtx();
    sceneRegistry.reset(); // 0 个注册模型
    mockAdapter.build.mockResolvedValue({ dispose: vi.fn() } as unknown as PreviewScene);
    ctx.camera = new THREE.PerspectiveCamera();
    ctx.controls = { target: new THREE.Vector3(), update: vi.fn() } as unknown as SwitchContext["controls"];

    await expect(
      switchToSession(ctx, "solo.glb", { keepInScene: true }),
    ).resolves.toBeUndefined();
  });
});
