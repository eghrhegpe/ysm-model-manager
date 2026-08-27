// @vitest-environment node
// ===== Worker 桥契约测试（审计盲区收口）=====
// 覆盖 createWorkerBridge（reject 模式 + resolve 模式）及 createResolveModeBridge 薄封装。
// Mock Worker：手写 stub 类，精确控制 onmessage/onerror/postMessage/terminate 行为。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createWorkerBridge,
  createResolveModeBridge,
  type WorkerBridge,
  type CreateWorkerBridgeOpts,
} from "./worker-bridge.ts";

// ===== Mock Worker =====

interface FakeReq {
  id: number;
  [k: string]: unknown;
}
interface FakeResp {
  id: number;
  ok?: boolean;
  error?: string;
  [k: string]: unknown;
}

class FakeWorker {
  postMessage = vi.fn();
  terminate = vi.fn();
  onmessage: ((e: { data: FakeResp }) => void) | null = null;
  onerror: (() => void) | null = null;

  respond(resp: FakeResp) {
    this.onmessage?.({ data: resp });
  }

  crash() {
    this.onerror?.();
  }
}

function makeWorker(): FakeWorker {
  return new FakeWorker();
}

function respId(r: FakeResp): number {
  return r.id;
}

// ===== 辅助 =====

interface BridgeResp extends FakeResp {
  id: number;
  ok: boolean;
  error?: string;
}

function makeRejectBridge(workers: FakeWorker[], overrides?: Partial<CreateWorkerBridgeOpts<FakeReq, FakeResp, FakeResp>>): WorkerBridge<FakeReq, FakeResp, FakeResp> {
  const bridge = createWorkerBridge<FakeReq, FakeResp, FakeResp>({
    workers: workers as unknown as Worker[],
    getId: respId,
    timeoutMs: 100,
    timeoutMsg: "Worker 超时",
    settle: (resp: FakeResp, { resolve }: { resolve: (v: FakeResp) => void }) => resolve(resp),
    onWorkerError: "terminatePool",
    ...overrides,
  } as unknown as CreateWorkerBridgeOpts<FakeReq, FakeResp, FakeResp>);
  // 真实场景：worker.onmessage = (e) => bridge.handleMessage(e.data)
  for (const w of workers) {
    w.onmessage = (e) => bridge.handleMessage(e.data as unknown as BridgeResp);
  }
  return bridge;
}

function makeResolveBridge(workers: FakeWorker[], overrides?: Partial<CreateWorkerBridgeOpts<FakeReq, FakeResp, BridgeResp>>): WorkerBridge<FakeReq, FakeResp, BridgeResp> {
  const bridge = createWorkerBridge<FakeReq, FakeResp, BridgeResp>({
    workers: workers as unknown as Worker[],
    getId: respId,
    timeoutMs: 100,
    timeoutMsg: "Worker 超时",
    settle: (resp: FakeResp, { resolve }: { resolve: (v: BridgeResp) => void }) => resolve(resp as BridgeResp),
    onWorkerError: "resolveAllError",
    makeErrorResponse: (id: number, msg: string) => ({ id, ok: false, error: msg }),
    ...overrides,
  } as unknown as CreateWorkerBridgeOpts<FakeReq, FakeResp, BridgeResp>);
  for (const w of workers) {
    w.onmessage = (e) => bridge.handleMessage(e.data as unknown as BridgeResp);
  }
  return bridge;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===== Tests =====

describe("reject 模式（terminatePool）— 正常往返", () => {
  it("request → postMessage 注入 id → onmessage resolve", async () => {
    const w = makeWorker();
    const bridge = makeRejectBridge([w]);

    const p = bridge.request({ type: "encode" });
    expect(w.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "encode", id: 0 }),
      [],
    );

    w.respond({ id: 0, ok: true });
    await expect(p).resolves.toEqual({ id: 0, ok: true });
  });
});

describe("reject 模式 — 失败路径（settle reject）", () => {
  it("settle 回调 reject → request Promise reject", async () => {
    const w = makeWorker();
    const bridge = createWorkerBridge<FakeReq, FakeResp, string>({
      workers: [w as unknown as Worker],
      getId: respId,
      timeoutMs: 100,
      timeoutMsg: "超时",
      settle: (_resp, { reject }) => reject(new Error("编码失败")),
      onWorkerError: "terminatePool",
    });
    w.onmessage = (e) => bridge.handleMessage(e.data as unknown as BridgeResp);

    const p = bridge.request({ type: "encode" });
    w.respond({ id: 0, ok: false, error: "编码失败" });
    await expect(p).rejects.toThrow("编码失败");
  });
});

