// ===== G1：rAF 生命周期契约测试（锐评 host/env 耦合复审 §五 G1）=====
//
// 病症（实证）：`stopIfIdle` / `animate` / rAF 续期语义**全仓零测试引用**——
// `render-loop.test.ts` 只覆盖 active-input 会话表，本模块的帧生命周期无任何锁。
// 而 `animate` 是「先续期、后判断」（render-host.ts `animate` 首行 `requestAnimationFrame`），
// 早退路径不会停循环：判据面（`stopIfIdle` 只查 `_perFrames.length`）窄于不变量面。
//
// ⚠️ 本文件刻意避开两类假绿（复审 §五 G1 列出的陷阱）：
//   ① 不用 `vi.useFakeTimers()` 替代 rAF——那只能验「调用次数」，验不了「帧真停」；
//   ② 不断言 `cancelAnimationFrame` 被调用——**可先 cancel 再由 animate 补一次 rAF 骗过**。
// 判据改为：驱动受控 rAF，反复 flush 队列，观察**是否仍有新帧被排入**
//（「帧真停」= 队列 drain 后不再增长；「帧假停」= cancel 后被 animate 自续期补回）。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 受控 rAF：记录待执行回调，测试手动 flush（模拟浏览器逐帧驱动） */
class ControlledRaf {
  private queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  private nextId = 1;
  /** 累计被排入的帧数（含 cancel 后又补排的）——「帧真停」的核心判据 */
  enqueued = 0;

  request = (cb: FrameRequestCallback): number => {
    const id = this.nextId++;
    this.queue.push({ id, cb });
    this.enqueued++;
    return id;
  };

  cancel = (id: number): void => {
    this.queue = this.queue.filter((f) => f.id !== id);
  };

  /** 执行当前队列中的全部帧（一帧 = 一次 flush；执行期间新排入的进下一轮，不被本轮消费） */
  flushFrame(): number {
    const batch = this.queue;
    this.queue = [];
    for (const f of batch) f.cb(performance.now());
    return batch.length;
  }

  /** 连续 flush 直到队列稳定为空，返回总执行的帧数（有上限防死循环） */
  drain(maxFrames = 20): number {
    let executed = 0;
    for (let i = 0; i < maxFrames; i++) {
      const n = this.flushFrame();
      executed += n;
      if (this.queue.length === 0) return executed;
    }
    return executed;
  }

  get pending(): number {
    return this.queue.length;
  }
}

/**
 * 最小 SharedInfra 桩。
 * animate 真正执行到渲染段需要：camera/controls/orbitTarget（局部态早退守卫）
 * + renderer（render/setPixelRatio/setSize/sampleGpuLoad）/scene（直渲兜底路径）。
 * 容器用「未连接」的假 element：animate 有 `viewContainer.isConnected` 守卫，
 * 未连接即跳过 resize，避免 setSize 打扰断言（也正合「拆单例窗口帧」的真实语义）。
 */
function makeInfraStub() {
  return {
    camera: { position: { x: 0, y: 0, z: 0 } },
    controls: { enabled: true },
    orbitTarget: { x: 0, y: 0, z: 0 },
    scene: {},
    renderer: {
      render: vi.fn(),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      info: { render: { calls: 0, triangles: 0 } },
    },
  } as unknown as import("@/preview-3d/adapters/shared-infra.ts").SharedInfra;
}

/** 未连接的假容器（isConnected === false ⇒ animate 跳过 resize 段） */
function makeContainerStub(): HTMLElement {
  return { isConnected: false, clientWidth: 0, clientHeight: 0 } as unknown as HTMLElement;
}

