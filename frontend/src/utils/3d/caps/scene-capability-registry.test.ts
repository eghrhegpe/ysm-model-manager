// ===== SceneCapabilityRegistry 险恶测试 =====
// 验证注册表在极端场景下的健壮性：重复注册、dispose 后操作、并发创建等

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SceneCapabilityRegistry, sceneCapabilityRegistry, isSkyEnvironmentOn } from "./scene-capability-registry.ts";
import type { SceneCapability, MenuControlDef } from "./scene-capability.ts";

/** createAll 的 ctx 参数类型（测试传空对象桩时精确断言，替代 as never） */
type CreateAllCtx = Parameters<SceneCapabilityRegistry["createAll"]>[0];

function makeFakeCap(id: string, overrides: Partial<SceneCapability> = {}): SceneCapability {
  return {
    id,
    labelKey: `label.${id}`,
    descKey: `desc.${id}`,
    icon: "🔧",
    apply: vi.fn(),
    dispose: vi.fn(),
    setEnabled: vi.fn(),
    isEnabled: () => true,
    setPreset: vi.fn(),
    getMenuControls: (): MenuControlDef[] => [],
    saveState: vi.fn(),
    loadState: vi.fn(),
    ...overrides,
  };
}

describe("SceneCapabilityRegistry 险恶测试", () => {
  let registry: SceneCapabilityRegistry;

  beforeEach(() => {
    registry = new SceneCapabilityRegistry();
  });

  it("重复 add 同一 id → 两个工厂都执行，getById 返回第一个", () => {
    const cap1 = makeFakeCap("sky", { apply: vi.fn() });
    const cap2 = makeFakeCap("sky", { apply: vi.fn() });
    registry.add(() => cap1);
    registry.add(() => cap2);
    const caps = registry.createAll({} as unknown as CreateAllCtx);
    expect(caps).toHaveLength(2);
    expect(registry.getById("sky")).toBe(cap1);
  });

  it("dispose 后 getById 返回 undefined", () => {
    registry.add(() => makeFakeCap("sky"));
    registry.createAll({} as unknown as CreateAllCtx);
    registry.dispose();
    expect(registry.getById("sky")).toBeUndefined();
  });

  it("createAll 后再 createAll → dispose 旧实例后重新创建", () => {
    const factory = vi.fn(() => makeFakeCap("sky"));
    registry.add(factory);
    registry.createAll({} as unknown as CreateAllCtx);
    registry.createAll({} as unknown as CreateAllCtx);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("loadAll/saveAll 在无 cap 时不抛", () => {
    expect(() => registry.loadAll()).not.toThrow();
    expect(() => registry.saveAll()).not.toThrow();
  });

  it("saveAll 按序调用每个 cap 的 saveState", () => {
    const cap1 = makeFakeCap("sky", { saveState: vi.fn() });
    const cap2 = makeFakeCap("ground", { saveState: vi.fn() });
    registry.add(() => cap1);
    registry.add(() => cap2);
    registry.createAll({} as unknown as CreateAllCtx);
    registry.saveAll();
    expect(cap1.saveState).toHaveBeenCalledTimes(1);
    expect(cap2.saveState).toHaveBeenCalledTimes(1);
  });

  it("createAll 向工厂注入 caps 查询器：getById 可查同批实例（cap 间协调走注入不经全局）", () => {
    const capA = makeFakeCap("a");
    let lookup: { getById(id: string): SceneCapability | undefined } | undefined;
    registry.add((ctx) => {
      lookup = ctx.caps;
      return capA;
    });
    registry.createAll({} as unknown as CreateAllCtx);
    expect(lookup?.getById("a")).toBe(capA);
    expect(lookup?.getById("missing")).toBeUndefined();
  });

  it("isSkyEnvironmentOn：读全局 sky 的环境开关；sky 缺席 → false", () => {
    expect(isSkyEnvironmentOn()).toBe(false);
    const sky = makeFakeCap("sky");
    (sky as { isEnvironmentEnabled?: () => boolean }).isEnvironmentEnabled = () => true;
    sceneCapabilityRegistry.add(() => sky);
    sceneCapabilityRegistry.createAll({} as unknown as CreateAllCtx);
    try {
      expect(isSkyEnvironmentOn()).toBe(true);
    } finally {
      sceneCapabilityRegistry.dispose();
    }
    expect(isSkyEnvironmentOn()).toBe(false);
  });

  it("loadAll 按序调用每个 cap 的 loadState", () => {
    const cap1 = makeFakeCap("sky", { loadState: vi.fn() });
    const cap2 = makeFakeCap("ground", { loadState: vi.fn() });
    registry.add(() => cap1);
    registry.add(() => cap2);
    registry.createAll({} as unknown as CreateAllCtx);
    registry.loadAll();
    expect(cap1.loadState).toHaveBeenCalledTimes(1);
    expect(cap2.loadState).toHaveBeenCalledTimes(1);
  });

  it("dispose 按序调用每个 cap 的 dispose", () => {
    const cap1 = makeFakeCap("sky", { dispose: vi.fn() });
    const cap2 = makeFakeCap("ground", { dispose: vi.fn() });
    registry.add(() => cap1);
    registry.add(() => cap2);
    registry.createAll({} as unknown as CreateAllCtx);
    registry.dispose();
    expect(cap1.dispose).toHaveBeenCalledTimes(1);
    expect(cap2.dispose).toHaveBeenCalledTimes(1);
  });

  it("add 一个抛错的工厂 → createAll 跳过该 cap，其余正常", () => {
    const badFactory = (): never => { throw new Error("boom"); };
    const goodCap = makeFakeCap("ground");
    registry.add(badFactory);
    registry.add(() => goodCap);
    const caps = registry.createAll({} as unknown as CreateAllCtx);
    expect(caps).toHaveLength(1);
    expect(caps[0]).toBe(goodCap);
  });

  it("getById 在 createAll 前返回 undefined（未创建）", () => {
    registry.add(() => makeFakeCap("sky"));
    expect(registry.getById("sky")).toBeUndefined();
  });

  it("getById 返回的对象引用稳定（不每次创建新实例）", () => {
    const cap = makeFakeCap("sky");
    registry.add(() => cap);
    registry.createAll({} as unknown as CreateAllCtx);
    expect(registry.getById("sky")).toBe(cap);
    expect(registry.getById("sky")).toBe(cap);
  });
});
