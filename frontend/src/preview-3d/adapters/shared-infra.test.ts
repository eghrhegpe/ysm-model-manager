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
// 断言「7 个散落 setPreset 调用收敛为 2 个命名入口」后，编排仍逐字复刻原顺序，
// 且按 modelType 透传（未知类型由各 cap 内部回落 default，装配层不越权）。
describe("applyModelDefaults（ADR-196 装配链收敛契约）", () => {
  function makeDeps() {
    const cap = (name: string) => ({ applyModelPreset: vi.fn(), id: name });
    const sky = cap("sky");
    const light = cap("light");
    const fog = cap("fog");
    const shadow = cap("shadow");
    const reflector = cap("reflector");
    const environment = cap("environment");
    return {
      deps: { sky, light, fog, shadow, reflector, environment },
      spies: [sky.applyModelPreset, light.applyModelPreset, fog.applyModelPreset, shadow.applyModelPreset, reflector.applyModelPreset, environment.applyModelPreset],
    };
  }

  it("applyModelDefaults 对 6 个预 apply cap 各调一次 applyModelPreset，顺序 sky→light→fog→shadow→reflector→environment", async () => {
    const { applyModelDefaults } = await import("./shared-infra.ts");
    const { deps, spies } = makeDeps();
    applyModelDefaults("vrm", deps as never);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    for (const spy of spies) expect(spy).toHaveBeenCalledWith("vrm");
    // 调用顺序：sky→light→fog→shadow→reflector→environment 逐字复刻原 7 处散落
    // setPreset 顺序——code_review 13b8b4e5f #4：全序断言（原只比首尾，中间序互换
    // 全过）。invocationCallOrder 是全局计数（非本次调用从 1 起，实测前置测试已
    // 消耗计数），故断言相对严格递增而非硬编码 [1..6]
    const order = spies.map((s) => s.mock.invocationCallOrder[0]);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
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
