// ===== 帧内钩子时序契约：update(前段) → WASD/perFrame → afterFrameUpdate(帧末) → render =====
//
// 病症（2026-10-11）：水面倒影 RT 原挂在 `cap.update()` 里渲染，而 `cap.update()` 在
// render-host 每帧的**前段**——早于 perFrame 骨骼动画回调（动画写入处）。后果：
// 动画模型的水面倒影**恒滞后一帧**（RT 里是上一帧姿态）。
// 定论早存于源码（`water-reflect.ts` 2026-10-04 锐评订正：「RT 渲发生在 caps.update 段，
// 早于本帧 WASD 相机输入与 perFrame 回调……真要消除滞后须把 RT 渲染移到相机输入之后」），
// 本次落实该结构性调整 → 新增 `SceneCapability.afterFrameUpdate?()` 帧末钩子。
//
// 本文件钉死**时序本身**（不依赖水面实现细节）：用三个探针记录调用顺序，
// 断言 update → perFrame → afterFrameUpdate → renderer.render 的严格次序。
// 反向保护：若有人把 afterFrameUpdate 挪回前段（或挪到 render 之后），本测试即红。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneCapability } from "@/preview-3d/caps/scene-capability.ts";

/** 受控 rAF（同 render-host.raf-contract.test.ts 的最小实现） */
class ControlledRaf {
  private queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  private nextId = 1;
  request = (cb: FrameRequestCallback): number => {
    const id = this.nextId++;
    this.queue.push({ id, cb });
    return id;
  };
  cancel = (id: number): void => {
    this.queue = this.queue.filter((f) => f.id !== id);
  };
  flushFrame(): number {
    const batch = this.queue;
    this.queue = [];
    for (const f of batch) f.cb(performance.now());
    return batch.length;
  }
}

function makeInfraStub(render: () => void) {
  return {
    camera: { position: { x: 0, y: 0, z: 0 } },
    controls: { enabled: true },
    orbitTarget: { x: 0, y: 0, z: 0 },
    scene: {},
    renderer: {
      render,
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      info: { render: { calls: 0, triangles: 0 } },
    },
  } as unknown as import("@/preview-3d/adapters/shared-infra.ts").SharedInfra;
}

function makeContainerStub(): HTMLElement {
  return { isConnected: false, clientWidth: 0, clientHeight: 0 } as unknown as HTMLElement;
}