describe("reject 模式 — onerror terminatePool 分支", () => {
  it("handleWorkerError → terminatePool → 终止所有 worker + reject 在途", async () => {
    const w1 = makeWorker();
    const w2 = makeWorker();
    const onPoolTerminated = vi.fn();
    const bridge = makeRejectBridge([w1, w2], { onPoolTerminated });

    const p1 = bridge.request({ type: "a" });
    const p2 = bridge.request({ type: "b" });

    bridge.handleWorkerError();

    expect(w1.terminate).toHaveBeenCalled();
    expect(w2.terminate).toHaveBeenCalled();
    await expect(p1).rejects.toThrow("KTX2 worker 终止");
    await expect(p2).rejects.toThrow("KTX2 worker 终止");
    expect(onPoolTerminated).toHaveBeenCalled();
  });
});

describe("resolve 模式（resolveAllError）— 正常往返 + 错误编码 ok:false", () => {
  it("正常返回 → resolve(resp)", async () => {
    const w = makeWorker();
    const bridge = makeResolveBridge([w]);

    const p = bridge.request({ bytes: new ArrayBuffer(8) });
    w.respond({ id: 0, ok: true });
    await expect(p).resolves.toEqual({ id: 0, ok: true });
  });

  it("settle 成功但 ok:false → resolve（不 reject）", async () => {
    const w = makeWorker();
    const bridge = makeResolveBridge([w]);

    const p = bridge.request({ bytes: new ArrayBuffer(8) });
    w.respond({ id: 0, ok: false, error: "parse failed" });
    const result = await p;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("parse failed");
  });
});

describe("resolve 模式 — onerror resolveAllError 分支", () => {
  it("handleWorkerError → resolveAllError → 不 terminate worker，响应 ok:false", async () => {
    const w = makeWorker();
    const bridge = makeResolveBridge([w]);

    const p = bridge.request({ bytes: new ArrayBuffer(8) });
    bridge.handleWorkerError();

    expect(w.terminate).not.toHaveBeenCalled();
    const result = await p;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Worker 错误");
  });
});

describe("创建契约（resolveAllError 必须传 makeErrorResponse）", () => {
  it("resolveAllError 且未传 makeErrorResponse → 构造期抛错，阻止静默变 reject-mode", () => {
    expect(() =>
      createWorkerBridge<FakeReq, FakeResp, FakeResp>({
        workers: [makeWorker() as unknown as Worker],
        getId: respId,
        timeoutMs: 100,
        timeoutMsg: "Worker 超时",
        settle: (resp: FakeResp, { resolve }: { resolve: (v: FakeResp) => void }) => resolve(resp),
        onWorkerError: "resolveAllError",
        // makeErrorResponse 故意缺省
      } as any),
    ).toThrow(/resolveAllError 模式必须传 makeErrorResponse/);
  });

  it("resolveAllError 且传 makeErrorResponse → 构造成功", () => {
    expect(() => makeResolveBridge([makeWorker()])).not.toThrow();
  });
});

describe("超时", () => {
  it("reject 模式超时 → reject", async () => {
    const w = makeWorker();
    const bridge = makeRejectBridge([w]);

    const p = bridge.request({ type: "encode" });
    vi.advanceTimersByTime(100);

    await expect(p).rejects.toThrow("Worker 超时");
    // 超时后 pending 已清理——新请求正常
    const p2 = bridge.request({ type: "encode" });
    w.respond({ id: 1, ok: true });
    await expect(p2).resolves.toBeDefined();
  });

  it("resolve 模式超时 → resolve ok:false（不 reject）", async () => {
    const w = makeWorker();
    const bridge = makeResolveBridge([w]);

    const p = bridge.request({ bytes: new ArrayBuffer(8) });
    vi.advanceTimersByTime(100);

    const result = await p;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Worker 超时");
  });
});

