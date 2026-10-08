// ===== G4：close→reopen 会话复位等价（锐评 host/env 耦合复审 §五 G4）=====
//
// 病症（实证）：跨会话复位全靠人工，无任何断言——实例字段（`_liveInputSessions` /
// `_perFrameSnapshot` / `_lastPerFrameWarnTs`）与模块级 `const` 容器
// （`schema-registry.registry` / `overlay-style-bridge._injectedOnce`）复位无锁；
// `check-singleton-hygiene` **只测顶层 `let`，不测 `const` 容器 Map/Set**
//（脚本自述「纳入即噪音」），而 infra 有 6 处 `const` 容器。
//
// ⚠️ 本文件刻意避开自证式假绿（复审 §五 G4 ①）：**不断言「reset 后字段为空」**
//（那是直接读被测对象的内部结论——reset 没清时该断言恰好也「通过」如果写错了对象）。
// 判据全部改为**行为可观察**：close → reset → reopen 后，**旧会话的可观察影响必须归零**。
//
// ⚠️ 避开陷阱 ③「两 mount 复用同一 session 对象绕过真实 new 路径」：本文件每轮都
// **新建** session 对象（`makeSession()` 每次返回新引用），确保走真实身份语义。
//
// ⚠️ 避开陷阱 ②「只测 full 档漏 early/failed」：本轮不涉及 mount-session 三档
//（那需要完整 mount 夹具）；此处锁的是**宿主状态层**的复位等价，与三档正交。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 受控 rAF（同 G1 手法：以「队列是否仍增长」判帧真停，而非数调用次数） */
class ControlledRaf {
  private queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  private nextId = 1;
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

  flush(): void {
    const batch = this.queue;
    this.queue = [];
    for (const f of batch) f.cb(performance.now());
  }

  drain(maxFrames = 20): number {
    let executed = 0;
    for (let i = 0; i < maxFrames; i++) {
      const n = this.queue.length;
      executed += n;
      this.flush();
      if (this.queue.length === 0) return executed;
    }
    return executed;
  }

  get pending(): number {
    return this.queue.length;
  }
}

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

function makeContainerStub(): HTMLElement {
  return { isConnected: false, clientWidth: 0, clientHeight: 0 } as unknown as HTMLElement;
}

/** 每次返回**全新** session 引用（模拟真实 close/reopen 各自新建，不复用对象） */
function makeSession(key: string) {
  return {
    keys: { KeyW: false },
    camSpeed: 1,
    orbitMode: "turntable" as const,
    tag: key,
  } as unknown as import("./render-host.ts").ActiveInputSession;
}