describe("G1 rAF 生命周期契约（rendererHost.start / stopIfIdle / reset）", () => {
  let raf: ControlledRaf;
  let host: import("./render-host.ts").RendererHost;

  beforeEach(async () => {
    raf = new ControlledRaf();
    vi.stubGlobal("requestAnimationFrame", raf.request);
    vi.stubGlobal("cancelAnimationFrame", raf.cancel);
    // 每例取全新实例：rendererHost 是模块级单例，跨例残留 _animId 会让 start 幂等跳过
    const mod = await import("./render-host.ts");
    host = new mod.RendererHost();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("start 启动循环后帧持续自续期（每帧排入下一帧）", () => {
    host.start(makeContainerStub(), makeInfraStub());

    expect(raf.pending).toBe(1); // start → animate 首帧已排入
    raf.flushFrame();
    expect(raf.pending).toBe(1); // 帧执行完又排下一帧（自续期）
    raf.flushFrame();
    expect(raf.pending).toBe(1);
    expect(raf.enqueued).toBe(3);
  });

  it("start 幂等：循环运行中重复 start 不二次启动 rAF（只刷新局部态）", () => {
    host.start(makeContainerStub(), makeInfraStub());
    const afterFirst = raf.enqueued;

    host.start(makeContainerStub(), makeInfraStub());

    expect(raf.enqueued).toBe(afterFirst); // 未新增帧
  });

  it("stopIfIdle 在无 perFrame 时**真停**帧（drain 后队列不再增长）", () => {
    host.start(makeContainerStub(), makeInfraStub());
    raf.flushFrame();

    host.stopIfIdle();

    const executed = raf.drain();
    // 关键判据：stopIfIdle 取消了待执行的下一帧，drain 不产生任何新帧
    expect(executed).toBe(0);
    expect(raf.pending).toBe(0);
  });

  it("stopIfIdle 在**有** perFrame 时不误停（帧继续运行）", () => {
    host.start(makeContainerStub(), makeInfraStub());
    const frame = vi.fn();
    host.registerPerFrame(frame);
    raf.flushFrame();

    host.stopIfIdle();

    // 有 perFrame ⇒ 不该停：flush 后仍有下一帧排队
    expect(raf.pending).toBe(1);

    // ⚠️ perFrame 驱动在 `shouldRenderAtFps` 帧率门控**之后**（render-host.ts animate）：
    // 连续 flush 时 performance.now() 几乎不变 ⇒ 被门控 return，回调不被驱动。
    // 故必须推进时钟跨过帧间隔，才测得到「回调真被驱动」而非只测「帧在跑」。
    const nowSpy = vi.spyOn(performance, "now");
    let t = performance.now() + 1000;
    nowSpy.mockImplementation(() => t);
    raf.flushFrame();
    t += 1000;
    raf.flushFrame();
    nowSpy.mockRestore();

    expect(frame).toHaveBeenCalled();
  });

  it("停止后再 start 能重新拉起循环（close→reopen 等价：帧不粘死）", () => {
    host.start(makeContainerStub(), makeInfraStub());
    raf.flushFrame();
    host.stopIfIdle();
    raf.drain();
    expect(raf.pending).toBe(0);

    // reopen：start 应重新拉起（_animId 已归 0，幂等判定不误拦）
    host.start(makeContainerStub(), makeInfraStub());
    expect(raf.pending).toBe(1);
    raf.flushFrame();
    expect(raf.pending).toBe(1); // 重新在跑
  });

  it("reset 清空循环状态后 start 可重新拉起（测试钩子不粘死生产路径）", () => {
    host.start(makeContainerStub(), makeInfraStub());
    raf.flushFrame();

    host.reset();
    raf.drain();

    host.start(makeContainerStub(), makeInfraStub());
    expect(raf.pending).toBe(1);
  });

  it("removePerFrame 清空回调后 stopIfIdle 真停（cleanup 尾部组合路径）", () => {
    host.start(makeContainerStub(), makeInfraStub());
    const frame = vi.fn();
    host.registerPerFrame(frame);
    raf.flushFrame();
    expect(raf.pending).toBe(1);

    host.removePerFrame(frame);
    host.stopIfIdle();

    expect(raf.drain()).toBe(0);
    expect(raf.pending).toBe(0);
    // 停后回调不再被驱动
    frame.mockClear();
    raf.drain();
    expect(frame).not.toHaveBeenCalled();
  });

  // ⚠️ 本例锁的是**实现真实语义**，而非「早退即停环」的直觉：
  // render-host.ts 的 `animate` 是「**先无条件续期、后判断**」——首行 `requestAnimationFrame`
  // 排在局部态早退守卫**之前**，故 early-return 路径**不会**停环（这是报告 G1 指出的
  // 「判据面窄于不变量面」：停环的唯一手段是 `stopIfIdle` / `reset`，不是早退）。
  // 本契约把这一点钉死：将来若有人把续期挪到早退之后，此例会红，提示重新评估停环语义。
  it("animate 先续期后判断：早退（局部态缺失）不停环——停环唯一手段是 stopIfIdle/reset", () => {
    host.start(makeContainerStub(), makeInfraStub());
    raf.flushFrame();
    const before = raf.enqueued;

    // reset 清掉 _animId 与局部态，但**队列中在飞的那一帧仍持有 animate 闭包**
    host.reset();
    raf.drain();

    // 实证：早退不停环——残留帧执行后仍自续期（enqueued 增长）
    expect(raf.enqueued).toBeGreaterThan(before);

    // 而 stopIfIdle 是有效手段：清空 perFrame 后能真停
    host.stopIfIdle(); // _perFrames 已被 reset 清空 ⇒ 满足停环条件
    expect(raf.drain()).toBe(0);
    expect(raf.pending).toBe(0);
  });
});