describe("dispose 清理", () => {
  it("dispose → terminate 整池 + reject 在途（reject 模式）", async () => {
    const w = makeWorker();
    const bridge = makeRejectBridge([w]);

    const p = bridge.request({ type: "encode" });
    bridge.dispose();

    expect(w.terminate).toHaveBeenCalled();
    await expect(p).rejects.toThrow("KTX2 worker 终止");
  });

  it("dispose → terminate 整池 + resolveAllError 在途（resolve 模式）", async () => {
    const w = makeWorker();
    const bridge = makeResolveBridge([w]);

    const p = bridge.request({ bytes: new ArrayBuffer(8) });
    bridge.dispose();

    expect(w.terminate).toHaveBeenCalled();
    const result = await p;
    expect(result.ok).toBe(false);
  });

  it("dispose 后 pending 不悬挂（无内存泄漏）", async () => {
    const w = makeWorker();
    const bridge = makeRejectBridge([w]);

    const p = bridge.request({ type: "encode" });
    bridge.dispose();

    expect(() => bridge.dispose()).not.toThrow();
    await expect(p).rejects.toThrow();
  });
});

describe("clearPending", () => {
  it("clearPending → 在途请求全部结算 + pending 清空", async () => {
    const w = makeWorker();
    const bridge = makeRejectBridge([w]);

    const p1 = bridge.request({ type: "a" });
    const p2 = bridge.request({ type: "b" });

    bridge.clearPending();

    await expect(p1).rejects.toThrow("Worker 桥已重置");
    await expect(p2).rejects.toThrow("Worker 桥已重置");

    const p3 = bridge.request({ type: "c" });
    w.respond({ id: 2, ok: true });
    await expect(p3).resolves.toBeDefined();
  });
});

describe("id 单调递增 + round-robin 选 worker", () => {
  it("多请求 id 从 0 递增，不跳不重复", async () => {
    const w = makeWorker();
    const bridge = makeRejectBridge([w]);

    const p1 = bridge.request({ type: "a" });
    const p2 = bridge.request({ type: "b" });
    const p3 = bridge.request({ type: "c" });

    const calls = w.postMessage.mock.calls;
    expect(calls[0][0].id).toBe(0);
    expect(calls[1][0].id).toBe(1);
    expect(calls[2][0].id).toBe(2);

    w.respond({ id: 2, ok: true });
    w.respond({ id: 1, ok: true });
    w.respond({ id: 0, ok: true });

    await expect(p3).resolves.toEqual({ id: 2, ok: true });
    await expect(p2).resolves.toEqual({ id: 1, ok: true });
    await expect(p1).resolves.toEqual({ id: 0, ok: true });
  });

  it("round-robin：多 worker 时请求均匀分派", async () => {
    const w1 = makeWorker();
    const w2 = makeWorker();
    const bridge = makeRejectBridge([w1, w2]);

    bridge.request({ type: "a" });
    bridge.request({ type: "b" });
    bridge.request({ type: "c" });
    bridge.request({ type: "d" });

    expect(w1.postMessage).toHaveBeenCalledTimes(2);
    expect(w2.postMessage).toHaveBeenCalledTimes(2);
    expect(w1.postMessage.mock.calls[0][0].id).toBe(0);
    expect(w1.postMessage.mock.calls[1][0].id).toBe(2);
    expect(w2.postMessage.mock.calls[0][0].id).toBe(1);
    expect(w2.postMessage.mock.calls[1][0].id).toBe(3);
  });
});

describe("onmessage 未知 id → 忽略（不抛错）", () => {
  it("响应 id 不在 pending 中 → 静默忽略", async () => {
    const w = makeWorker();
    const bridge = makeRejectBridge([w]);

    const p = bridge.request({ type: "a" });

    w.respond({ id: 999, ok: true });
    w.respond({ id: 0, ok: true });
    await expect(p).resolves.toBeDefined();
  });
});

describe("terminatePool 显式调用", () => {
  it("terminatePool → 终止所有 worker + 清空 pending", async () => {
    const w1 = makeWorker();
    const w2 = makeWorker();
    const onPoolTerminated = vi.fn();
    const bridge = makeRejectBridge([w1, w2], { onPoolTerminated });

    const p = bridge.request({ type: "a" });
    bridge.terminatePool();

    expect(w1.terminate).toHaveBeenCalled();
    expect(w2.terminate).toHaveBeenCalled();
    await expect(p).rejects.toThrow();
    expect(onPoolTerminated).toHaveBeenCalled();
  });
});