describe("帧内钩子时序：afterFrameUpdate 位于 perFrame 之后、render 之前", () => {
  let raf: ControlledRaf;
  let host: import("./render-host.ts").RendererHost;
  let setProvider: (p: (() => readonly SceneCapability[]) | null) => void;

  beforeEach(async () => {
    raf = new ControlledRaf();
    vi.stubGlobal("requestAnimationFrame", raf.request);
    vi.stubGlobal("cancelAnimationFrame", raf.cancel);
    const mod = await import("./render-host.ts");
    host = new mod.RendererHost();
    // caps 提供器为模块级注入点（ADR-270-d1 注入范式），非实例方法
    setProvider = mod.setSceneCapsProvider;
  });

  afterEach(() => {
    setProvider(null);
    vi.unstubAllGlobals();
  });

  it("调用序严格为 update → perFrame → afterFrameUpdate → render", () => {
    const order: string[] = [];

    const cap = {
      id: "probe",
      labelKey: "preview.sky",
      icon: "sky",
      descKey: "x",
      apply: () => {},
      dispose: () => {},
      setEnabled: () => {},
      isEnabled: () => true,
      saveState: () => {},
      loadState: () => {},
      update: () => order.push("update"),
      afterFrameUpdate: () => order.push("afterFrameUpdate"),
    } as unknown as SceneCapability;

    setProvider(() => [cap]);
    host.registerPerFrame(() => order.push("perFrame"));
    host.start(
      makeContainerStub(),
      makeInfraStub(() => order.push("render")),
    );
    raf.flushFrame();

    // 严格次序：update 在前段；perFrame（动画写入）在中段；
    // afterFrameUpdate（读已更新场景）在帧末；render 最后。
    expect(order, "update 必须早于 perFrame（前段推进时钟）").toContain("update");
    expect(
      order.indexOf("update"),
      "update 在 perFrame 之前",
    ).toBeLessThan(order.indexOf("perFrame"));
    expect(
      order.indexOf("perFrame"),
      "afterFrameUpdate 必须在 perFrame（骨骼动画写入）**之后**——这正是消除倒影滞后一帧的根据",
    ).toBeLessThan(order.indexOf("afterFrameUpdate"));
    expect(
      order.indexOf("afterFrameUpdate"),
      "afterFrameUpdate 必须在主渲染**之前**（RT 要赶得上本帧采样）",
    ).toBeLessThan(order.indexOf("render"));
  });

  it("afterFrameUpdate 缺席时不报错（可选钩子；其余 cap 不受影响）", () => {
    const withHook = vi.fn();
    const without = { id: "plain" } as unknown as SceneCapability;
    const cap = {
      id: "probe",
      labelKey: "preview.sky",
      icon: "sky",
      descKey: "x",
      apply: () => {},
      dispose: () => {},
      setEnabled: () => {},
      isEnabled: () => true,
      saveState: () => {},
      loadState: () => {},
      afterFrameUpdate: withHook,
    } as unknown as SceneCapability;

    setProvider(() => [cap, without]);
    host.start(
      makeContainerStub(),
      makeInfraStub(() => {}),
    );
    expect(() => raf.flushFrame(), "未实现 afterFrameUpdate 的 cap 不得导致抛错").not.toThrow();
    expect(withHook, "实现者仍被调用").toHaveBeenCalled();
  });

  it("水面倒影门控：水面不可见时 afterFrameUpdate 不触发渲染", async () => {
    // 与 water-capability.update 同一可见性门控（不可见时倒影无意义，免整场重渲）
    const { WaterCapability } = await import("@/preview-3d/caps/water-capability.ts");
    const cap = Object.create(WaterCapability.prototype) as InstanceType<typeof WaterCapability>;
    const renderRefl = vi.fn();
    // 私有方法白盒替换（TS private 运行时即普通属性，同仓既有探针范式）
    (cap as unknown as { renderReflection: () => void }).renderReflection = renderRefl;
    (cap as unknown as { water: { root: { visible: boolean } } }).water = {
      root: { visible: false },
    };
    cap.afterFrameUpdate();
    expect(renderRefl, "水面不可见 → 不渲染倒影 RT").not.toHaveBeenCalled();

    (cap as unknown as { water: { root: { visible: boolean } } }).water.root.visible = true;
    cap.afterFrameUpdate();
    expect(renderRefl, "水面可见 → 渲染倒影 RT").toHaveBeenCalledTimes(1);
  });

  it("update 不再渲染倒影（时序拆分后只推进时钟）", async () => {
    const { WaterCapability } = await import("@/preview-3d/caps/water-capability.ts");
    const cap = Object.create(WaterCapability.prototype) as InstanceType<typeof WaterCapability>;
    const renderRefl = vi.fn();
    (cap as unknown as { renderReflection: () => void }).renderReflection = renderRefl;
    (cap as unknown as { water: { root: { visible: boolean } } }).water = {
      root: { visible: true },
    };
    (cap as unknown as { waterTime: { value: number } }).waterTime = { value: 0 };

    cap.update(0.016);

    expect(renderRefl, "update 只管时钟，倒影渲染归 afterFrameUpdate").not.toHaveBeenCalled();
    expect(
      (cap as unknown as { waterTime: { value: number } }).waterTime.value,
      "时钟仍被推进（waterWaveSpeed × dt）",
    ).not.toBe(0);
  });
});
