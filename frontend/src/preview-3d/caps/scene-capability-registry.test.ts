// ===== SceneCapabilityRegistry 险恶测试 =====
// 验证注册表在极端场景下的健壮性：重复注册、dispose 后操作、并发创建等

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { SceneCapabilityRegistry, sceneCapabilityRegistry, isIblActive } from "./scene-capability-registry.ts";
import { SkyCapability } from "./sky-capability.ts";
import { GroundCapability } from "./ground-capability.ts";
import { WaterCapability } from "./water-capability.ts";
import { EnvironmentCapability } from "./environment-capability.ts";
import { FogCapability } from "./fog-capability.ts";
import { ReflectorCapability } from "./reflector-capability.ts";
import type { SceneCapability } from "./scene-capability.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import type { LocaleKey } from "@/core/i18n/t.ts";

/** createAll 的 ctx 参数类型（测试传空对象桩时精确断言，替代 as never） */
type CreateAllCtx = Parameters<SceneCapabilityRegistry["createAll"]>[0];

function makeFakeCap(id: string, overrides: Partial<SceneCapability> = {}): SceneCapability {
  return {
    id,
    labelKey: `label.${id}` as LocaleKey,
    descKey: `desc.${id}`,
    icon: "tools",
    apply: vi.fn(),
    dispose: vi.fn(),
    setEnabled: vi.fn(),
    isEnabled: () => true,
    getMenuNodes: (): PreviewMenuNode[] => [],
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

  it("createAll 后再 createAll（同 ctx）→ 复用现有实例，不重建（code review #8）", () => {
    const factory = vi.fn(() => makeFakeCap("sky"));
    const cap = makeFakeCap("sky");
    const disposeSpy = vi.spyOn(cap, "dispose");
    const ctx = { scene: {}, renderer: {}, camera: {} } as unknown as CreateAllCtx;
    registry.add(factory);
    registry.add(() => cap);
    const first = registry.createAll(ctx);
    const second = registry.createAll(ctx);
    expect(second).toEqual(first); // 同一批实例（createAll 返回副本数组）
    expect(factory).toHaveBeenCalledTimes(1); // 不重跑工厂
    expect(disposeSpy).not.toHaveBeenCalled(); // 不拆旧实例
  });

  it("createAll ctx 变化（换 scene/renderer/camera）→ dispose 旧实例后重建", () => {
    const factory = vi.fn(() => makeFakeCap("sky"));
    registry.add(factory);
    const ctx1 = { scene: { a: 1 }, renderer: {}, camera: {} } as unknown as CreateAllCtx;
    const ctx2 = { scene: { a: 2 }, renderer: {}, camera: {} } as unknown as CreateAllCtx;
    registry.createAll(ctx1);
    registry.createAll(ctx2);
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

  it("isIblActive：IBL 供图判据读 environment cap 的 isEnabled（非 sky 的退役开关）；cap 缺席 → false", () => {
    expect(isIblActive()).toBe(false);
    const envCap = makeFakeCap("environment");
    (envCap as { isEnabled?: () => boolean }).isEnabled = () => true;
    // ⚠️ 同时挂一个 sky：sky 在场且 isEnvironmentEnabled=true 也不该影响判据
    //（历史病灶 X-3：预览问 env、截图问 sky ⇒ 同场景两侧亮度分叉）。
    const sky = makeFakeCap("sky");
    (sky as { isEnvironmentEnabled?: () => boolean }).isEnvironmentEnabled = () => false;
    sceneCapabilityRegistry.add(() => envCap);
    sceneCapabilityRegistry.add(() => sky);
    sceneCapabilityRegistry.createAll({} as unknown as CreateAllCtx);
    try {
      expect(isIblActive()).toBe(true);
    } finally {
      sceneCapabilityRegistry.dispose();
    }
    expect(isIblActive()).toBe(false);
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

  it("[#2 拓扑序 2026-10-07] loadAll 按 LOAD_DEPS 拓扑：environment 依赖 sky，注册序颠倒也先 load sky", () => {
    const skyLoad = vi.fn();
    const envLoad = vi.fn();
    const sky = makeFakeCap("sky", { loadState: skyLoad });
    const env = makeFakeCap("environment", { loadState: envLoad });
    // 故意逆注册：environment 先于 sky——旧「按注册序串行」会先 load env（位置契约被破坏的形态），
    // 拓扑序应把 sky 提到 env 之前（LOAD_DEPS: environment → ["sky"]）。
    registry.add(() => env);
    registry.add(() => sky);
    registry.createAll({} as unknown as CreateAllCtx);
    registry.loadAll();
    expect(skyLoad).toHaveBeenCalledTimes(1);
    expect(envLoad).toHaveBeenCalledTimes(1);
    expect(skyLoad.mock.invocationCallOrder[0] as number).toBeLessThan(
      envLoad.mock.invocationCallOrder[0] as number,
    );
  });

  it("[顺序契约] 内置注册序：sky 必须先于 environment（env 跨槽解耦的等价性地基）", () => {
    // 地基声明：environment-capability.loadState 的 ADR-292 判据① 已改读 envState.skyEnvironment
    // （不再跨槽读 sky 槽），其**等价性完全建立在**「registry.loadAll 按注册序串行 ∧ sky 先于
    // environment」——sky.loadState 先把存档 environment 恢复进 envState，env 后读才拿到同值。
    // 该前提此前零机器保护（仅注册表底部 :183-196 的文字注释）：任何人重排注册序 / 把 env 提前 /
    // 未来分批注册，都会让解耦静默失效且无测试转红。本用例把它钉成判据。
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer();
    // ⚠️ 必须补 shadowMap：test-setup 的全局 Fake WebGLRenderer 无该字段，而 ShadowCapability
    // 构造期读 `renderer.shadowMap.enabled` → 不补则该 cap 构造抛错被 createAll 的 try/catch
    // 静默吞掉（同 cap-menu-trees.test.ts 的做法）。
    (
      renderer as unknown as {
        shadowMap: { enabled: boolean; type: number; needsUpdate: boolean };
      }
    ).shadowMap = { enabled: false, type: 0, needsUpdate: false };
    try {
      const caps = sceneCapabilityRegistry.createAll({
        scene,
        renderer,
        camera: new THREE.PerspectiveCamera(),
      });
      const ids = caps.map((c) => c.id);
      expect(ids, "sky 须实例化成功（否则顺序断言退化为 -1 比较）").toContain("sky");
      expect(ids, "environment 须实例化成功").toContain("environment");
      expect(
        ids.indexOf("sky"),
        "sky 须先于 environment 注册/实例化（loadAll 顺序串行 = env 判据①读得到 sky 已恢复的值）",
      ).toBeLessThan(ids.indexOf("environment"));
    } finally {
      sceneCapabilityRegistry.dispose(); // 全局单例：用完即清，防跨测试泄漏
    }
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

  it("env 面板入选 cap 全部实现 subscribe（锐评暗线 A 收口：面板订阅不漏掉任何成员）", () => {
    // 环境面板经 collectEnvEntries（实现 getEnvPlacement 即入选）订阅各 cap 的 subscribe；
    // 若任一成员缺失 subscribe，面板将靠手动 refresh 兜底而非统一 listenerSet 自 notify。
    // 本例锁定「入选 env 面板的 6 个 cap 均实现 subscribe」契约，新增 env cap 不得破此对称。
    // 用原型静态断言（免构造 Three 对象/renderer），直接验证真实实现的方法存在性。
    const envPanelCaps = [
      SkyCapability,
      GroundCapability,
      WaterCapability,
      EnvironmentCapability,
      FogCapability,
      ReflectorCapability,
    ];
    for (const Ctor of envPanelCaps) {
      expect(
        typeof (Ctor.prototype as { subscribe?: unknown }).subscribe,
        `${Ctor.name} 必须实现 subscribe（env 面板自我刷新契约）`,
      ).toBe("function");
    }
  });
});