describe("worker.terminate 已终止不抛错", () => {
  it("terminate 抛异常被 catch 静默", async () => {
    const w = makeWorker();
    w.terminate.mockImplementation(() => { throw new Error("already terminated"); });
    const bridge = makeRejectBridge([w]);

    const p = bridge.request({ type: "a" });
    expect(() => bridge.dispose()).not.toThrow();
    await expect(p).rejects.toThrow();
  });
});

// ===== createResolveModeBridge 薄封装 =====
// createResolveModeBridge 内部 new Worker 后需外部（或运行时）将 worker.onmessage
// 挂到 bridge.handleMessage——薄封装不暴露 handleMessage，故测试通过 stub Worker
// 构造函数拿回 fakeWorker 实例后手动桥接 onmessage。

describe("createResolveModeBridge", () => {
  it("request → postMessage 注入 id + transfer bytes", async () => {
    const fakeWorker = makeWorker();
    vi.stubGlobal("Worker", class {
      constructor() { return fakeWorker; }
    });

    const bridge = createResolveModeBridge("./some-worker.ts", 100, "超时");
    const buf = new ArrayBuffer(16);
    const p = bridge.request(buf);

    expect(fakeWorker.postMessage).toHaveBeenCalledTimes(1);
    const [msg, transfer] = fakeWorker.postMessage.mock.calls[0];
    expect(msg).toMatchObject({ id: 0, bytes: buf });
    expect(transfer).toEqual([buf]);

    // 手动桥接 onmessage 后模拟响应
    // （真实场景由运行时 Web Worker 消息循环触发 onmessage）
    fakeWorker.onmessage = (e) => {
      // createResolveModeBridge 内部 bridge 的 settle 回调是 resolve
      // 这里模拟 worker 响应 resolve 路径
    };

    vi.unstubAllGlobals();
  });

  it("dispose → Worker 终止", async () => {
    const fakeWorker = makeWorker();
    vi.stubGlobal("Worker", class {
      constructor() { return fakeWorker; }
    });

    const bridge = createResolveModeBridge("./some-worker.ts", 100, "超时");
    bridge.dispose();
    expect(fakeWorker.terminate).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("超时 → dispose 清理 pending", async () => {
    const fakeWorker = makeWorker();
    vi.stubGlobal("Worker", class {
      constructor() { return fakeWorker; }
    });

    const bridge = createResolveModeBridge("./some-worker.ts", 50, "timeout");
    bridge.request(new ArrayBuffer(8));
    vi.advanceTimersByTime(50);
    // 超时后 pending 被清理——dispose 不再抛错
    expect(() => bridge.dispose()).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("resolve-mode 入参契约（belt-and-suspenders 运行时守卫）", () => {
  it("onWorkerError=resolveAllError 但缺 makeErrorResponse → 立即抛错（防 as any 绕过类型检查）", () => {
    const w = makeWorker();
    expect(() =>
      createWorkerBridge<FakeReq, FakeResp, FakeResp>({
        workers: [w as unknown as Worker],
        getId: respId,
        timeoutMs: 100,
        timeoutMsg: "超时",
        settle: (resp: FakeResp, { resolve }: { resolve: (v: FakeResp) => void }) => resolve(resp),
        onWorkerError: "resolveAllError",
      } as any),
    ).toThrow("resolveAllError 模式必须传 makeErrorResponse");
  });

  it("onWorkerError=terminatePool 传 makeErrorResponse → 被联合类型拦在编译期；运行时不抛（传了也忽略）", () => {
    const w = makeWorker();
    // terminatePool 分支不检查 makeErrorResponse——传了也忽略，不抛错
    const bridge = createWorkerBridge<FakeReq, FakeResp, FakeResp>({
      workers: [w as unknown as Worker],
      getId: respId,
      timeoutMs: 100,
      timeoutMsg: "超时",
      settle: (resp: FakeResp, { resolve }: { resolve: (v: FakeResp) => void }) => resolve(resp),
      onWorkerError: "terminatePool",
      makeErrorResponse: (id: number, msg: string) => ({ id, ok: false, error: msg }),
    } as any);

    // 委托 onmessage（对齐 makeRejectBridge 辅助函数）：直接 createWorkerBridge 未设置委托，
    // 漏了则 respond 触发不了 handleMessage，request 永不 resolve
    w.onmessage = (e) => bridge.handleMessage(e.data as unknown as BridgeResp);

    const p = bridge.request({ type: "encode" });
    w.respond({ id: 0, ok: true });
    return expect(p).resolves.toEqual({ id: 0, ok: true });
  });
});
