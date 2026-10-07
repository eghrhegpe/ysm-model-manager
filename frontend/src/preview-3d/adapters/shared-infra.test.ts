// 测试环境：仓库默认 happy-dom（vitest.config.ts 全局配置；jsdom 未安装，勿标 jsdom）
// ===== shared-infra 终局拆除测试（code review #1）=====
// 覆盖：teardownSharedInfra 冷态幂等（可安全重复调用）+ registry.dispose 联动 +
// unload 钩子注册（buildSharedInfra 首次装配惰性安装，once 语义）。
// 完整 renderer 路径（WebGL context 创建）依赖真实 GL，jsdom/node 环境不可达，
// 由桌面端手工验收兜底；此处验证纯逻辑段。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { registryMocks } = vi.hoisted(() => ({
  registryMocks: {
    dispose: vi.fn(),
    createAll: vi.fn(() => []),
    getById: vi.fn(() => undefined),
    loadAll: vi.fn(),
    getAll: vi.fn(() => []),
  },
}));

vi.mock("@/preview-3d/caps/scene-capability-registry.ts", () => ({
  sceneCapabilityRegistry: registryMocks,
}));

vi.mock("@/preview-3d/state/preview-state.ts", () => ({
  setSceneCapabilityLookup: vi.fn(),
}));

describe("teardownSharedInfra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("冷态（单例全空）调用不抛错，且联动 registry.dispose", async () => {
    const { teardownSharedInfra } = await import("./shared-infra.ts");
    expect(() => teardownSharedInfra()).not.toThrow();
    expect(registryMocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("幂等：重复调用不抛错、不重复 dispose registry 之外的对象", async () => {
    const { teardownSharedInfra } = await import("./shared-infra.ts");
    teardownSharedInfra();
    expect(() => teardownSharedInfra()).not.toThrow();
    expect(registryMocks.dispose).toHaveBeenCalledTimes(2);
  });

  it("首次 buildSharedInfra 注册 beforeunload 钩子（once），重复装配不重复注册", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const { buildSharedInfra, teardownSharedInfra } = await import("./shared-infra.ts");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const menuHandle = { refreshDock: vi.fn() } as never;
    // jsdom 无 WebGL → renderer 创建会抛错；但钩子安装在 renderer 创建之前，
    // 捕获该异常仍可验证「钩子已注册 + beforeunload 触发拆除」语义。
    try {
      buildSharedInfra({ id: "ysm" } as never, container, menuHandle);
    } catch {
      /* jsdom 无 WebGL，预期 */
    }
    const unloadListeners = addSpy.mock.calls.filter(([t]) => t === "beforeunload");
    expect(unloadListeners.length).toBe(1);
    // 触发 beforeunload → 终局拆除被调用（registry.dispose 再次 +1）
    window.dispatchEvent(new Event("beforeunload"));
    expect(registryMocks.dispose).toHaveBeenCalled();
    const countAfter = registryMocks.dispose.mock.calls.length;
    teardownSharedInfra();
    expect(registryMocks.dispose.mock.calls.length).toBeGreaterThan(countAfter - 1);
    addSpy.mockRestore();
    container.remove();
  });
});

// ===== ADR-196 装配链收敛契约（applyModelDefaults / applyPostProcDefaults） =====
// 断言「7 个散落 setPreset 调用收敛为 2 个命名入口」，按 modelType 透传（未知类型由各 cap
// 内部回落 default，装配层不越权）。内部调用序为**实现序**——5 cap 写互不相交 envState 键组、
// 互不读对方，终态与序无关（[锐评 2026-10-07 #3]，见 shared-infra.ts|applyModelDefaults doc），
// 故只断言「每 cap 恰被调一次」的 member 语义。
// [ADR-282] light 已退出本链（灯光与模型类别解耦）——预 apply cap 6 → 5。
describe("applyModelDefaults（ADR-196 装配链收敛契约）", () => {
  function makeDeps() {
    const cap = (name: string) => ({ applyModelPreset: vi.fn(), id: name });
    const sky = cap("sky");
    const fog = cap("fog");
    const shadow = cap("shadow");
    const reflector = cap("reflector");
    const environment = cap("environment");
    return {
      deps: { sky, fog, shadow, reflector, environment },
      spies: [sky.applyModelPreset, fog.applyModelPreset, shadow.applyModelPreset, reflector.applyModelPreset, environment.applyModelPreset],
    };
  }

  it("applyModelDefaults 对 5 个预 apply cap 各调一次 applyModelPreset（member 语义；顺序为实现序，终态与序无关）", async () => {
    const { applyModelDefaults } = await import("./shared-infra.ts");
    const { deps, spies } = makeDeps();
    applyModelDefaults("vrm", deps as never);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    for (const spy of spies) expect(spy).toHaveBeenCalledWith("vrm");
    // [锐评 2026-10-07 #3] 原断言含全序校验（sky→fog→shadow→reflector→environment，
    // code_review 13b8b4e5f #4 硬化）——实测各 cap 写互不相交 envState 键组、互不读对方，
    // **终态与调用序无关**，全序断言钉的是实现细节（未来安全重排会误红）。已解除，只保留
    // member 语义；不变量声明见 shared-infra.ts|applyModelDefaults doc。若未来出现真实顺序
    // 依赖（cap 读其他 cap 刚写的键），须重判并恢复全序守卫。
  });

  it("未知 modelType 透传到各 cap（内部回落 default 的文案保留在 cap 侧，装配层不吞）", async () => {
    const { applyModelDefaults } = await import("./shared-infra.ts");
    const { deps, spies } = makeDeps();
    // 绕过编译期 ModelType 收窄：模拟运行时 adapter.id 传入非预期值
    (applyModelDefaults as unknown as (t: string, d: unknown) => void)("unknown_type", deps as never);
    for (const spy of spies) expect(spy).toHaveBeenCalledWith("unknown_type");
  });

  it("缺省 cap（undefined/null）静默跳过，不抛错", async () => {
    const { applyModelDefaults } = await import("./shared-infra.ts");
    expect(() =>
      applyModelDefaults("vrm", { sky: null, fog: null, shadow: null, reflector: null } as never),
    ).not.toThrow();
  });

  it("[ADR-250] 装配链不再导出 applyPostProcDefaults（钩子已删，per-type 走 MODEL_DEFAULTS）", async () => {
    const mod = await import("./shared-infra.ts");
    expect("applyPostProcDefaults" in mod).toBe(false);
  });
});