describe("G4 close→reopen 会话复位等价（行为可观察判据）", () => {
  let raf: ControlledRaf;
  let host: import("./render-host.ts").RendererHost;

  beforeEach(async () => {
    raf = new ControlledRaf();
    vi.stubGlobal("requestAnimationFrame", raf.request);
    vi.stubGlobal("cancelAnimationFrame", raf.cancel);
    const mod = await import("./render-host.ts");
    host = new mod.RendererHost();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("close→reset→reopen：旧会话的 perFrame 回调不再被驱动（残留即跨会话泄漏）", () => {
    // 第一轮会话：注册回调 A
    const oldFrame = vi.fn();
    host.start(makeContainerStub(), makeInfraStub());
    host.registerPerFrame(oldFrame);
    // 推进时钟以跨过帧率门控，确保回调真被驱动过
    const nowSpy = vi.spyOn(performance, "now");
    let t = performance.now() + 1000;
    nowSpy.mockImplementation(() => t);
    raf.flush();
    t += 1000;
    raf.flush();
    expect(oldFrame).toHaveBeenCalled();
    oldFrame.mockClear();

    // close：reset + 停环
    host.reset();
    raf.drain();

    // reopen：第二轮会话（新引用），注册回调 B
    host.start(makeContainerStub(), makeInfraStub());
    const newFrame = vi.fn();
    host.registerPerFrame(newFrame);
    t += 1000;
    raf.flush();
    t += 1000;
    raf.flush();
    nowSpy.mockRestore();

    // 关键判据：新回调被驱动，**旧回调不复活**
    expect(newFrame).toHaveBeenCalled();
    expect(oldFrame).not.toHaveBeenCalled();
  });

  it("close→reopen：旧会话的活跃输入不被静默继承（新会话须显式注册）", () => {
    const oldSession = makeSession("old");
    host.setActiveInputSession(oldSession);
    expect(host.getActiveInputSession()).toBe(oldSession);

    host.reset();

    // 复位后活跃输入必须归零——若旧引用残留，新会话的 WASD/相机偏好会被旧会话污染
    expect(host.getActiveInputSession()).toBeNull();

    // reopen：新会话显式注册后生效
    const newSession = makeSession("new");
    host.setActiveInputSession(newSession);
    expect(host.getActiveInputSession()).toBe(newSession);
  });

  it("注销活跃会话后：关掉唯一会话 ⇒ 活跃归 null（不残留已拆会话）", () => {
    const s = makeSession("solo");
    host.setActiveInputSession(s);
    host.unregisterActiveInputSession(s);

    expect(host.getActiveInputSession()).toBeNull();
  });

  it("coop 多会话等价：关掉 active 的那个，晋升最新存活者（不整体归零）", () => {
    // 这是 render-host 的既有不变量（code_review ece0d4a4 #2/#3/#9），
    // G4 把「跨会话复位」与「会话内晋升」两条语义一起钉住，防将来改动互相踩
    const a = makeSession("a");
    const b = makeSession("b");
    host.setActiveInputSession(a);
    host.setActiveInputSession(b);
    expect(host.getActiveInputSession()).toBe(b);

    host.unregisterActiveInputSession(b); // 关掉 active

    // 存活者 a 晋升（而非 null）——否则 coop 下存活会话 WASD 永久死
    expect(host.getActiveInputSession()).toBe(a);

    host.unregisterActiveInputSession(a);
    expect(host.getActiveInputSession()).toBeNull();
  });

  it("重开等价性：两轮独立会话的**可观察状态序列**一致（同一路径不累积副作用）", () => {
    // 跑两轮同构的 close→reopen，对比「可观察状态」是否一致——
    // 若复位不彻底（残留上一轮状态），第二轮序列会偏离第一轮
    //
    // ⚠️ 实测发现（本用例首版即红，值得记下）：`reset()` 只清状态字段（`_animId = 0` 等），
    // **不 cancel 已在飞的那一帧**。若随后 drain 残余帧，它们会再次 `requestAnimationFrame`
    // 把 `_animId` 复活 ⇒ 下一轮 `start()` 被幂等判定（`if (_animId !== 0) return`）误拦、
    // 循环拉不起来（实测第二轮帧数 0）。这与 G1 锁的是**同一条语义**：
    // **停环唯一手段是 `stopIfIdle`，reset 不是停环手段**。
    // 故此处按生产真实 order 收尾：先摘回调 + stopIfIdle 停环，再 reset 清状态。
    const runRound = (): { frames: boolean[]; active: unknown } => {
      const frames: boolean[] = [];
      const f = vi.fn(() => frames.push(true));
      host.start(makeContainerStub(), makeInfraStub());
      host.registerPerFrame(f);
      const nowSpy = vi.spyOn(performance, "now");
      let t = performance.now() + 1000;
      nowSpy.mockImplementation(() => t);
      raf.flush();
      t += 1000;
      raf.flush();
      nowSpy.mockRestore();

      const active = host.getActiveInputSession();
      const result = { frames, active };

      // 生产 close 顺序：摘 perFrame → stopIfIdle 真停环 → reset 清状态
      host.removePerFrame(f);
      host.stopIfIdle();
      host.reset();
      raf.drain();
      return result;
    };

    const round1 = runRound();
    const round2 = runRound();

    expect({ r1: round1.frames.length, r2: round2.frames.length, pending: raf.pending }).toEqual({
      r1: 2,
      r2: 2,
      pending: 0,
    });
    expect(round2.active).toBe(round1.active); // 均为 null（未注册活跃会话）
    expect(round2.active).toBeNull();
  });
});
